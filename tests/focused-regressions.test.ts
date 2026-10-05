import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FakeAdapter } from '../src/adapters/fake.js';
import type { AgentAdapter, TurnRequest } from '../src/adapters/types.js';
import { DiscussionController } from '../src/controller.js';
import { CONTROL_START, CONTROL_END } from '../src/focused.js';
import { createServer } from '../src/server.js';
import type { StorageFault } from '../src/store.js';
import type { Control } from '../src/v2-contract.js';
import { input, setup, waitUntil } from './helpers.js';

const focusedInput = () => input({ behaviorVersion: 2, mode: 'manual', flow: 'alternating',
  limits: { maxRounds: 10, maxDurationMs: 30_000, turnTimeoutMs: 2_000 } });
function envelope(request: TurnRequest, action: Control['action'] = { type: 'none' }, references?: unknown[]) {
  const card = request.contract!.taskCard;
  return `Public answer.\n${CONTROL_START}\n${JSON.stringify({ version: 2, issueId: card.issueId, issueVersion: card.issueVersion,
    taskVersion: card.version, continuation: 'yield', action, ...(references ? { annotation: { references } } : {}) })}\n${CONTROL_END}`;
}
async function pair(controller: DiscussionController, id: string, purpose: 'discussion' | 'summary' = 'discussion') {
  await controller.start(id, randomUUID(), purpose); await controller.wait(id);
}
function blockedAdapters(gate?: () => Promise<void>) {
  let turns = 0;
  const codex = new FakeAdapter('codex', request => turns === 1 ? envelope(request, { type: 'propose', outcome: 'blocked',
    result: 'Needs observation.', conditions: 'Supplied facts.', unresolved: ['Observation'], blocking: false }) : envelope(request), 0);
  const adapter: AgentAdapter = { id: 'codex', backend: 'fake', async *run(request) {
    if (++turns === 3) await gate?.();
    yield* codex.run(request);
  } };
  return { codex: adapter, claude: new FakeAdapter('claude', request => {
    const proposal = request.contract!.taskCard.proposal;
    return envelope(request, proposal ? { type: 'confirm', proposalId: proposal.id, proposalVersion: proposal.version } : { type: 'none' });
  }, 0) };
}

describe('focused review regressions', () => {
  it.each(['paused', 'running'] as const)('switches away from a confirmed blocked issue while %s without losing a completed answer', async status => {
    let release!: () => void, held = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ctx = await setup(blockedAdapters(async () => { held = true; await gate; }));
    try {
      const id = randomUUID(); await ctx.controller.create(id, focusedInput());
      await pair(ctx.controller, id); await pair(ctx.controller, id);
      let state = ctx.controller.get(id); const old = state.v2!.issues[0]!;
      expect(old.status).toBe('blocked'); expect(old.confirmation).not.toBeNull();
      const next = randomUUID();
      state = await ctx.controller.issueAction(id, randomUUID(), state.v2!.taskVersion, 'add', next, 'Next issue');
      const messages = state.messages.length;
      if (status === 'running') { await ctx.controller.start(id, randomUUID()); await waitUntil(() => held); }
      state = ctx.controller.get(id);
      await ctx.controller.issueAction(id, randomUUID(), state.v2!.taskVersion, 'select', next);
      if (status === 'running') { release(); await ctx.controller.wait(id); }
      state = ctx.controller.get(id);
      expect(state.storage).toBeUndefined(); expect(state.v2!.currentIssueId).toBe(next);
      expect(state.v2!.issues[0]).toMatchObject({ status: 'pending', result: old.result, unresolved: old.unresolved });
      expect(state.v2!.issues.filter(issue => ['active', 'blocked'].includes(issue.status)).map(issue => issue.id)).toEqual([next]);
      expect(state.messages).toHaveLength(messages + (status === 'running' ? 2 : 0));
      if (status === 'running') {
        expect(state.messages[messages]!.issueId).toBe(old.id);
        expect(state.v2!.calls.slice(-2).every(call => call.status === 'completed')).toBe(true);
      }
      expect((await ctx.store.records(id)).at(-1)!.state).toEqual(JSON.parse(JSON.stringify(state)));
    } finally { release(); await ctx.cleanup(); }
  });

  it('rejects invalid state through the real store without an append, storage barrier or recovery requirement', async () => {
    const ctx = await setup(), server = createServer(ctx.controller, { accessToken: 'fixture-token' });
    const original = ctx.store.commit.bind(ctx.store);
    try {
      const id = randomUUID(), state = await ctx.controller.create(id, focusedInput());
      const file = path.join(ctx.directory, `${id}.jsonl`), before = await readFile(file);
      const spy = vi.spyOn(ctx.store, 'commit').mockImplementationOnce((updated, event) =>
        original({ ...updated, v2: { ...updated.v2!, currentIssueId: null } }, event));
      const response = await server.inject({ method: 'PATCH', url: `/api/discussions/${id}`,
        headers: { host: '127.0.0.1:4317', authorization: 'Bearer fixture-token' },
        payload: { expectedVersion: state.v2!.configurationVersion, goal: 'Changed goal' } });
      spy.mockRestore();
      expect(response.statusCode).toBe(409); expect(response.json().error).toBe('INVALID_STATE');
      expect(ctx.store.isBlocked(id)).toBe(false); expect(ctx.controller.get(id)).toEqual(state);
      expect(await readFile(file)).toEqual(before);
      await ctx.controller.configure(id, { expectedVersion: state.v2!.configurationVersion, goal: 'Valid update' });
      await pair(ctx.controller, id);
      expect(ctx.controller.get(id).v2!.calls.every(call => call.status === 'completed')).toBe(true);
    } finally { vi.restoreAllMocks(); await server.close(); await ctx.cleanup(); }
  });

  it.each(['manual', 'auto', 'summary'] as const)('preserves a stop queued during the final commit in %s execution', async mode => {
    const id = randomUUID(); let controller!: DiscussionController, stop: Promise<unknown> | undefined, commits = 0;
    const fault: StorageFault = async (stage, _handle, payload) => {
      if (stage === 'sync' && payload.includes('"type":"message"') && ++commits === 2) stop = controller.stop(id);
    };
    const ctx = await setup({ codex: new FakeAdapter('codex', request => envelope(request), 0),
      claude: new FakeAdapter('claude', request => envelope(request), 0) }, fault);
    controller = ctx.controller;
    try {
      await controller.create(id, { ...focusedInput(), mode: mode === 'auto' ? 'auto' : 'manual' });
      await pair(controller, id, mode === 'summary' ? 'summary' : 'discussion'); await stop;
      const state = controller.get(id);
      expect(state).toMatchObject({ status: 'stopped', pauseReason: 'Stopped by user.', round: 1, activity: null });
      expect(state.v2!.calls).toHaveLength(2); expect(state.v2!.calls.every(call => call.status === 'completed')).toBe(true);
      expect((await ctx.store.records(id)).at(-1)!.state.status).toBe('stopped');
      await expect(controller.start(id, randomUUID())).rejects.toMatchObject({ code: 'STOPPED' });
    } finally { await ctx.cleanup(); }
  });

  it('checks every requirement addressed by the same peer answer', async () => {
    let users: string[] = [], answer = '', codexTurns = 0, claudeTurns = 0;
    const ctx = await setup({ codex: new FakeAdapter('codex', request => {
      if (codexTurns++ !== 1) return envelope(request);
      answer = request.messageId;
      return envelope(request, { type: 'none' }, users.map(messageId => ({ messageId, disposition: 'addressed', reason: 'Answered.' })));
    }, 0), claude: new FakeAdapter('claude', request => envelope(request, { type: 'none' }, claudeTurns++ === 2 ?
      [{ messageId: answer, disposition: 'checked', reason: 'Peer checked.' }] : undefined), 0) });
    try {
      const id = randomUUID(); await ctx.controller.create(id, focusedInput()); await pair(ctx.controller, id);
      users = [randomUUID(), randomUUID()];
      for (const messageId of users) await ctx.controller.send(id, messageId, 'Independent requirement.', 'both');
      await pair(ctx.controller, id); await pair(ctx.controller, id);
      const requests = (await ctx.store.records(id)).at(-1)!.state.v2!.requests.filter(request => users.includes(request.messageId));
      expect(requests.map(request => request.status)).toEqual(['checked', 'checked']);
      expect(requests.every(request => request.responseId === answer)).toBe(true);
    } finally { await ctx.cleanup(); }
  });

  it.each(['unresolved', 'checked'] as const)('preserves human disposal against a later %s model annotation', async disposition => {
    let topic = '', answer = '', codexTurns = 0, claudeTurns = 0;
    const ctx = await setup({ codex: new FakeAdapter('codex', request => {
      if (codexTurns++ === 0) { answer = request.messageId; topic = request.context[0]!.id;
        return envelope(request, { type: 'none' }, [{ messageId: topic, disposition: 'addressed', reason: 'Answered.' }]); }
      return envelope(request);
    }, 0), claude: new FakeAdapter('claude', request => envelope(request, { type: 'none' }, claudeTurns++ === 1 ?
      [{ messageId: disposition === 'checked' ? answer : topic, disposition, reason: 'Model annotation.' }] : undefined), 0) });
    try {
      const id = randomUUID(); await ctx.controller.create(id, focusedInput()); await pair(ctx.controller, id);
      const state = ctx.controller.get(id);
      expect(state.v2!.requests[0]).toMatchObject({ status: 'addressed', responseId: answer });
      const reason = 'Human accepted the remaining limitation.';
      await ctx.controller.issueAction(id, randomUUID(), state.v2!.taskVersion, 'dispose', topic, reason);
      await pair(ctx.controller, id);
      expect((await ctx.store.records(id)).at(-1)!.state.v2!.requests.find(request => request.messageId === topic)).toMatchObject({ status: 'disposed', reason });
    } finally { await ctx.cleanup(); }
  });

  it('keeps a checked requirement closed when its author later marks it unresolved', async () => {
    let topic = '', answer = '', codexTurns = 0, claudeTurns = 0;
    const ctx = await setup({ codex: new FakeAdapter('codex', request => {
      if (codexTurns++ === 0) { answer = request.messageId; topic = request.context[0]!.id;
        return envelope(request, { type: 'none' }, [{ messageId: topic, disposition: 'addressed', reason: 'Answered.' }]); }
      return envelope(request, { type: 'none' }, [{ messageId: topic, disposition: 'unresolved', reason: 'Reopened.' }]);
    }, 0), claude: new FakeAdapter('claude', request => envelope(request, { type: 'none' }, claudeTurns++ === 1 ?
      [{ messageId: answer, disposition: 'checked', reason: 'Peer checked.' }] : undefined), 0) });
    try {
      const id = randomUUID(); await ctx.controller.create(id, focusedInput()); await pair(ctx.controller, id); await pair(ctx.controller, id);
      expect((await ctx.store.records(id)).at(-1)!.state.v2!.requests[0]).toMatchObject({ status: 'checked', reason: 'Peer checked.' });
    } finally { await ctx.cleanup(); }
  });

  it('preserves proposal confirmation and versions on identical settings, and invalidates them only for changed task content', async () => {
    const ctx = await setup(blockedAdapters());
    try {
      const id = randomUUID(); await ctx.controller.create(id, focusedInput()); await pair(ctx.controller, id); await pair(ctx.controller, id);
      const before = ctx.controller.get(id);
      expect(before.v2!.issues[0]!.confirmation).not.toBeNull();
      const same = await ctx.controller.configure(id, { expectedVersion: before.v2!.configurationVersion, goal: before.goal, constraints: before.constraints });
      expect(same).toEqual(before);
      const mode = await ctx.controller.configure(id, { expectedVersion: same.v2!.configurationVersion, mode: 'auto', goal: same.goal, constraints: same.constraints });
      expect(mode.v2!.issues).toEqual(before.v2!.issues);
      const changed = await ctx.controller.configure(id, { expectedVersion: mode.v2!.configurationVersion, goal: 'A different goal' });
      expect(changed.v2!.issues[0]).toMatchObject({ version: before.v2!.issues[0]!.version + 1, proposal: null, confirmation: null });
      expect((await ctx.store.records(id)).at(-1)!.state).toEqual(JSON.parse(JSON.stringify(changed)));
    } finally { await ctx.cleanup(); }
  });

  it.each(['stopped', 'indeterminate'] as const)('preserves %s when summary input exceeds the complete payload limit', async status => {
    const ctx = await setup();
    try {
      const id = randomUUID(), initial = await ctx.controller.create(id, focusedInput());
      await ctx.store.commit({ ...initial, status, sequence: initial.sequence + 1, messages: [{ ...initial.messages[0]!, text: 'x'.repeat(1_000_001) }] },
        { sequence: initial.sequence + 1, discussionId: id, type: 'state', at: initial.createdAt, data: {}, commitId: randomUUID() });
      await ctx.controller.initialize(); await pair(ctx.controller, id, 'summary');
      const state = ctx.controller.get(id);
      expect(state).toMatchObject({ status, activity: null }); expect(state.pauseReason).toContain('exceeds the application input limit');
      expect(state.v2!.calls).toHaveLength(0); expect(state.v2!.receipts).toHaveLength(0);
      expect((await ctx.store.records(id)).at(-1)!.state.status).toBe(status);
      await expect(ctx.controller.start(id, randomUUID())).rejects.toMatchObject({ code: status === 'stopped' ? 'STOPPED' : 'RECONCILIATION_REQUIRED' });
    } finally { await ctx.cleanup(); }
  });
});
