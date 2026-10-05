import { afterEach, describe, expect, it, vi } from 'vitest';
import * as focused from '../src/focused.js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { DiscussionController } from '../src/controller.js';
import { DiscussionStore, type StorageFault } from '../src/store.js';
import { FakeAdapter } from '../src/adapters/fake.js';
import { buildPrompt, type AgentAdapter, type AgentEvent, type TurnRequest } from '../src/adapters/types.js';
import { PerformanceStore, type PerformanceIO } from '../src/performance.js';
import { AppError } from '../src/domain.js';
import { createServer } from '../src/server.js';
import { input } from './helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function setup(enabled = true, io?: PerformanceIO, fault?: StorageFault, custom?: AgentAdapter) {
  const dir = await mkdtemp(path.resolve('.cache/performance-controller-'));
  const prompts: string[] = [], calls: string[] = [];
  const wrap = (id: 'codex' | 'claude'): AgentAdapter => {
    const fake = new FakeAdapter(id, undefined, 0);
    return { id, backend: 'fake', async *run(request) {
      calls.push(id); prompts.push(buildPrompt(request));
      request.observePerformance?.('researchStart'); request.observePerformance?.('researchEnd'); request.observePerformance?.('requestSent');
      for await (const event of fake.run(request)) {
        if (event.type === 'completed') request.observePerformance?.('protocolComplete');
        yield event;
      }
      request.observePerformance?.('cleanupStart'); request.observePerformance?.('cleanupEnd');
    } };
  };
  const performance = new PerformanceStore(path.join(dir, 'performance'), enabled, undefined, io);
  const store = new DiscussionStore(dir, fault);
  const controller = new DiscussionController(store, { codex: custom ?? wrap('codex'), claude: wrap('claude') }, undefined, undefined, performance);
  const id = randomUUID(); await controller.initialize(); await controller.create(id, input({ behaviorVersion: 2 }));
  cleanups.push(async () => { await controller.close(); await rm(dir, { recursive: true, force: true }); });
  return { id, dir, store, controller, performance, calls, prompts };
}
const normalize = (value: unknown) => JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID');
describe('controller sidecar isolation', () => {
  it('does not count concurrent or later idempotent start retries as executions', async () => {
    const ctx = await setup(), operationId = randomUUID();
    await Promise.all([ctx.controller.start(ctx.id, operationId), ctx.controller.start(ctx.id, operationId)]);
    await ctx.controller.wait(ctx.id); await ctx.controller.start(ctx.id, operationId); await ctx.performance.close();
    const view = await ctx.performance.view(ctx.id);
    expect(view.records.filter(r => r.kind === 'execution')).toHaveLength(1);
    expect(view.records.some(r => r.incomplete)).toBe(false); expect(ctx.calls).toHaveLength(2);
  });
  it.each([1, 2] as const)('records storage uncertainty after v%s input selection fails', async behaviorVersion => {
    const fault: StorageFault = async (stage, _handle, payload) => {
      if (stage === 'beforeAppend' && payload.includes('fixture context limit')) throw new Error('fixture pause commit failed');
    };
    const ctx = await setup(true, undefined, fault);
    if (behaviorVersion === 1) {
      const id = randomUUID(); await ctx.controller.create(id, input()); ctx.id = id;
      vi.spyOn(ctx.controller as unknown as { context(): never }, 'context').mockImplementation(() => { throw new AppError('CONTEXT_LIMIT', 'fixture context limit'); });
    } else vi.spyOn(focused, 'selectInput').mockImplementation(() => { throw new AppError('CONTEXT_LIMIT', 'fixture context limit'); });
    await ctx.controller.start(ctx.id, randomUUID()); await ctx.controller.wait(ctx.id).catch(() => undefined); await ctx.performance.close();
    const turn = (await ctx.performance.view(ctx.id)).records.find(r => r.kind === 'turn')!;
    expect(turn.outcome).toBe('storage-unknown'); expect(ctx.controller.get(ctx.id).storage?.status).toBe('unconfirmed');
    expect(ctx.calls).toHaveLength(0);
  });
  it('keeps failed post-result exit validation a cleanup failure even when final close succeeds', async () => {
    const custom: AgentAdapter = { id: 'codex', backend: 'fake', async *run(request) {
      yield { type: 'session', session: { id: 'fixture', model: request.settings.model, backend: 'fake' } };
      request.observePerformance?.('protocolComplete');
      request.observePerformance?.('cleanupStart'); request.observePerformance?.('failureObserved'); request.observePerformance?.('cleanupEnd');
      throw new AppError('PROCESS_EXIT', 'scripted failed exit validation');
    } };
    const ctx = await setup(true, undefined, undefined, custom);
    await ctx.controller.start(ctx.id, randomUUID()); await ctx.controller.wait(ctx.id); await ctx.performance.close();
    const turn = (await ctx.performance.view(ctx.id)).records.find(r => r.kind === 'turn')!;
    expect(turn.outcome).toBe('cleanup-error'); expect(turn.failurePhase).toBe('cleanupStart'); expect(turn.answerSaved).toBeNull();
  });
  it('measures one preflight per execution, keeps CLI versions, and resumes sessions on a later execution', async () => {
    const dir = await mkdtemp(path.resolve('.cache/performance-preflight-'));
    const performance = new PerformanceStore(path.join(dir, 'performance'), true);
    const adapter = (id: 'codex' | 'claude'): AgentAdapter => {
      const fake = new FakeAdapter(id, undefined, 0);
      return { id, backend: 'live', async *run(request) {
        request.observePerformance?.('requestSent');
        for await (const event of fake.run({ ...request, session: request.session ? { ...request.session, backend: 'fake' } : undefined })) {
          if (event.type === 'session') yield { ...event, session: { ...event.session, backend: 'live' } };
          else yield event;
        }
        request.observePerformance?.('cleanupEnd');
      } };
    };
    let preflights = 0;
    const controller = new DiscussionController(new DiscussionStore(dir), { codex: adapter('codex'), claude: adapter('claude') }, undefined,
      async (_state, observer) => {
        preflights++; observer?.('loginStart'); for (let i = 0; i < 4; i++) observer?.('loginProcessStarted'); observer?.('loginEnd');
        observer?.('catalogStart'); observer?.('catalogProcessStarted'); observer?.('catalogEnd');
        return { codex: 'fixture-1', claude: 'fixture-2' };
      }, performance);
    cleanups.push(async () => { await controller.close(); await rm(dir, { recursive: true, force: true }); });
    const id = randomUUID(); await controller.create(id, input({ behaviorVersion: 2, backend: 'live' }));
    for (let i = 0; i < 2; i++) { await controller.start(id, randomUUID()); await controller.wait(id); }
    await performance.close(); const view = await performance.view(id);
    expect(preflights).toBe(2); expect(view.records.filter(r => r.kind === 'execution')).toHaveLength(2);
    expect(view.records.filter(r => r.kind === 'execution').every(r => r.preflightProcesses === 5 && r.cliVersions?.codex === 'fixture-1')).toBe(true);
    const turns = view.records.filter(r => r.kind === 'turn');
    expect(turns.map(r => r.session)).toEqual(['new', 'new', 'resumed', 'resumed']);
    expect(turns.every(r => r.durations.login === null && r.durations.catalog === null)).toBe(true);
    expect(turns.map(r => r.cliVersion)).toEqual(['fixture-1', 'fixture-2', 'fixture-2', 'fixture-1']);
  });
  it('keeps prompts, scheduling, receipts and journal commits identical when disabled or storage fails', async () => {
    const results: unknown[] = [];
    for (const mode of ['disabled', 'enabled', 'failed'] as const) {
      const ctx = await setup(mode !== 'disabled', mode === 'failed' ? { append: async () => { throw new Error('disk failed'); } } : undefined);
      await ctx.controller.start(ctx.id, randomUUID()); await ctx.controller.wait(ctx.id); await ctx.performance.close();
      const state = ctx.controller.get(ctx.id), events = await ctx.controller.events(ctx.id);
      results.push({ prompts: ctx.prompts.map(normalize), calls: ctx.calls, receipts: state.v2!.receipts.map(r => ({ agent: r.agent, status: r.status, messages: r.messages.length, evidence: r.evidence.length })),
        messages: state.messages.map(m => ({ text: m.text, sender: m.sender, status: m.status })), status: state.status, events: events.map(e => ({ type: e.type, sequence: e.sequence })) });
      const view = await ctx.controller.performanceView(ctx.id);
      if (mode === 'enabled') { expect(view.records).toHaveLength(3); expect(view.records.filter(r => r.kind === 'turn').every(r => r.answerSaved && r.diagnosticsSaved)).toBe(true); }
      if (mode === 'failed') expect(view.available).toBe(false);
      // Restart must read the original strict journal without migration or diagnostic writes.
      const before = await readFile(path.join(ctx.dir, `${ctx.id}.jsonl`), 'utf8');
      const restarted = new DiscussionController(new DiscussionStore(ctx.dir), { codex: new FakeAdapter('codex'), claude: new FakeAdapter('claude') });
      await restarted.initialize(); expect(restarted.get(ctx.id)).toEqual(state); await restarted.close();
      expect(await readFile(path.join(ctx.dir, `${ctx.id}.jsonl`), 'utf8')).toBe(before);
    }
    expect(results[1]).toEqual(results[0]); expect(results[2]).toEqual(results[0]);
  });
  it.each(['answer', 'diagnostics'] as const)('records %s commit uncertainty without changing the storage barrier', async boundary => {
    let armed = false, successfulAnswer = false;
    const fault: StorageFault = async (stage, _handle, payload) => {
      if (!armed || stage !== 'beforeAppend') return;
      if (payload.includes('"type":"message"')) { if (boundary === 'answer') throw new Error('injected'); successfulAnswer = true; }
      else if (boundary === 'diagnostics' && successfulAnswer && payload.includes('committedRequestId')) throw new Error('injected diagnostic commit');
    };
    const ctx = await setup(true, undefined, fault); armed = true;
    await ctx.controller.start(ctx.id, randomUUID()); await ctx.controller.wait(ctx.id); await ctx.performance.close();
    const view = await ctx.performance.view(ctx.id), turn = view.records.find(r => r.kind === 'turn')!;
    expect(turn.outcome).toBe('storage-unknown'); expect(turn.answerSaved).toBe(boundary === 'diagnostics' ? true : null);
    expect(turn.diagnosticsSaved).toBeNull(); expect(ctx.controller.get(ctx.id).storage?.status).toBe('unconfirmed'); expect(ctx.calls).toHaveLength(1);
    armed = false;
  });
  it.each(['startup', 'protocol', 'cleanup', 'timeout', 'cancelled'] as const)('classifies %s and missing phases without fabricating durations', async scenario => {
    let invoked = 0;
    const custom: AgentAdapter = { id: 'codex', backend: 'fake', async *run(request: TurnRequest): AsyncGenerator<AgentEvent> {
      invoked++;
      if (scenario === 'startup') throw new AppError('PROCESS_START', 'fixture');
      request.observePerformance?.('requestSent');
      if (scenario === 'protocol') throw new AppError('INVALID_PROTOCOL', 'fixture');
      if (scenario === 'timeout' || scenario === 'cancelled') {
        await new Promise<void>(resolve => request.signal.addEventListener('abort', () => resolve(), { once: true })); request.signal.throwIfAborted();
      }
      yield { type: 'session', session: { id: 'fixture', backend: 'fake', model: request.settings.model } };
      yield { type: 'completed', text: 'Public answer', model: request.settings.model };
      request.observePerformance?.('cleanupStart'); throw new Error('fixture cleanup failure');
    } };
    const ctx = await setup(true, undefined, undefined, custom);
    if (scenario === 'timeout') await ctx.controller.configure(ctx.id, { expectedVersion: ctx.controller.get(ctx.id).v2!.configurationVersion, limits: { ...ctx.controller.get(ctx.id).limits, turnTimeoutMs: 50 } });
    await ctx.controller.start(ctx.id, randomUUID());
    if (scenario === 'cancelled') await ctx.controller.stop(ctx.id);
    await ctx.controller.wait(ctx.id); await ctx.performance.close();
    const r = (await ctx.performance.view(ctx.id)).records.find(r => r.kind === 'turn')!;
    expect(r.outcome).toBe({ startup: 'startup-error', protocol: 'protocol-error', cleanup: 'cleanup-error', timeout: 'timeout', cancelled: 'cancelled' }[scenario]);
    expect(r.durations.rpc).toBeNull(); expect(r.answerSaved).toBeNull(); expect(invoked).toBe(1);
  });
  it('protects GET/export with existing auth and never starts adapters or preflight checks', async () => {
    const ctx = await setup(), server = createServer(ctx.controller, { accessToken: 'fixture-token' });
    const headers = { host: '127.0.0.1:4317', authorization: 'Bearer fixture-token' };
    for (const url of [`/api/discussions/${ctx.id}/performance`, '/api/performance/report?format=json', '/api/performance/report?format=markdown']) {
      expect((await server.inject({ url, headers: { host: headers.host } })).statusCode).toBe(401);
      expect((await server.inject({ url, headers: { ...headers, origin: 'https://evil.example' } })).statusCode).toBe(403);
      expect((await server.inject({ url, headers: { ...headers, host: 'evil.example' } })).statusCode).toBe(403);
      expect((await server.inject({ url, headers })).statusCode).toBe(200);
    }
    expect((await server.inject({ url: '/api/performance/report?format=json&path=data', headers })).statusCode).toBe(400);
    const report = await server.inject({ url: '/api/performance/report?format=json', headers }); expect(report.json().samples).toBe(0);
    expect(ctx.calls).toHaveLength(0); await server.close();
  });
});
