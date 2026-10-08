import { redact } from './redaction.js';
import { performance } from 'node:perf_hooks';
import { mkdir, readFile, appendFile, rename, unlink, stat, lstat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export interface MeasurementClock { now(): number; utc(): string }
export type MeasurementTime = { now: number; utc: string };
export const measurementClock: MeasurementClock = { now: () => performance.now(), utc: () => new Date().toISOString() };
export const phases = ['accepted', 'locked', 'loginProcessStarted', 'catalogProcessStarted', 'loginStart', 'loginEnd', 'catalogStart', 'catalogEnd', 'selectionStart', 'selectionEnd',
  'preparedStart', 'preparedEnd', 'researchStart', 'researchEnd', 'inspectSpawn', 'inspectStarted', 'inspectReadStart', 'inspectReadEnd',
  'inspectCleanupStart', 'inspectCleanupEnd', 'inferenceSpawn', 'inferenceStarted', 'rpcStart', 'rpcEnd', 'policyStart', 'policyEnd',
  'sessionStart', 'sessionEnd', 'requestSent', 'firstPublicText', 'protocolComplete', 'cleanupStart', 'cleanupEnd',
  'failureObserved', 'answerCommitStart', 'answerCommitEnd', 'diagnosticCommitStart', 'diagnosticCommitEnd', 'ended'] as const;
export type Phase = typeof phases[number];
export type PerformanceObserver = (phase: Phase) => void;
// Observers are intentionally unable to change protocol or storage control flow.
export function observe(observer: PerformanceObserver | undefined, phase: Phase) { try { observer?.(phase); } catch { /* Discard diagnostics. */ } }
const durations = {
  lock: ['accepted', 'locked'], login: ['loginStart', 'loginEnd'], catalog: ['catalogStart', 'catalogEnd'],
  selection: ['selectionStart', 'selectionEnd'], prepared: ['preparedStart', 'preparedEnd'], research: ['researchStart', 'researchEnd'],
  inspectSpawn: ['inspectSpawn', 'inspectStarted'], inspectRead: ['inspectReadStart', 'inspectReadEnd'], inspectCleanup: ['inspectCleanupStart', 'inspectCleanupEnd'],
  inferenceSpawn: ['inferenceSpawn', 'inferenceStarted'], rpc: ['rpcStart', 'rpcEnd'], policy: ['policyStart', 'policyEnd'], session: ['sessionStart', 'sessionEnd'],
  preparation: ['researchStart', 'requestSent'], codexPreparation: ['inspectSpawn', 'sessionEnd'], waitFirstReply: ['requestSent', 'firstPublicText'], generation: ['firstPublicText', 'protocolComplete'],
  cleanup: ['cleanupStart', 'cleanupEnd'], answerCommit: ['answerCommitStart', 'answerCommitEnd'], diagnosticCommit: ['diagnosticCommitStart', 'diagnosticCommitEnd'], total: ['accepted', 'ended'],
} satisfies Record<string, [Phase, Phase]>;
const usageKeys = ['totalTokens', 'inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'outputTokens', 'reasoningOutputTokens',
  'input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'] as const;
const tokenNumber = z.number().finite().nonnegative();
const usageSchema = z.object({ ...Object.fromEntries(usageKeys.map(k => [k, tokenNumber.optional()])),
  cache_creation: z.object({ ephemeral_5m_input_tokens: tokenNumber.optional(), ephemeral_1h_input_tokens: tokenNumber.optional() }).strict().optional(),
  server_tool_use: z.object({ web_search_requests: tokenNumber.optional(), web_fetch_requests: tokenNumber.optional() }).strict().optional(),
}).strict();
export type ProviderUsage = z.infer<typeof usageSchema>;
export function providerUsage(value: unknown): ProviderUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const original = value as Record<string, unknown>, safe: Record<string, unknown> = {};
  for (const key of usageKeys) if (tokenNumber.safeParse(original[key]).success) safe[key] = original[key];
  for (const [key, fields] of Object.entries({ cache_creation: ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens'], server_tool_use: ['web_search_requests', 'web_fetch_requests'] })) {
    const nested = original[key];
    if (nested && typeof nested === 'object') {
      const counts = Object.fromEntries(fields.filter(f => tokenNumber.safeParse((nested as Record<string, unknown>)[f]).success).map(f => [f, (nested as Record<string, unknown>)[f]]));
      if (Object.keys(counts).length) safe[key] = counts;
    }
  }
  return Object.keys(safe).length ? usageSchema.parse(safe) : undefined;
}
const identifier = z.string().max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).refine(v => redact(v) === v);
const safeIdentifier = (value: string | null) => identifier.safeParse(value).success ? value : null;
const recordSchema = z.object({ version: z.literal(1), boundary: z.enum(['begin', 'end']), kind: z.enum(['execution', 'turn']),
  discussionId: z.uuid(), executionId: z.uuid(), requestId: z.uuid().nullable(), at: z.iso.datetime(),
  backend: z.enum(['live', 'fake']), provider: z.enum(['codex', 'claude', 'gemini', 'grok']).nullable(), cliVersion: identifier.nullable(),
  cliVersions: z.object({ codex: identifier.nullable(), claude: identifier.nullable() }).strict().nullable(),
  preflightProcesses: z.number().int().nonnegative(),
  appVersion: z.literal('0.1.0'), nodeVersion: z.string().max(100), model: identifier.nullable(), effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).nullable(),
  research: z.boolean(), purpose: z.enum(['discussion', 'roles', 'summary', 'moderation', 'monitor', 'selection-options', 'selection-rating']),
  participant: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/).nullable().optional(), session: z.enum(['new', 'resumed']).nullable(),
  characters: z.number().int().nonnegative().nullable(), round: z.number().int().nonnegative().nullable(), position: z.number().int().nonnegative().nullable(),
  offsets: z.partialRecord(z.enum(phases), z.number().finite().nonnegative()), outcome: z.enum(['success', 'cancelled', 'timeout', 'startup-error', 'protocol-error', 'cleanup-error', 'storage-unknown', 'failed']).nullable(),
  failurePhase: z.enum(phases).nullable(), textMode: z.enum(['stream', 'final-only']).nullable(), tools: z.number().int().nonnegative(),
  usage: usageSchema.nullable(), usageSource: z.enum(['codex.thread/tokenUsage.last', 'claude.result.usage']).nullable(),
  answerSaved: z.boolean().nullable(), diagnosticsSaved: z.boolean().nullable(),
}).strict();
export type PerformanceRecord = z.infer<typeof recordSchema>;
export type MeasurementLabels = Omit<PerformanceRecord, 'version' | 'boundary' | 'at' | 'appVersion' | 'nodeVersion' | 'offsets' | 'outcome' | 'failurePhase' | 'textMode' | 'tools' | 'usage' | 'usageSource' | 'answerSaved' | 'diagnosticsSaved' | 'cliVersions' | 'preflightProcesses'>;
export function durationValues(record: PerformanceRecord) {
  return Object.fromEntries(Object.entries(durations).map(([name, [a, b]]) => {
    const start = record.offsets[a], end = record.offsets[b];
    return [name, start !== undefined && end !== undefined && end >= start ? end - start : null];
  })) as Record<keyof typeof durations, number | null>;
}
export class Measurement {
  private readonly start: number;
  readonly record: PerformanceRecord;
  private finished = false;
  private admitted: boolean;
  constructor(labels: MeasurementLabels, private readonly sink: PerformanceStore, private readonly clock: MeasurementClock, accepted?: MeasurementTime) {
    this.start = accepted?.now ?? clock.now();
    this.record = { ...labels, version: 1, boundary: 'begin', at: accepted?.utc ?? clock.utc(), appVersion: '0.1.0', nodeVersion: process.version,
      cliVersions: null, preflightProcesses: 0, offsets: { accepted: 0 }, outcome: null, failurePhase: null, textMode: null, tools: 0, usage: null, usageSource: null, answerSaved: null, diagnosticsSaved: null };
    this.admitted = sink.enqueue(this.record);
  }
  mark: PerformanceObserver = phase => {
    if (this.finished) return;
    if (phase === 'failureObserved') { this.record.failurePhase ??= (Object.keys(this.record.offsets) as Phase[]).at(-1) ?? null; return; }
    if (phase === 'loginProcessStarted' || phase === 'catalogProcessStarted') this.record.preflightProcesses++;
    this.record.offsets[phase] ??= Math.max(0, this.clock.now() - this.start);
  };
  text(mode: 'stream' | 'final-only') { if (!this.record.textMode) { this.record.textMode = mode; this.mark('firstPublicText'); } }
  usage(value: Record<string, number> | undefined, native?: ProviderUsage) {
    const usage = providerUsage(native ?? value);
    if (!usage) return;
    this.record.usage = usage;
    this.record.usageSource = this.record.provider === 'codex' ? 'codex.thread/tokenUsage.last' : this.record.provider === 'claude' ? 'claude.result.usage' : null;
  }
  end(outcome: NonNullable<PerformanceRecord['outcome']>) {
    if (this.finished) return;
    this.mark('ended'); this.finished = true;
    this.record.boundary = 'end'; this.record.at = this.clock.utc(); this.record.outcome = outcome;
    if (outcome === 'cleanup-error') {
      if (this.record.offsets.cleanupStart !== undefined && this.record.offsets.cleanupEnd === undefined) this.record.failurePhase = 'cleanupStart';
      else if (this.record.offsets.inspectCleanupStart !== undefined && this.record.offsets.inspectCleanupEnd === undefined) this.record.failurePhase = 'inspectCleanupStart';
    }
    if (outcome === 'storage-unknown') {
      if (this.record.offsets.diagnosticCommitStart !== undefined && this.record.offsets.diagnosticCommitEnd === undefined) this.record.failurePhase = 'diagnosticCommitStart';
      else if (this.record.offsets.answerCommitStart !== undefined && this.record.offsets.answerCommitEnd === undefined) this.record.failurePhase = 'answerCommitStart';
    }
    if (outcome !== 'success') this.record.failurePhase ??= (Object.keys(this.record.offsets) as Phase[]).filter(p => p !== 'ended').at(-1) ?? null;
    if (this.admitted) this.sink.enqueue(this.record); else this.sink.drop();
  }
}
export type PerformanceView = { enabled: boolean; available: boolean; dropped: number; corrupt: number; warnings: string[];
  records: (PerformanceRecord & { incomplete: boolean; durations: ReturnType<typeof durationValues>; processes: { inspection: number | null; inference: number | null } })[] };
export type PerformanceIO = { append(file: string, line: string): Promise<void> };
export class PerformanceStore {
  private queue: PerformanceRecord[] = [];
  private writing: Promise<void> | undefined;
  private closed = false;
  private failed = false;
  private dropped = 0;
  private readonly root: string;
  constructor(directory = path.resolve('.cache/performance'), readonly enabled = process.env.CANDC_PERFORMANCE_ENABLED !== '0',
    private readonly clock: MeasurementClock = measurementClock, private readonly io: PerformanceIO = { append: appendFile },
    private readonly maxBytes = 10 * 1024 * 1024, private readonly capacity = 256) { this.root = path.resolve(directory); }
  captureTime(): MeasurementTime { return { now: this.clock.now(), utc: this.clock.utc() }; }
  begin(labels: MeasurementLabels, accepted?: MeasurementTime): Measurement | undefined { return this.enabled ? new Measurement(labels, this, this.clock, accepted) : undefined; }
  drop() { this.dropped++; }
  enqueue(record: PerformanceRecord): boolean {
    if (!this.enabled) return false;
    if (this.closed || this.failed || this.queue.length >= this.capacity) { this.dropped++; return false; }
    // Strict whitelist also prevents caller-added content from reaching disk.
    const parsed = recordSchema.safeParse({ ...record, model: safeIdentifier(record.model), cliVersion: safeIdentifier(record.cliVersion),
      cliVersions: record.cliVersions ? { codex: safeIdentifier(record.cliVersions.codex), claude: safeIdentifier(record.cliVersions.claude) } : null });
    if (!parsed.success) { this.dropped++; return false; }
    this.queue.push(parsed.data);
    this.writing ??= this.drain().finally(() => { this.writing = undefined; });
    return true;
  }
  private file(index: number) {
    const file = path.resolve(this.root, `performance-v1.${index}.jsonl`);
    if (path.dirname(file) !== this.root || index < 0 || index > 2) throw new Error('Invalid diagnostic path.');
    return file;
  }
  private async safePaths() {
    await mkdir(this.root, { recursive: true });
    if ((await lstat(this.root)).isSymbolicLink()) throw new Error('Diagnostic directory cannot be a link.');
    for (let i = 0; i < 3; i++) {
      try { if ((await lstat(this.file(i))).isSymbolicLink()) throw new Error('Diagnostic file cannot be a link.'); }
      catch (e) { if (!isMissing(e)) throw e; }
    }
  }
  private async drain() {
    try {
      await this.safePaths();
      while (this.queue.length) {
        const record = this.queue.shift()!, line = JSON.stringify(record) + '\n', bytes = Buffer.byteLength(line);
        if (bytes > this.maxBytes) { this.dropped++; continue; }
        let size = 0;
        try { size = (await stat(this.file(0))).size; } catch (e) { if (!isMissing(e)) throw e; }
        if (size + bytes > this.maxBytes) {
          await this.safePaths();
          try { await unlink(this.file(2)); } catch (e) { if (!isMissing(e)) throw e; }
          for (const i of [1, 0]) { try { await rename(this.file(i), this.file(i + 1)); } catch (e) { if (!isMissing(e)) throw e; } }
        }
        await this.io.append(this.file(0), line);
      }
    } catch { this.failed = true; this.dropped += this.queue.length + 1; this.queue = []; }
  }
  async close(timeoutMs = 2000) {
    this.closed = true;
    let timer: NodeJS.Timeout | undefined;
    const drained = await Promise.race([this.writing?.then(() => true) ?? Promise.resolve(true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]);
    clearTimeout(timer);
    if (!drained) { this.failed = true; this.dropped += this.queue.length + 1; this.queue = []; }
  }
  async view(discussionId?: string): Promise<PerformanceView> {
    const records = new Map<string, PerformanceRecord>();
    let corrupt = 0, readFailed = false;
    for (const i of [2, 1, 0]) {
      try {
        if ((await lstat(this.root)).isSymbolicLink() || (await lstat(this.file(i))).isSymbolicLink() || (await stat(this.file(i))).size > this.maxBytes) throw new Error('Unsafe diagnostic file.');
        for (const line of (await readFile(this.file(i), 'utf8')).split('\n')) {
          if (!line.trim()) continue;
          try {
            const r = recordSchema.parse(JSON.parse(line));
            if (!discussionId || r.discussionId === discussionId) {
              const key = r.kind === 'execution' ? r.executionId : r.requestId!;
              if (records.get(key)?.boundary !== 'end') records.set(key, r);
            }
          } catch { corrupt++; }
        }
      } catch (e) { if (!isMissing(e)) readFailed = true; }
    }
    const values = [...records.values()].sort((a, b) => a.at.localeCompare(b.at)).map(r => ({ ...r, incomplete: r.boundary !== 'end', durations: durationValues(r),
      processes: { inspection: r.boundary !== 'end' ? null : r.offsets.inspectStarted === undefined ? 0 : 1, inference: r.boundary !== 'end' ? null : r.offsets.inferenceStarted === undefined ? 0 : 1 } }));
    return { enabled: this.enabled, available: this.enabled && !this.failed && !readFailed, dropped: this.dropped, corrupt,
      warnings: [...(this.failed || readFailed ? ['Diagnostic storage unavailable.'] : []), ...(this.dropped ? ['Records were dropped in this process.'] : []),
        ...(corrupt ? ['Corrupt records skipped; source files were not repaired.'] : []), ...(values.some(r => r.incomplete) ? ['Incomplete records have no observed end time.'] : []),
        ...(!this.enabled ? ['Measurement disabled; retained records remain readable.'] : []), 'Only retained files are covered; no historical backfill.'], records: values };
  }
}
function isMissing(e: unknown) { return !!e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT'; }
export function percentile(values: number[], percent: number) { return values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * percent) - 1]! : null; }
function reportStatistics(samples: PerformanceView['records']) {
  const metrics = [...Object.keys(durations), 'waitSharePercent', 'generationSharePercent', 'codexPreparationSharePercent'];
  return Object.fromEntries(metrics.map(name => {
    const values = samples.map(r => {
      if ((name === 'waitFirstReply' || name === 'waitSharePercent') && r.textMode !== 'stream') return null;
      if (name.endsWith('SharePercent')) {
        const part = r.durations[name === 'waitSharePercent' ? 'waitFirstReply' : name === 'generationSharePercent' ? 'generation' : 'codexPreparation'];
        return part !== null && r.durations.total !== null && r.durations.total > 0 ? 100 * part / r.durations.total : null;
      }
      return r.durations[name as keyof typeof durations];
    }).filter((n): n is number => n !== null);
    return [name, { valid: values.length, missing: samples.length - values.length, p50: percentile(values, .5), p90: values.length >= 20 ? percentile(values, .9) : null }];
  }));
}
export function performanceReport(view: PerformanceView, backend: 'live' | 'fake' = 'live') {
  const retained = view.records.filter(r => r.backend === backend);
  const turns = view.records.filter(r => r.kind === 'turn' && r.backend === backend);
  const groups = new Map<string, typeof turns>();
  for (const r of turns) {
    const key = JSON.stringify({ provider: r.provider, participant: r.participant ?? null, cliVersion: r.cliVersion, model: r.model, effort: r.effort, research: r.research, purpose: r.purpose, session: r.session, inputBucket: r.characters === null ? 'unknown' : r.characters < 8000 ? '<8000' : r.characters < 32000 ? '8000–31999' : '>=32000' });
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const executions = view.records.filter(r => r.kind === 'execution' && r.backend === backend);
  return { version: 1, backend, operations: { samples: executions.length, success: reportStatistics(executions.filter(r => !r.incomplete && r.outcome === 'success')), failure: reportStatistics(executions.filter(r => !r.incomplete && r.outcome !== 'success')), incomplete: executions.filter(r => r.incomplete).length, records: executions }, generatedAt: new Date().toISOString(), range: { from: retained.at(0)?.at ?? null, to: retained.at(-1)?.at ?? null },
    integrity: { available: view.available, dropped: view.dropped, corrupt: view.corrupt, warnings: view.warnings }, samples: turns.length, dataStatus: turns.length ? 'Directional interpretation is gated per comparison group.' : 'Insufficient data: no retained live samples.',
    usageScope: 'Only adapter-observed provider usage; subfields are not added to totals. Internal CLI requests and billing are unknown.',
    groups: [...groups].map(([key, rows]) => {
      const success = rows.filter(r => !r.incomplete && r.outcome === 'success' && (r.purpose === 'monitor' ? r.diagnosticsSaved === true : r.answerSaved === true) && r.offsets.cleanupEnd !== undefined);
      const eligible = success.length >= 20 && rows[0]?.cliVersion !== null && rows[0]?.model !== null && new Set(success.map(r => r.discussionId)).size >= 3;
      const prep = success.map(r => r.durations.codexPreparation).filter((n): n is number => n !== null);
      const ratios = success.map(r => r.durations.codexPreparation !== null && r.durations.total && r.durations.total > 0 ? r.durations.codexPreparation / r.durations.total : null).filter((n): n is number => n !== null);
      const reuse = eligible && rows[0]?.provider === 'codex' && prep.length >= 20 && ratios.length >= 20 && percentile(prep, .5)! >= 1000 && percentile(ratios, .5)! >= .2;
      return { labels: JSON.parse(key) as { provider: string; participant: string | null; cliVersion: string | null; model: string | null; effort: string | null; research: boolean; purpose: string; session: string | null; inputBucket: string }, samples: rows.length, completeSuccess: success.length, discussions: new Set(success.map(r => r.discussionId)).size,
        success: reportStatistics(success), failure: reportStatistics(rows.filter(r => !r.incomplete && r.outcome !== 'success')), incomplete: rows.filter(r => r.incomplete).length,
        outcomes: Object.fromEntries([...new Set(rows.map(r => r.incomplete ? 'incomplete' : r.outcome!))].map(o => [o, rows.filter(r => (r.incomplete ? 'incomplete' : r.outcome) === o).length])),
        interpretation: eligible ? reuse ? 'Investigate Codex process reuse separately; this threshold does not estimate savings.' : 'Observed timings only; no attribution to upstream or automatic context changes.' : 'Insufficient data for directional interpretation (20 complete successful turns, 3 discussions and known CLI/model required).',
        trend: rows.map(r => ({ discussionId: r.discussionId, requestId: r.requestId, at: r.at, round: r.round, position: r.position, characters: r.characters, usage: r.usage, usageSource: r.usageSource, textMode: r.textMode, outcome: r.outcome, incomplete: r.incomplete })) };
    }) };
}
export function performanceMarkdown(report: ReturnType<typeof performanceReport>) {
  return `# CandC performance baseline v${report.version}\n\nBackend: ${report.backend}\nGenerated: ${report.generatedAt}\nRange: ${report.range.from ?? 'unknown'} — ${report.range.to ?? 'unknown'}\nSamples: ${report.samples}\nDropped: ${report.integrity.dropped}; corrupt: ${report.integrity.corrupt}\n\n${report.dataStatus}\n\n${report.usageScope}\n\n${report.integrity.warnings.join('\n')}\n\n## Start / resume operations\n\n\`\`\`json\n${JSON.stringify(report.operations, null, 2)}\n\`\`\`\n\n` +
    report.groups.map(g => `## ${JSON.stringify(g.labels)}\n\n${g.interpretation}\n\n| Result | Metric (ms, or percent for SharePercent) | Valid | Missing | p50 | p90 (n>=20) |\n|---|---|---:|---:|---:|---:|\n` +
      (['success', 'failure'] as const).flatMap(result => Object.entries(g[result]).map(([metric, s]) => `| ${result} | ${metric} | ${s.valid} | ${s.missing} | ${s.p50 ?? 'unknown'} | ${s.p90 ?? 'insufficient data'} |`)).join('\n') +
      `\n\nOutcomes: ${JSON.stringify(g.outcomes)}\n\n### Raw turn trend\n\n\`\`\`json\n${JSON.stringify(g.trend, null, 2)}\n\`\`\``).join('\n\n');
}
