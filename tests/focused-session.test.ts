import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AgentAdapter } from '../src/adapters/types.js';
import { FakeAdapter } from '../src/adapters/fake.js';
import { DiscussionController } from '../src/controller.js';
import { CONTROL_START, CONTROL_END } from '../src/focused.js';
import { input, setup, waitUntil } from './helpers.js';

describe('uncertain session lifecycle', () => {
  it('honors a stop queued before the final answer acquires the commit lock', async () => {
    let finish!: () => void, released!: () => void, finished!: () => void;
    const answerGate = new Promise<void>(resolve => { finish = resolve; });
    const commitGate = new Promise<void>(resolve => { released = resolve; });
    const providerDone = new Promise<void>(resolve => { finished = resolve; });
    let held = false;
    const codex: AgentAdapter = { id: 'codex', backend: 'fake', async *run(req) {
      yield { type: 'session', session: { id: 'native-stop-race', model: req.settings.model, backend: 'fake' } };
      yield { type: 'delta', text: 'Partial public answer\n' };
      await answerGate;
      const t = req.contract!.taskCard;
      yield { type: 'completed', model: req.settings.model, text: `Public answer\n${CONTROL_START}\n${JSON.stringify({ version: 2, issueId: t.issueId, issueVersion: t.issueVersion, taskVersion: t.version, continuation: 'yield', action: { type: 'none' } })}\n${CONTROL_END}` };
      finished();
    } };
    const ctx = await setup({ codex, claude: new FakeAdapter('claude') });
    const original = ctx.store.commit.bind(ctx.store);
    const spy = vi.spyOn(ctx.store, 'commit').mockImplementation(async (state, event) => {
      if (event.data.configured) { held = true; await commitGate; }
      return original(state, event);
    });
    try {
      const id = randomUUID(); await ctx.controller.create(id, input({ behaviorVersion: 2 }));
      await ctx.controller.start(id, randomUUID());
      await waitUntil(() => ctx.controller.get(id).v2!.calls[0]?.provisionalSessionId === 'native-stop-race');
      const config = ctx.controller.configure(id, { mode: 'auto', expectedVersion: 1 });
      await waitUntil(() => held);
      const stop = ctx.controller.stop(id);
      finish(); await providerDone;
      // Let protocol completion enqueue the final commit while the earlier configuration holds the lock.
      await new Promise<void>(resolve => setImmediate(resolve));
      released(); await config; await stop; await ctx.controller.wait(id);
      const state = ctx.controller.get(id);
      expect(state.status).toBe('stopped');
      expect(state.v2!.calls[0]!.status).toBe('failed');
      expect(state.v2!.receipts[0]!.status).toBe('uncertain');
      expect(state.messages.at(-1)!.status).toBe('cancelled');
      expect(state.sessions).toEqual({});
      await expect(ctx.controller.fork(id, randomUUID())).rejects.toMatchObject({ code: 'INVALID_STATE' });
    } finally { finish(); released(); spy.mockRestore(); await ctx.cleanup(); }
  });
  it.each(['timeout', 'cleanup', 'identity', 'cancel'] as const)('does not advance receipts after %s and requires explicit rebuild', async failure => {
    let run = 0;
    const codex: AgentAdapter = { id: 'codex', backend: 'fake', async *run(req) {
      run++;
      if (failure === 'identity' && run === 1) { yield* new FakeAdapter('codex').run(req); return; }
      yield { type: 'session', session: { id: req.session ? 'wrong-session' : 'native-test', model: req.settings.model, backend: 'fake' } };
      yield { type: 'delta', text: 'Partial public answer\n' };
      if (failure === 'timeout' || failure === 'cancel') { await new Promise(resolve => setTimeout(resolve, 90)); req.signal.throwIfAborted(); }
      const t = req.contract!.taskCard;
      yield { type: 'completed', model: req.settings.model, text: `Public answer\n${CONTROL_START}\n${JSON.stringify({ version: 2, issueId: t.issueId, issueVersion: t.issueVersion, taskVersion: t.version, continuation: 'yield', action: { type: 'none' } })}\n${CONTROL_END}` };
      if (failure === 'cleanup') throw new Error('cleanup failed');
    } };
    const ctx = await setup({ codex, claude: new FakeAdapter('claude', undefined, 0) });
    try {
      const id = randomUUID(); await ctx.controller.create(id, input({ behaviorVersion: 2, limits: { maxRounds: 10, maxDurationMs: 30_000, turnTimeoutMs: failure === 'timeout' ? 50 : 2_000 } }));
      await ctx.controller.start(id, randomUUID());
      if (failure === 'cancel') { await waitUntil(() => ctx.controller.get(id).v2!.calls[0]?.provisionalSessionId === 'native-test'); await ctx.controller.stop(id); }
      await ctx.controller.wait(id);
      if (failure === 'identity') { await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id); }
      const state = ctx.controller.get(id), last = state.v2!.calls.findLast(c => c.agent === 'codex')!;
      expect(last.status).toBe('failed');
      expect(state.v2!.receipts.find(r => r.generation === last.snapshot.generation)!.status).toBe('uncertain');
      expect(state.messages.find(m => m.id === last.messageId)!.status).not.toBe('completed');
      await expect(ctx.controller.start(id, randomUUID())).rejects.toThrow();
      const operationId = randomUUID();
      const rebuilt = await ctx.controller.rebuild(id, operationId, state.v2!.taskVersion);
      expect(rebuilt.sessions).toEqual({});
      expect(rebuilt.elapsedMs).toBe(state.elapsedMs); expect(rebuilt.round).toBe(state.round);
      expect(rebuilt.v2!.receipts.every(r => r.status === 'retired')).toBe(true);
      expect(await ctx.controller.rebuild(id, operationId, state.v2!.taskVersion)).toEqual(rebuilt);
    } finally { await ctx.cleanup(); }
  });
  it('never resumes a valid older session when a prepared call remained unfinished at restart', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID(); await ctx.controller.create(id, input({ behaviorVersion: 2 }));
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const state = ctx.controller.get(id), original = state.v2!.calls[0]!;
      const call = { ...original, requestId: randomUUID(), messageId: randomUUID(), status: 'prepared' as const };
      const sequence = state.sequence + 1;
      await ctx.store.commit({ ...state, status: 'running', activity: 'discussion', sequence, v2: { ...state.v2!, calls: [...state.v2!.calls, call] } },
        { sequence, discussionId: id, type: 'state', at: state.createdAt, data: {}, commitId: randomUUID() });
      const restarted = new DiscussionController(ctx.store, { codex: new FakeAdapter('codex'), claude: new FakeAdapter('claude') });
      await restarted.initialize();
      expect(restarted.get(id).status).toBe('indeterminate');
      await expect(restarted.start(id, randomUUID())).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
      expect(restarted.get(id).v2!.calls).toHaveLength(3);
      await restarted.close();
    } finally { await ctx.cleanup(); }
  });
});
