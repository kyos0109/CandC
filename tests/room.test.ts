import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay, setImmediate as nextTick } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { RoomController } from '../src/room-controller.js';
import { DiscussionStore, type StorageFault } from '../src/store.js';
import { RoomFakeAdapter, fakeRoomResponse } from '../src/adapters/room-fake.js';
import { roomStateSchema, roomInputSchema, ROOM_CONTROL_START, ROOM_CONTROL_END, type RoomInput, type RoomDiscussion, type RoomControl, type ProviderId } from '../src/room-contract.js';
import type { AgentAdapter, TurnRequest, AgentEvent } from '../src/adapters/types.js';
import { waitUntil } from './helpers.js';
import { withDelivery } from './fixtures/conclusion.js';

const envelope = (r: TurnRequest, action: RoomControl['action'], text = 'Public fixture answer.', continuation: RoomControl['continuation'] = 'yield') =>
  `${text}\n${ROOM_CONTROL_START}\n${JSON.stringify({ version: 3, taskVersion: r.room!.taskVersion, grantId: r.room!.grantId, continuation, action: withDelivery(action) })}\n${ROOM_CONTROL_END}`;
export function roomInput(overrides: Partial<RoomInput> = {}): RoomInput {
  return { behaviorVersion: 3, topic: 'Fixture topic.', goal: 'Preserve supplied goal.', constraints: 'Use supplied facts.', backend: 'fake', kind: 'discussion',
    mode: 'manual', flow: 'alternating', participants: (['codex', 'claude'] as const).map(provider => ({ id: provider, provider, role: 'speaker', instructions: '', settings: { model: `fixture-${provider}`, effort: 'medium' } })),
    moderator: { id: 'moderator', provider: 'codex', role: 'moderator', settings: { model: 'fixture-moderator', effort: 'high' } }, moderatorMode: 'judge', research: false, roots: [],
    limits: { maxRounds: 4, maxDurationMs: 20_000, turnTimeoutMs: 5_000, maxModeratorCalls: 500 }, ...overrides };
}
async function setup(respond: (r: TurnRequest) => string = fakeRoomResponse, fault?: StorageFault, delay = 0, monitorInterval = 10_000,
  override?: (provider: ProviderId, actor: string) => AgentAdapter) {
  const directory = await mkdtemp(path.resolve('.cache/room-test-'));
  const store = new DiscussionStore<RoomDiscussion>(directory, fault, roomStateSchema);
  const adapters = new Map<string, AgentAdapter>(); const requests: TurnRequest[] = [];
  const controller = new RoomController(store, (provider, workspace, _, actor) => {
    let adapter = adapters.get(workspace);
    if (!adapter) { adapter = override?.(provider, actor) ?? new RoomFakeAdapter(provider, r => { const { signal, ...payload } = r; requests.push({ ...structuredClone(payload), signal }); return respond(r); }, delay); adapters.set(workspace, adapter); }
    return adapter;
  }, undefined, undefined, monitorInterval);
  await controller.initialize();
  return { directory, store, controller, requests, cleanup: async () => { await controller.close(); await rm(directory, { recursive: true, force: true }); } };
}
describe('independent moderator discussions', () => {
  it.each([2, 3, 4])('runs one manual round with %s speakers and an independent same-provider moderator session', async count => {
    const ctx = await setup();
    try {
      const input = roomInput({ participants: (['codex', 'claude', 'gemini', 'grok'] as const).slice(0, count).map(provider => ({ id: provider, provider, role: 'speaker', instructions: '', settings: { model: `fixture-${provider}`, effort: null } })) });
      const id = randomUUID(); await ctx.controller.create(id, input); await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const s = ctx.controller.get(id); expect(s.status).toBe('paused'); expect(s.room.contributions).toBe(count);
      expect(s.messages.filter(m => m.purpose === 'discussion' && m.sender !== 'user')).toHaveLength(count);
      expect(s.room.sessions.moderator!.id).not.toBe(s.room.sessions.codex!.id);
      expect(new Set(s.room.calls.map(c => c.generation)).size).toBe(count + 1);
      const reload = new RoomController(new DiscussionStore<RoomDiscussion>(ctx.directory, undefined, roomStateSchema), () => new RoomFakeAdapter('codex'));
      await reload.initialize(); expect(reload.get(id)).toEqual(s); await reload.close();
      expect((await readFile(path.join(ctx.directory, `${id}.jsonl`), 'utf8')).split('\n')[0]).toContain('"version":4');
    } finally { await ctx.cleanup(); }
  });
  it('excludes directed input from moderator prompts, snapshots and peer input across resume and summary', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID(), privateId = randomUUID(); await ctx.controller.create(id, roomInput());
      await ctx.controller.send(id, privateId, 'PRIVATE-DIRECTIVE-ONLY-CODEX', 'codex');
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      await ctx.controller.start(id, randomUUID(), 'summary'); await ctx.controller.wait(id);
      expect(ctx.requests.filter(r => r.room!.actor === 'codex').some(r => r.room!.messages.some(m => m.id === privateId))).toBe(true);
      for (const r of ctx.requests.filter(r => r.room!.actor !== 'codex')) expect(JSON.stringify(r)).not.toContain('PRIVATE-DIRECTIVE-ONLY-CODEX');
      expect(ctx.controller.get(id).room.calls.filter(c => c.participant !== 'codex').every(c => !c.messages.includes(privateId))).toBe(true);
    } finally { await ctx.cleanup(); }
  });
  it('notifies before applying a related topic change, preserving goals and constraints', async () => {
    let boundary = 0;
    const ctx = await setup(r => r.room!.actor !== 'moderator' ? fakeRoomResponse(r) : envelope(r,
      ++boundary === 1 ? { type: 'topic', title: 'Deeper fixture question.', reason: 'Clarify missing evidence.' } : { type: 'finish', result: 'Insufficient evidence.', dissent: ['One objection remains.'], unresolved: ['Missing data.'] }));
    try {
      const id = randomUUID(); await ctx.controller.create(id, roomInput({ mode: 'auto' })); await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const records = await ctx.store.records(id); const noticeIndex = records.findIndex(r => r.state.room.pendingTopic !== null);
      expect(noticeIndex).toBeGreaterThan(0); expect(records[noticeIndex]!.state.topic).toBe('Fixture topic.');
      expect(records[noticeIndex]!.state.messages.at(-1)!.text).toContain('主題變更通知');
      const changedIndex = records.findIndex(r => r.state.topic === 'Deeper fixture question.'); expect(changedIndex).toBeGreaterThan(noticeIndex);
      const s = ctx.controller.get(id); expect(s.goal).toBe('Preserve supplied goal.'); expect(s.constraints).toBe('Use supplied facts.');
      expect(s.room.outcome).toMatchObject({ authority: 'moderator', dissent: ['One objection remains.'], unresolved: ['Missing data.'] });
    } finally { await ctx.cleanup(); }
  });
  it('interrupts a generating answer, preserves partial content and assigns another speaker after cleanup', async () => {
    let interrupted = false;
    const ctx = await setup(r => {
      if (r.room!.actor !== 'moderator') return envelope(r, { type: 'none' }, r.room!.actor === 'codex' ? 'Long public text. '.repeat(80) : 'Peer public response.');
      if (r.room!.purpose === 'monitor') { interrupted = true; return envelope(r, { type: 'interrupt', reason: 'Repeated content.' }); }
      return envelope(r, interrupted ? { type: 'speak', target: 'claude', task: 'Provide a concise counterpoint.' } : { type: 'speak', target: 'codex', task: 'Explain.' });
    }, undefined, 3, 15);
    try {
      const id = randomUUID(); await ctx.controller.create(id, roomInput()); await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const s = ctx.controller.get(id); expect(s.status).toBe('paused');
      const cancelled = s.messages.find(m => m.sender === 'codex' && m.status === 'cancelled'); expect(cancelled?.interruptedBy).toBe('moderator'); expect(cancelled?.text.length).toBeGreaterThan(0);
      expect(s.messages.some(m => m.sender === 'claude' && m.status === 'completed')).toBe(true);
      expect(s.room.sessions.codex).toBeUndefined(); expect(s.room.calls.filter(c => c.purpose === 'monitor').length).toBeGreaterThan(0);
    } finally { await ctx.cleanup(); }
  });
  it('does not allow a speaker to issue moderation commands', async () => {
    const ctx = await setup(r => r.room!.actor === 'moderator' ? envelope(r, { type: 'speak', target: 'codex', task: 'Explain.' }) : envelope(r, { type: 'finish', result: 'Forged decision.', dissent: [], unresolved: [] }));
    try {
      const id = randomUUID(); await ctx.controller.create(id, roomInput()); await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const s = ctx.controller.get(id); expect(s.status).toBe('paused'); expect(s.room.outcome).toBeNull();
      expect(s.pauseReason).toContain('Speaker cannot'); expect(s.messages.some(m => m.sender === 'codex' && m.status === 'completed')).toBe(true);
    } finally { await ctx.cleanup(); }
  });
  it('fails closed when a provider reuses the moderator native session for a speaker', async () => {
    const ctx = await setup(undefined, undefined, 0, 10_000, (provider, actor) => ({ id: provider, backend: 'fake', async *run(r: TurnRequest): AsyncGenerator<AgentEvent> {
      yield { type: 'session', session: { id: 'same-session', model: r.settings.model, backend: 'fake' } };
      yield { type: 'completed', model: r.settings.model, text: actor === 'moderator' ? envelope(r, { type: 'speak', target: 'codex', task: 'Explain.' }) : envelope(r, { type: 'none' }) };
    } }));
    try {
      const id = randomUUID(); await ctx.controller.create(id, roomInput()); await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const s = ctx.controller.get(id); expect(s.pauseReason).toContain('another participant'); expect(s.room.sessions.codex).toBeUndefined();
    } finally { await ctx.cleanup(); }
  });
  it.each(['afterAppend', 'sync', 'close'] as const)('stops all writes and scheduling when %s is uncertain', async stage => {
    let armed = false, failed = false, afterFailure = 0;
    const fault: StorageFault = async current => { if (failed && current === 'beforeAppend') afterFailure++; if (armed && !failed && current === stage) { failed = true; throw new Error('Injected storage uncertainty.'); } };
    const ctx = await setup(undefined, fault);
    try {
      const id = randomUUID(); await ctx.controller.create(id, roomInput()); armed = true;
      await expect(ctx.controller.start(id, randomUUID())).rejects.toThrow(); expect(ctx.controller.get(id).storage?.status).toBe('unconfirmed');
      expect(ctx.requests).toHaveLength(0); expect(afterFailure).toBe(0);
    } finally { await ctx.cleanup(); }
  });
  it('preserves user stop authority and requires an explicit new generation to resume', async () => {
    const ctx = await setup(r => r.room!.actor === 'moderator' ? envelope(r, { type: 'speak', target: 'codex', task: 'Explain.' }) : envelope(r, { type: 'none' }, 'Long answer. '.repeat(80)), undefined, 3);
    try {
      const id = randomUUID(); await ctx.controller.create(id, roomInput()); await ctx.controller.start(id, randomUUID());
      await waitUntil(() => ctx.controller.get(id).room.calls.some(c => c.participant === 'codex'));
      await ctx.controller.stop(id); await ctx.controller.wait(id); expect(ctx.controller.get(id).status).toBe('stopped');
      await expect(ctx.controller.start(id, randomUUID())).rejects.toMatchObject({ code: 'STOPPED' });
      await ctx.controller.rebuild(id, randomUUID(), ctx.controller.get(id).room.taskVersion); expect(ctx.controller.get(id).room.sessions).toEqual({});
    } finally { await ctx.cleanup(); }
  });
  it('does not overwrite a saved stop with a manual pause queued at the round boundary', async () => {
    const ctx = await setup();
    let releaseRound!: () => void, releaseStop!: () => void, reachedRound!: () => void, reachedStop!: () => void;
    const roundGate = new Promise<void>(resolve => { releaseRound = resolve; }), stopGate = new Promise<void>(resolve => { releaseStop = resolve; });
    const roundReached = new Promise<void>(resolve => { reachedRound = resolve; }), stopReached = new Promise<void>(resolve => { reachedStop = resolve; });
    const commit = ctx.store.commit.bind(ctx.store); let gated = false;
    const spy = vi.spyOn(ctx.store, 'commit').mockImplementation(async (state, event) => {
      if (!gated && state.status === 'running' && state.round === 2) { gated = true; reachedRound(); await roundGate; }
      if (state.status === 'stopped') { reachedStop(); await stopGate; }
      await commit(state, event);
    });
    try {
      const id = randomUUID(); await ctx.controller.create(id, roomInput({ moderator: null })); await ctx.controller.start(id, randomUUID());
      await roundReached; const stopped = ctx.controller.stop(id); releaseRound(); await stopReached;
      // Let execute queue its manual pause while the stop commit still holds the lock.
      await nextTick(); releaseStop(); expect((await stopped).status).toBe('stopped'); await ctx.controller.wait(id);
      expect(ctx.controller.get(id).status).toBe('stopped');
      expect((await ctx.store.records(id)).at(-1)!.state.status).toBe('stopped');
      await expect(ctx.controller.start(id, randomUUID())).rejects.toMatchObject({ code: 'STOPPED' });
    } finally { releaseRound(); releaseStop(); spy.mockRestore(); await ctx.cleanup(); }
  });
  it('rebuilds lost fake sessions only on explicit resume after reload, preserving recipient isolation', async () => {
    const ctx = await setup(); let reload: RoomController | undefined;
    try {
      const id = randomUUID(), privateId = randomUUID(); await ctx.controller.create(id, roomInput());
      await ctx.controller.send(id, privateId, 'PRIVATE-RESTART-CODEX', 'codex');
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const before = ctx.controller.get(id), bytes = await readFile(path.join(ctx.directory, `${id}.jsonl`));
      const requests: TurnRequest[] = [], adapters = new Map<string, AgentAdapter>();
      reload = new RoomController(new DiscussionStore<RoomDiscussion>(ctx.directory, undefined, roomStateSchema), (provider, workspace) => {
        if (!adapters.has(workspace)) adapters.set(workspace, new RoomFakeAdapter(provider, r => { requests.push(r); return fakeRoomResponse(r); }, 0));
        return adapters.get(workspace)!;
      });
      await reload.initialize(); expect(reload.get(id)).toEqual(before);
      expect(await readFile(path.join(ctx.directory, `${id}.jsonl`))).toEqual(bytes);
      await reload.start(id, randomUUID()); await reload.wait(id);
      const after = reload.get(id); expect(after.status).toBe('paused'); expect(after.room.contributions).toBe(4);
      for (const actor of ['codex', 'claude', 'moderator']) {
        expect(after.room.sessions[actor]!.generation).not.toBe(before.room.sessions[actor]!.generation);
        expect(after.room.sessions[actor]!.id).not.toBe(before.room.sessions[actor]!.id);
        expect(requests.find(r => r.room!.actor === actor)?.session).toBeUndefined();
      }
      expect(requests.filter(r => r.room!.actor === 'codex').some(r => r.room!.messages.some(m => m.id === privateId))).toBe(true);
      for (const r of requests.filter(r => r.room!.actor !== 'codex')) expect(JSON.stringify(r)).not.toContain('PRIVATE-RESTART-CODEX');
    } finally { await reload?.close(); await ctx.cleanup(); }
  });
  it('requires all configured speakers to confirm one version of the unmoderated result', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID(), participants = (['codex', 'gemini', 'grok'] as const).map(provider => ({ id: provider, provider, role: 'speaker' as const, settings: { model: `fixture-${provider}`, effort: null }, instructions: '' }));
      await ctx.controller.create(id, roomInput({ moderator: null, mode: 'conclusion', participants })); await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const s = ctx.controller.get(id); expect(s.room.outcome?.authority).toBe('participants'); expect(s.room.proposal?.confirmed).toHaveLength(3);
    } finally { await ctx.cleanup(); }
  });
  it('rejects duplicate speaker seats and unknown directed recipients', async () => {
    expect(roomInputSchema.safeParse(roomInput({ participants: [roomInput().participants[0]!, roomInput().participants[0]!] })).success).toBe(false);
    const ctx = await setup(); try { const id = randomUUID(); await ctx.controller.create(id, roomInput()); await expect(ctx.controller.send(id, randomUUID(), 'Input', 'grok')).rejects.toMatchObject({ code: 'INVALID_REFERENCE' }); await expect(ctx.controller.send(id, randomUUID(), 'Private host input', 'moderator')).rejects.toMatchObject({ code: 'INVALID_REFERENCE' }); } finally { await ctx.cleanup(); }
  });
  it('a late monitor result cannot stop the next speaker and owned cleanup precedes the next turn', async () => {
    let activeSpeakers = 0, maxActive = 0, cleanups = 0, monitors = 0, boundary = 0;
    const ctx = await setup(undefined, undefined, 0, 5, (provider, actor) => ({ id: provider, backend: 'fake', async *run(r): AsyncGenerator<AgentEvent> {
      yield { type: 'session', session: { id: `owned-${actor}`, model: r.settings.model, backend: 'fake' } };
      if (actor === 'moderator') {
        if (r.room!.purpose === 'monitor') {
          monitors++; await delay(80); // Deliberately ignore cancellation while finishing the owned fixture.
          yield { type: 'completed', model: r.settings.model, text: envelope(r, { type: 'interrupt', reason: 'Stale draft.' }) };
        } else yield { type: 'completed', model: r.settings.model, text: envelope(r, { type: 'speak', target: boundary++ === 0 ? 'codex' : 'claude', task: 'Explain.' }) };
      } else {
        activeSpeakers++; maxActive = Math.max(maxActive, activeSpeakers);
        try { yield { type: 'delta', text: 'Saved public answer.' }; await delay(20); yield { type: 'completed', model: r.settings.model, text: envelope(r, { type: 'none' }, 'Saved public answer.') }; }
        finally { await delay(15); activeSpeakers--; cleanups++; }
      }
    } }));
    try {
      const id = randomUUID(); await ctx.controller.create(id, roomInput()); await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const s = ctx.controller.get(id); expect(monitors).toBeGreaterThan(0); expect(maxActive).toBe(1); expect(cleanups).toBe(2);
      expect(s.messages.filter(m => m.purpose === 'discussion' && m.sender !== 'user').every(m => m.status === 'completed')).toBe(true);
      expect(s.room.commands.some(c => c.action.type === 'interrupt')).toBe(false);
    } finally { await ctx.cleanup(); }
  });
  it('keeps a durably notified topic pending after uncertainty and requires explicit recovery and resolution', async () => {
    let armed = true;
    const fault: StorageFault = async (stage, _, payload) => {
      if (armed && stage === 'afterAppend' && JSON.parse(payload).event.data.action === 'topic') { armed = false; throw new Error('Notice append uncertainty.'); }
    };
    const ctx = await setup(r => envelope(r, { type: 'topic', title: 'Related deeper question.', reason: 'Keep original goal.' }), fault);
    try {
      const id = randomUUID(); await ctx.controller.create(id, roomInput()); await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      expect(ctx.controller.get(id).storage?.status).toBe('unconfirmed'); expect(ctx.controller.get(id).topic).toBe('Fixture topic.');
      await ctx.controller.recover(id); const recovered = ctx.controller.get(id); expect(recovered.room.pendingTopic?.title).toBe('Related deeper question.');
      expect(recovered.messages.some(m => m.text.includes('主題變更通知'))).toBe(true);
      await ctx.controller.rebuild(id, randomUUID(), recovered.room.taskVersion);
      await expect(ctx.controller.start(id, randomUUID())).rejects.toMatchObject({ code: 'PENDING_TOPIC' });
      await ctx.controller.resolveTopic(id, randomUUID(), recovered.room.taskVersion, true);
      expect(ctx.controller.get(id).topic).toBe('Related deeper question.'); expect(ctx.controller.get(id).goal).toBe('Preserve supplied goal.');
    } finally { await ctx.cleanup(); }
  });
  it('enforces the moderator call budget and leaves missing response coverage explicit at unilateral completion', async () => {
    const limited = await setup();
    try {
      const id = randomUUID(); await limited.controller.create(id, roomInput({ limits: { ...roomInput().limits, maxModeratorCalls: 1 } })); await limited.controller.start(id, randomUUID()); await limited.controller.wait(id);
      const s = limited.controller.get(id); expect(s.room.moderatorCalls).toBe(1); expect(s.room.calls.filter(c => c.participant === 'moderator')).toHaveLength(1); expect(s.room.outcome).toBeNull();
    } finally { await limited.cleanup(); }
    const finished = await setup(r => envelope(r, { type: 'finish', result: 'Moderator decision.', dissent: ['A dissent remains.'], unresolved: ['Needs input.'] }));
    try {
      const id = randomUUID(); await finished.controller.create(id, roomInput()); await finished.controller.start(id, randomUUID()); await finished.controller.wait(id);
      const s = finished.controller.get(id); expect(s.room.outcome!.unhandledRequests).toEqual([s.messages[0]!.id]); expect(s.room.outcome!.dissent).toEqual(['A dissent remains.']);
    } finally { await finished.cleanup(); }
  });
  it('changes mute and unmute authority only through the moderator and rejects stale speaker control', async () => {
    let decision = 0;
    const ctx = await setup(r => r.room!.actor === 'moderator' ? envelope(r, decision++ === 0 ? { type: 'mute', target: 'codex', reason: 'Pause this speaker.' } : decision === 2 ? { type: 'unmute', target: 'codex', reason: 'Allow supplement.' } : { type: 'speak', target: 'codex', task: 'Explain.' }) : envelope(r, { type: 'none' }).replace('"taskVersion":1', '"taskVersion":999'));
    try {
      const id = randomUUID(); await ctx.controller.create(id, roomInput()); await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const s = ctx.controller.get(id); expect(s.room.muted).toEqual([]); expect(s.room.commands.slice(0, 2).map(c => c.action.type)).toEqual(['mute', 'unmute']);
      expect(s.pauseReason).toContain('控制資料無效'); expect(s.messages.some(m => m.sender === 'codex' && m.status === 'completed')).toBe(true);
    } finally { await ctx.cleanup(); }
  });
});
