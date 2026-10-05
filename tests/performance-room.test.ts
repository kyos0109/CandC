import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { RoomController } from '../src/room-controller.js';
import { DiscussionStore, type StorageFault } from '../src/store.js';
import { RoomFakeAdapter } from '../src/adapters/room-fake.js';
import { roomInputSchema, roomStateSchema } from '../src/room-contract.js';
import { buildPrompt, type AgentAdapter, type TurnRequest } from '../src/adapters/types.js';
import { PerformanceStore, performanceReport, type PerformanceIO } from '../src/performance.js';
import { AppError } from '../src/domain.js';
import { waitUntil } from './helpers.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
const roomInput = (backend: 'fake' | 'live' = 'fake', moderator = true) => roomInputSchema.parse({
  behaviorVersion: 3, topic: 'Performance fixture', backend, mode: 'manual', flow: 'alternating', moderatorMode: 'judge',
  participants: ['codex', 'claude'].map(id => ({ id, provider: id, role: 'speaker', settings: { model: `fixture-${id}`, effort: 'medium' } })),
  moderator: moderator ? { id: 'moderator', provider: 'codex', role: 'moderator', settings: { model: 'fixture-codex', effort: 'medium' } } : null,
  limits: { maxRounds: 3, maxDurationMs: 20_000, turnTimeoutMs: 1_000, maxModeratorCalls: 100 },
});
async function setup(options: { enabled?: boolean; io?: PerformanceIO; fault?: StorageFault; live?: boolean; monitor?: boolean;
  finalOnly?: boolean; tools?: boolean; failure?: 'startup' | 'protocol' | 'cleanup' | 'timeout' } = {}) {
  const dir = await mkdtemp(path.resolve('.cache/performance-room-'));
  let time = 0;
  const performance = new PerformanceStore(path.join(dir, 'performance'), options.enabled ?? true,
    { now: () => time++, utc: () => '2026-10-05T06:00:00.000Z' }, options.io);
  const store = new DiscussionStore(dir, options.fault, roomStateSchema), requests: TurnRequest[] = [];
  const adapters = new Map<string, AgentAdapter>(); let preflights = 0;
  const controller = new RoomController(store, (provider, workspace, backend, actor) => {
    let adapter = adapters.get(workspace);
    if (!adapter) {
      const fake = new RoomFakeAdapter(provider, undefined, options.monitor && actor !== 'moderator' ? 15 : 0);
      adapter = { id: provider, backend, async *run(request) {
        requests.push(request);
        if (options.failure === 'startup') throw new AppError('PROCESS_START', 'Fixture startup');
        request.observePerformance?.('researchStart'); request.observePerformance?.('researchEnd');
        request.observePerformance?.('inferenceSpawn'); request.observePerformance?.('inferenceStarted');
        request.observePerformance?.('requestSent');
        if (options.failure === 'protocol') throw new AppError('INVALID_PROTOCOL', 'Fixture protocol');
        if (options.failure === 'timeout') {
          await new Promise<void>(resolve => request.signal.addEventListener('abort', () => resolve(), { once: true }));
          request.signal.throwIfAborted();
        }
        const model = `resolved-${provider}`;
        for await (const event of fake.run({ ...request, session: request.session ? { ...request.session, backend: 'fake' } : undefined })) {
          if (event.type === 'session') yield { ...event, session: { ...event.session, backend, model } };
          else if (event.type === 'completed') {
            if (options.tools && request.research) {
              yield { type: 'tool', name: 'fixture', toolId: 'private-tool-identity' };
              yield { type: 'tool', name: 'fixture', toolId: 'private-tool-identity' };
              yield { type: 'tool', name: 'fixture', toolId: 'another-private-identity' };
            }
            request.observePerformance?.('protocolComplete');
            yield { ...event, model, usage: provider === 'codex' ? { totalTokens: 30, inputTokens: 20, outputTokens: 10 } : { input_tokens: 20, output_tokens: 10 } };
          } else if (!(options.finalOnly && event.type === 'delta')) yield event;
        }
        request.observePerformance?.('cleanupStart');
        if (options.failure === 'cleanup') throw new Error('Fixture cleanup');
        request.observePerformance?.('cleanupEnd');
      } };
      adapters.set(workspace, adapter);
    }
    return adapter;
  }, async (_state, observer) => {
    preflights++; observer?.('loginStart'); observer?.('loginProcessStarted'); observer?.('loginEnd');
    observer?.('catalogStart'); observer?.('catalogEnd'); return { codex: 'fixture-1', claude: 'fixture-2' };
  }, performance, options.monitor ? 5 : 10_000);
  const id = randomUUID(); await controller.create(id, { ...roomInput(options.live ? 'live' : 'fake', options.monitor), research: options.tools ?? false });
  cleanup.push(async () => { await controller.close(); await performance.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, id, store, controller, performance, requests, preflights: () => preflights };
}
describe('room performance observations', () => {
  it('counts tools once by identity without persisting tool or session identities', async () => {
    const ctx = await setup({ tools: true }); await ctx.controller.start(ctx.id, randomUUID()); await ctx.controller.wait(ctx.id); await ctx.performance.close();
    const view = await ctx.performance.view(ctx.id);
    expect(view.records.filter(r => r.kind === 'turn' && r.purpose === 'discussion').every(r => r.tools === 2)).toBe(true);
    expect(JSON.stringify(view)).not.toContain('private-tool-identity');
    for (const c of ctx.controller.get(ctx.id).room.calls) expect(JSON.stringify(view)).not.toContain(c.nativeSessionId!);
  });
  it('separates seats and moderator purposes, observes saving/usage, and keeps readiness execution-only', async () => {
    const ctx = await setup({ live: true, monitor: true });
    const op = randomUUID(); await ctx.controller.start(ctx.id, op); await ctx.controller.wait(ctx.id);
    await ctx.controller.start(ctx.id, op); await ctx.performance.close();
    const view = await ctx.performance.view(ctx.id), turns = view.records.filter(r => r.kind === 'turn');
    expect(ctx.preflights()).toBe(1); expect(view.records.filter(r => r.kind === 'execution')).toHaveLength(1);
    expect(new Set(turns.map(r => r.purpose))).toEqual(new Set(['discussion', 'moderation', 'monitor']));
    expect(new Set(turns.map(r => r.participant))).toEqual(new Set(['codex', 'claude', 'moderator']));
    for (const r of turns.filter(r => r.outcome === 'success')) {
      expect(r.model).toBe(`resolved-${r.provider}`); expect(r.cliVersion).toBe(r.provider === 'codex' ? 'fixture-1' : 'fixture-2');
      expect(r.usage).not.toBeNull(); expect(r.usageSource).toBe(r.provider === 'codex' ? 'codex.thread/tokenUsage.last' : 'claude.result.usage');
      expect(r.textMode).toBe('stream'); expect(r.durations.waitFirstReply).not.toBeNull(); expect(r.durations.generation).not.toBeNull();
      expect(r.durations.selection).not.toBeNull(); expect(r.durations.prepared).not.toBeNull(); expect(r.durations.login).toBeNull();
      if (r.purpose === 'monitor') { expect(r.answerSaved).toBe(false); expect(r.diagnosticsSaved).toBe(true); expect(r.durations.diagnosticCommit).not.toBeNull(); expect(r.durations.answerCommit).toBeNull(); }
      else { expect(r.answerSaved).toBe(true); expect(r.durations.answerCommit).not.toBeNull(); }
    }
    const report = performanceReport(view);
    expect(report.groups.some(g => g.labels.purpose === 'monitor' && g.completeSuccess > 0)).toBe(true);
    const journalCalls = ctx.controller.get(ctx.id).room.calls;
    expect(turns.every(r => journalCalls.find(c => c.id === r.requestId)?.purpose === r.purpose)).toBe(true);
    expect(journalCalls).toHaveLength(ctx.requests.length);
  });
  it('excludes final-only observations from streaming first reply statistics', async () => {
    const ctx = await setup({ finalOnly: true }); await ctx.controller.start(ctx.id, randomUUID()); await ctx.controller.wait(ctx.id); await ctx.performance.close();
    const view = await ctx.performance.view(ctx.id);
    expect(view.records.filter(r => r.kind === 'turn').every(r => r.textMode === 'final-only' && r.answerSaved)).toBe(true);
    expect(performanceReport(view, 'fake').groups.every(g => g.success.waitFirstReply!.valid === 0)).toBe(true);
  });
  it.each(['startup', 'protocol', 'cleanup', 'timeout'] as const)('classifies %s without admitting failed samples', async failure => {
    const ctx = await setup({ failure }); await ctx.controller.start(ctx.id, randomUUID()); await ctx.controller.wait(ctx.id); await ctx.performance.close();
    const turn = (await ctx.performance.view(ctx.id)).records.find(r => r.kind === 'turn')!;
    expect(turn.outcome).toBe({ startup: 'startup-error', protocol: 'protocol-error', cleanup: 'cleanup-error', timeout: 'timeout' }[failure]);
    expect(turn.answerSaved).toBeNull(); expect(ctx.requests).toHaveLength(1);
  });
  it('keeps user cancellation separate from timeout', async () => {
    const ctx = await setup({ failure: 'timeout' }); await ctx.controller.start(ctx.id, randomUUID());
    await waitUntil(() => ctx.requests.length === 1); await ctx.controller.stop(ctx.id); await ctx.controller.wait(ctx.id); await ctx.performance.close();
    expect((await ctx.performance.view(ctx.id)).records.find(r => r.kind === 'turn')?.outcome).toBe('cancelled');
  });
  it.each(['answer', 'error', 'prepared'] as const)('ends as storage-unknown when the %s commit fails', async boundary => {
    const fault: StorageFault = async (stage, _handle, payload) => {
      if (stage === 'beforeAppend' && (boundary === 'answer' ? payload.includes('"type":"message"') : boundary === 'error' ? payload.includes('"type":"error"') : payload.includes('preparedCall'))) throw new Error('Fixture journal failure');
    };
    const ctx = await setup({ fault, ...(boundary === 'error' ? { failure: 'protocol' as const } : {}) });
    await ctx.controller.start(ctx.id, randomUUID()); await ctx.controller.wait(ctx.id); await ctx.performance.close();
    expect((await ctx.performance.view(ctx.id)).records.find(r => r.kind === 'turn')?.outcome).toBe('storage-unknown');
    expect(ctx.controller.get(ctx.id).storage?.status).toBe('unconfirmed'); expect(ctx.requests.length).toBeLessThanOrEqual(1);
  });
  it('keeps prompts, calls and journal event sequence identical with collection disabled or unavailable', async () => {
    const results: unknown[] = [];
    for (const mode of ['enabled', 'disabled', 'failed'] as const) {
      const ctx = await setup({ enabled: mode !== 'disabled', ...(mode === 'failed' ? { io: { append: async () => { throw new Error('Fixture sidecar failure'); } } } : {}) });
      await ctx.controller.start(ctx.id, randomUUID()); await ctx.controller.wait(ctx.id); await ctx.performance.close();
      const normalize = (s: string) => s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID')
        .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, 'UTC');
      results.push({ prompts: ctx.requests.map(r => normalize(buildPrompt(r))),
        calls: ctx.controller.get(ctx.id).room.calls.map(c => ({ participant: c.participant, status: c.status, purpose: c.purpose })),
        events: (await ctx.controller.events(ctx.id)).map(e => ({ type: e.type, sequence: e.sequence })) });
      const before = await readFile(path.join(ctx.dir, `${ctx.id}.jsonl`), 'utf8');
      await ctx.performance.view(ctx.id); expect(await readFile(path.join(ctx.dir, `${ctx.id}.jsonl`), 'utf8')).toBe(before);
    }
    expect(results[1]).toEqual(results[0]); expect(results[2]).toEqual(results[0]);
  });
});
