import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PerformanceStore, durationValues, performanceReport, performanceMarkdown, percentile, providerUsage, type MeasurementLabels } from '../src/performance.js';

const directories: string[] = [];
async function directory() { const d = await mkdtemp(path.resolve('.cache/performance-test-')); directories.push(d); return d; }
afterEach(async () => { for (const d of directories.splice(0)) await rm(d, { recursive: true, force: true }); });
const labels = (overrides: Partial<MeasurementLabels> = {}): MeasurementLabels => ({ kind: 'turn', discussionId: randomUUID(), executionId: randomUUID(), requestId: randomUUID(),
  backend: 'live', provider: 'codex', cliVersion: 'fixture', model: 'fixture-model', effort: 'medium', research: false, purpose: 'discussion', session: 'new', characters: 100, round: 1, position: 1, ...overrides });
const clock = () => { let time = 0; return { now: () => time, utc: () => '2026-10-04T01:00:00.000Z', advance: (ms: number) => { time += ms; } }; };
async function sample(store: PerformanceStore, options: Partial<MeasurementLabels> = {}) {
  const m = store.begin(labels(options))!;
  m.mark('requestSent'); m.text('stream'); m.mark('protocolComplete'); m.mark('cleanupStart'); m.mark('cleanupEnd'); m.record.answerSaved = true; m.end('success');
  return m;
}
describe('monotonic performance measurements', () => {
  it('excludes sensitive metadata and accepts only provider-native numeric usage', async () => {
    const store = new PerformanceStore(await directory(), true);
    const m = store.begin(labels({ model: 'C:\\private\\model', cliVersion: 'private prompt text' }))!;
    const usage = providerUsage({ input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 10,
      cache_creation: { ephemeral_5m_input_tokens: 10, secret: 'private credential' }, server_tool_use: { web_search_requests: 2 },
      prompt: 'private prompt', stderr: 'private stderr', outputTokens: NaN });
    m.usage(undefined, usage); m.end('success'); await store.close();
    const view = await store.view(); expect(view.records[0]?.model).toBeNull(); expect(view.records[0]?.cliVersion).toBeNull();
    expect(view.records[0]?.usage).toEqual({ input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 10,
      cache_creation: { ephemeral_5m_input_tokens: 10 }, server_tool_use: { web_search_requests: 2 } });
    expect(JSON.stringify(view)).not.toMatch(/private|credential|stderr|prompt/);
  });
  it('captures the failing protocol phase before finally cleanup observations', async () => {
    const store = new PerformanceStore(await directory(), true), m = store.begin(labels())!;
    m.mark('requestSent'); m.mark('failureObserved'); m.mark('cleanupStart'); m.mark('cleanupEnd'); m.end('protocol-error'); await store.close();
    expect((await store.view()).records[0]?.failurePhase).toBe('requestSent');
  });
  it('uses first observations, durations and null without inventing an end or copying content', async () => {
    const c = clock(), store = new PerformanceStore(await directory(), true, c);
    const m = store.begin(labels())!;
    c.advance(10); m.mark('requestSent'); c.advance(20); m.text('stream'); c.advance(100); m.text('final-only'); m.mark('requestSent'); m.mark('protocolComplete'); m.end('success'); m.end('failed');
    await store.close();
    const view = await store.view();
    expect(view.records).toHaveLength(1);
    expect(view.records[0]?.offsets.requestSent).toBe(10);
    expect(view.records[0]?.textMode).toBe('stream');
    expect(view.records[0]?.durations.waitFirstReply).toBe(20);
    expect(view.records[0]?.durations.generation).toBe(100);
    expect(view.records[0]?.durations.rpc).toBeNull();
    expect(view.records[0]?.outcome).toBe('success');
    expect(durationValues({ ...m.record, offsets: { requestSent: 10, firstPublicText: 1 } }).waitFirstReply).toBeNull();
  });
  it('retains provider usage without adding cache or reasoning subfields to totals', async () => {
    const store = new PerformanceStore(await directory(), true);
    const m = await sample(store);
    m.usage({ totalTokens: 30, inputTokens: 20, cachedInputTokens: 10, outputTokens: 10, reasoningOutputTokens: 5, secret: 123 });
    // Usage normally arrives before end; test a second sample to exercise serialization.
    const next = store.begin(labels())!; next.usage(m.record.usage as Record<string, number>); next.end('failed'); await store.close();
    const view = await store.view(); const usage = view.records.find(r => r.requestId === next.record.requestId)?.usage;
    expect(usage).toEqual({ totalTokens: 30, inputTokens: 20, cachedInputTokens: 10, outputTokens: 10, reasoningOutputTokens: 5 });
    expect(JSON.stringify(view)).not.toContain('secret');
  });
});
describe('bounded disposable storage', () => {
  it('rotates only the three owned files and preserves unrelated data', async () => {
    const dir = await directory(); await writeFile(path.join(dir, 'unrelated.jsonl'), 'keep');
    const store = new PerformanceStore(dir, true, undefined, undefined, 2400);
    for (let i = 0; i < 8; i++) await sample(store);
    await store.close();
    const files = await readdir(dir);
    expect(files.filter(f => f.startsWith('performance-v1.'))).toHaveLength(3);
    expect(await readFile(path.join(dir, 'unrelated.jsonl'), 'utf8')).toBe('keep');
    for (const file of files.filter(f => f.startsWith('performance-v1.'))) expect(Buffer.byteLength(await readFile(path.join(dir, file)))).toBeLessThanOrEqual(2400);
  });
  it('drops failed writes and rejects later records without rejecting the caller', async () => {
    const store = new PerformanceStore(await directory(), true, undefined, { append: async () => { throw new Error('private file path'); } });
    await sample(store); await store.close();
    await sample(store);
    const view = await store.view(); expect(view.available).toBe(false); expect(view.dropped).toBeGreaterThan(0);
    expect(JSON.stringify(view)).not.toContain('private file path');
  });
  it('bounds queue and shutdown wait even when a writer stalls', async () => {
    let release!: () => void;
    const store = new PerformanceStore(await directory(), true, undefined, { append: () => new Promise<void>(resolve => { release = resolve; }) }, undefined, 1);
    await sample(store); await sample(store);
    await new Promise(resolve => setTimeout(resolve, 20));
    await store.close(10);
    expect((await store.view()).available).toBe(false); expect((await store.view()).dropped).toBeGreaterThan(0);
    release();
  });
  it('skips corrupt records without rewriting and preserves incomplete starts across restart', async () => {
    const dir = await directory(), store = new PerformanceStore(dir, true);
    store.begin(labels()); await store.close();
    const file = path.join(dir, 'performance-v1.0.jsonl'), original = await readFile(file, 'utf8');
    await writeFile(file, original + '{broken}\n' + JSON.stringify({ prompt: 'private prompt' }) + '\n');
    const restarted = new PerformanceStore(dir, true); const view = await restarted.view();
    expect(view.corrupt).toBe(2); expect(view.records[0]?.incomplete).toBe(true); expect(view.records[0]?.offsets.ended).toBeUndefined();
    expect(view.records[0]?.durations.total).toBeNull(); expect(view.records[0]?.processes).toEqual({ inspection: null, inference: null }); expect(JSON.stringify(view)).not.toContain('private prompt');
    expect(await readFile(file, 'utf8')).toBe(original + '{broken}\n' + JSON.stringify({ prompt: 'private prompt' }) + '\n'); await restarted.close();
  });
  it('disabled measurement writes nothing but retained diagnostics can still be read', async () => {
    const dir = await directory(), enabled = new PerformanceStore(dir, true); await sample(enabled); await enabled.close();
    const disabled = new PerformanceStore(dir, false); expect(disabled.begin(labels())).toBeUndefined();
    expect((await disabled.view()).records).toHaveLength(1); await disabled.close();
  });
});
describe('daily baseline', () => {
  it('separates participant and purpose, admits saved monitor diagnostics, and reads old records unchanged', async () => {
    const dir = await directory(), store = new PerformanceStore(dir, true);
    await sample(store); // Previous v1 records have no participant field.
    await sample(store, { participant: 'codex' });
    await sample(store, { participant: 'codex-2' });
    const monitor = store.begin(labels({ participant: 'moderator', purpose: 'monitor' }))!;
    monitor.mark('cleanupEnd'); monitor.record.answerSaved = false; monitor.record.diagnosticsSaved = true; monitor.end('success');
    await store.close();
    const file = path.join(dir, 'performance-v1.0.jsonl'), before = await readFile(file, 'utf8'), view = await store.view();
    expect(view.corrupt).toBe(0); expect(view.records).toHaveLength(4);
    const groups = performanceReport(view).groups;
    expect(groups).toHaveLength(4); expect(groups.find(g => g.labels.participant === null)?.samples).toBe(1);
    expect(groups.find(g => g.labels.purpose === 'monitor')?.completeSuccess).toBe(1);
    expect(await readFile(file, 'utf8')).toBe(before);
  });
  it('does not infer a reuse direction with unknown CLI versions even after the sample threshold', async () => {
    const store = new PerformanceStore(await directory(), true), ids = [randomUUID(), randomUUID(), randomUUID()];
    for (let i = 0; i < 20; i++) await sample(store, { cliVersion: null, discussionId: ids[i % 3]! });
    await store.close();
    expect(performanceReport(await store.view()).groups[0]?.interpretation).toContain('known CLI/model');
  });
  it('preserves acceptance and lock waiting when admission is deferred until idempotency checks', async () => {
    const c = clock(), store = new PerformanceStore(await directory(), true, c), accepted = store.captureTime();
    c.advance(42); const m = store.begin(labels(), accepted)!; m.mark('locked'); m.end('failed'); await store.close();
    expect((await store.view()).records[0]?.durations.lock).toBe(42);
  });
  it('uses nearest rank, isolates backend/provider/buckets and requires enough discussions', async () => {
    const c = clock(), store = new PerformanceStore(await directory(), true, c);
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (let i = 1; i <= 20; i++) {
      const m = store.begin(labels({ discussionId: ids[i % 3]! }))!;
      m.mark('inspectSpawn'); c.advance(1100); m.mark('sessionEnd'); m.mark('requestSent'); c.advance(i); m.text('stream'); c.advance(500); m.mark('protocolComplete'); m.mark('cleanupEnd'); m.record.answerSaved = true; m.end('success');
    }
    await sample(store, { backend: 'fake' }); await sample(store, { provider: 'claude', characters: 8000 }); await sample(store, { characters: 32000 });
    const incomplete = store.begin(labels())!;
    const cancelled = store.begin(labels())!; cancelled.end('cancelled');
    const finalOnly = store.begin(labels())!; finalOnly.mark('requestSent'); finalOnly.text('final-only'); finalOnly.mark('cleanupEnd'); finalOnly.record.answerSaved = true; finalOnly.end('success');
    await store.close(); const report = performanceReport(await store.view());
    expect(report.samples).toBe(25); expect(report.groups).toHaveLength(3);
    const main = report.groups.find(g => g.samples === 23)!;
    expect(main.success.waitFirstReply).toEqual({ valid: 20, missing: 1, p50: 10, p90: 18 });
    expect(main.incomplete).toBe(1); expect(main.outcomes.cancelled).toBe(1); expect(main.interpretation).toContain('Investigate');
    expect(main.trend.find(t => t.requestId === incomplete.record.requestId)?.incomplete).toBe(true);
    expect(report.groups.find(g => g.labels.provider === 'claude')?.interpretation).toContain('Insufficient');
    expect(performanceMarkdown(report)).toContain('Raw turn trend');
    expect(percentile([4, 1, 3, 2], .5)).toBe(2); expect(percentile([], .9)).toBeNull();
  });
  it('does not admit a model completion as proof of saved success', async () => {
    const store = new PerformanceStore(await directory(), true); const m = store.begin(labels())!;
    m.mark('protocolComplete'); m.mark('cleanupEnd'); m.end('success'); await store.close();
    expect(performanceReport(await store.view()).groups[0]?.completeSuccess).toBe(0);
  });
});
