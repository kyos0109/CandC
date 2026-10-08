import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { RoomController } from '../src/room-controller.js';
import { DiscussionStore, type StorageFault } from '../src/store.js';
import { RoomFakeAdapter, fakeRoomResponse } from '../src/adapters/room-fake.js';
import { buildPrompt, type TurnRequest } from '../src/adapters/types.js';
import { roomInputSchema, roomStateSchema, parseRoomAnswer, ROOM_CONTROL_START, ROOM_CONTROL_END, type RoomDiscussion, type RoomControl } from '../src/room-contract.js';
import { selectionMarkdown } from '../src/selection.js';
import { summaryOf } from '../src/management.js';
import { waitUntil } from './helpers.js';

const input = (count = 4) => roomInputSchema.parse({ behaviorVersion: 3, kind: 'selection', mode: 'conclusion', topic: 'Select a plan.',
  selection: { version: 1, optionCount: count }, participants: ['codex', 'codex-2'].map(id => ({ id, provider: 'codex', role: 'speaker', settings: { model: 'fixture', effort: 'medium' } })),
  limits: { maxRounds: 1, maxDurationMs: 30_000, turnTimeoutMs: 5_000 } });
const response = (r: TurnRequest, mutate: (control: RoomControl) => void, text = 'Saved independent answer.') => {
  const control = parseRoomAnswer(fakeRoomResponse(r)).control!; mutate(control);
  return `${text}\n${ROOM_CONTROL_START}\n${JSON.stringify(control)}\n${ROOM_CONTROL_END}`;
};
async function setup(respond = fakeRoomResponse, fault?: StorageFault, delay = 0, reusedSession?: string) {
  const directory = await mkdtemp(path.resolve('.cache/selection-test-'));
  const store = new DiscussionStore<RoomDiscussion>(directory, fault, roomStateSchema);
  const requests: TurnRequest[] = [];
  const controller = new RoomController(store, provider => ({ id: provider, backend: 'fake', async *run(request) {
    const adapter = new RoomFakeAdapter(provider, r => { requests.push(r); return respond(r); }, delay);
    for await (const event of adapter.run(request)) yield event.type === 'session' && reusedSession ? { ...event, session: { ...event.session, id: reusedSession } } : event;
  } }));
  await controller.initialize();
  const id = randomUUID();
  return { id, directory, controller, requests, store,
    run: async () => { await controller.start(id, randomUUID()); await controller.wait(id); return controller.get(id); },
    cleanup: async () => { await controller.close(); await rm(directory, { recursive: true, force: true }); } };
}

describe('option evaluation', () => {
  it.each([2, 4, 6])('generates %i options and completes isolated equal-weight ratings, reload and export', async count => {
    const ctx = await setup(r => response(r, () => {}, r.room!.actor === 'codex' && r.room!.purpose === 'selection-rating' ? 'FIRST_REVIEW_PRIVATE_HISTORY' : 'Other answer'));
    try {
      await ctx.controller.create(ctx.id, input(count)); const s = await ctx.run();
      expect(s.room.selection?.phase).toBe('complete'); expect(s.room.selection?.optionSet?.options).toHaveLength(count);
      expect(s.room.selection?.ratings).toHaveLength(2); expect(s.room.selection?.result?.[0]).toMatchObject({ rank: 1, average: 9, total: 54 });
      expect(s.room.outcome).toBeNull(); expect(s.room.proposal).toBeNull(); expect(s.room.sessions).toEqual({});
      expect(ctx.requests).toHaveLength(3);
      for (const r of ctx.requests) { expect(r.session).toBeUndefined(); expect(r.room!.messages).toEqual([]); expect(r.context).toEqual([]); expect(r.research).toBe(false); }
      expect(buildPrompt(ctx.requests[2]!)).not.toContain('FIRST_REVIEW_PRIVATE_HISTORY');
      expect(new Set(s.room.calls.map(c => c.generation)).size).toBe(3);
      expect(roomStateSchema.safeParse(s).success).toBe(true);
      expect(summaryOf(s).outcome).toBe('selection'); expect(selectionMarkdown(s.room.selection!)).toContain('9.00/10');
      await ctx.run(); expect(ctx.requests).toHaveLength(3);
      const reloaded = new RoomController(new DiscussionStore<RoomDiscussion>(ctx.directory, undefined, roomStateSchema), () => { throw new Error('No calls expected'); });
      await reloaded.initialize(); expect(reloaded.get(ctx.id).room.selection).toEqual(s.room.selection);
      await reloaded.start(ctx.id, randomUUID()); expect(reloaded.get(ctx.id).room.selection).toEqual(s.room.selection);
      const changed = structuredClone(s); changed.room.selection!.result![0]!.average = 1; expect(roomStateSchema.safeParse(changed).success).toBe(false);
      const missing = structuredClone(s); missing.room.selection!.ratings.pop(); expect(roomStateSchema.safeParse(missing).success).toBe(false);
    } finally { await ctx.cleanup(); }
  });

  it('keeps ties and uses exact totals instead of displayed rounding', async () => {
    const ctx = await setup(r => response(r, c => { if (c.action.type === 'selection-rating') c.action.scores.forEach(s => { s.score = s.optionId === 'option-3' ? 0 : 10; }); }));
    try { await ctx.controller.create(ctx.id, input(3)); const s = await ctx.run();
      expect(s.room.selection!.result!.map(r => [r.optionId, r.rank, r.average])).toEqual([['option-1', 1, 10], ['option-2', 1, 10], ['option-3', 3, 0]]);
    } finally { await ctx.cleanup(); }
  });

  it.each(['missing', 'duplicate', 'unknown', 'out-of-range', 'reason', 'set', 'none', 'version', 'invalid-json'])('pauses on %s rating without counting it, then explicitly fills only the missing seat', async failure => {
    let invalid = true;
    const ctx = await setup(r => {
      if (!invalid || r.room!.purpose !== 'selection-rating' || r.room!.actor !== 'codex-2') return fakeRoomResponse(r);
      if (failure === 'invalid-json') return 'Public answer without metadata.';
      return response(r, c => {
        if (c.action.type !== 'selection-rating') throw new Error('Expected rating');
        if (failure === 'missing') c.action.scores.pop();
        if (failure === 'duplicate') c.action.scores[1] = { ...c.action.scores[0]! };
        if (failure === 'unknown') c.action.scores[0]!.optionId = 'unknown';
        if (failure === 'out-of-range') c.action.scores[0]!.score = 11;
        if (failure === 'reason') c.action.scores[0]!.reason = '';
        if (failure === 'set') c.action.optionSetId = randomUUID();
        if (failure === 'none') c.action = { type: 'none' };
        if (failure === 'version') c.taskVersion++;
      });
    });
    try { await ctx.controller.create(ctx.id, input()); const s = await ctx.run();
      expect(s.status).toBe('paused'); expect(s.room.selection!.ratings).toHaveLength(1); expect(s.room.selection!.result).toBeNull();
      expect(s.room.calls.at(-1)!.status).toBe('completed'); expect(s.room.calls.at(-1)!.controlDiagnostic).toBeDefined();
      expect(s.messages.at(-1)!.text).not.toBe(''); expect(ctx.requests).toHaveLength(3);
      expect(selectionMarkdown(s.room.selection!)).toContain('Incomplete');
      invalid = false; const completed = await ctx.run(); expect(completed.room.selection!.phase).toBe('complete'); expect(ctx.requests).toHaveLength(4);
      expect(completed.room.selection!.ratings[0]).toEqual(s.room.selection!.ratings[0]);
    } finally { await ctx.cleanup(); }
  });

  it.each(['count', 'titles', 'ids', 'criteria'])('rejects invalid generated %s before rating', async failure => {
    const ctx = await setup(r => response(r, c => { if (c.action.type !== 'selection-options') throw new Error('Unexpected rating');
      if (failure === 'count') c.action.options.pop();
      if (failure === 'titles') c.action.options[1]!.title = c.action.options[0]!.title;
      if (failure === 'ids') c.action.options[1]!.id = c.action.options[0]!.id;
      if (failure === 'criteria') c.action.criteria[1]!.id = c.action.criteria[0]!.id;
    }));
    try { await ctx.controller.create(ctx.id, input()); const s = await ctx.run(); expect(s.status).toBe('paused'); expect(s.room.selection!.optionSet).toBeNull(); expect(ctx.requests).toHaveLength(1); }
    finally { await ctx.cleanup(); }
  });

  it('freezes inputs while allowing time-budget extension without invalidating existing scores', async () => {
    const ctx = await setup();
    try { await ctx.controller.create(ctx.id, input());
      await expect(ctx.controller.send(ctx.id, randomUUID(), 'Change the goal.', 'all')).rejects.toMatchObject({ code: 'INVALID_STATE' });
      await expect(ctx.controller.start(ctx.id, randomUUID(), 'summary')).rejects.toMatchObject({ code: 'INVALID_STATE' });
      await expect(ctx.controller.configure(ctx.id, { expectedVersion: 1, topic: 'Changed' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
      await ctx.controller.configure(ctx.id, { expectedVersion: 1, limits: { ...input().limits, maxDurationMs: 60_000 } });
      expect(ctx.controller.get(ctx.id).room.taskVersion).toBe(1); expect((await ctx.run()).room.selection!.phase).toBe('complete');
      expect(roomInputSchema.safeParse({ ...input(), research: true }).success).toBe(false);
      expect(roomInputSchema.safeParse({ ...input(), kind: 'discussion' }).success).toBe(false);
      for (const count of [1, 7, 2.5]) expect(roomInputSchema.safeParse({ ...input(), selection: { version: 1, optionCount: count } }).success).toBe(false);
    } finally { await ctx.cleanup(); }
  });

  it('pause completes only the active call; resume reuses saved options without regeneration', async () => {
    const ctx = await setup(undefined, undefined, 3);
    try { await ctx.controller.create(ctx.id, input()); await ctx.controller.start(ctx.id, randomUUID());
      await waitUntil(() => ctx.requests.length === 1); await ctx.controller.pause(ctx.id); await ctx.controller.wait(ctx.id);
      expect(ctx.controller.get(ctx.id).room.selection!.phase).toBe('scoring'); expect(ctx.requests).toHaveLength(1);
      const s = await ctx.run(); expect(s.room.selection!.phase).toBe('complete'); expect(ctx.requests).toHaveLength(3);
    } finally { await ctx.cleanup(); }
  });

  it('stop aborts generation and requires explicit reconstruction', async () => {
    const ctx = await setup(undefined, undefined, 5);
    try { await ctx.controller.create(ctx.id, input()); await ctx.controller.start(ctx.id, randomUUID());
      await waitUntil(() => ctx.requests.length === 1); await ctx.controller.stop(ctx.id); await ctx.controller.wait(ctx.id);
      expect(ctx.controller.get(ctx.id).status).toBe('stopped'); expect(ctx.controller.get(ctx.id).room.selection!.optionSet).toBeNull();
      await ctx.controller.pause(ctx.id); expect(ctx.controller.get(ctx.id).status).toBe('stopped');
      await expect(ctx.run()).rejects.toMatchObject({ code: 'STOPPED' });
      await ctx.controller.rebuild(ctx.id, randomUUID(), 1); expect((await ctx.run()).room.selection!.phase).toBe('complete');
    } finally { await ctx.cleanup(); }
  });

  it.each(['beforeAppend', 'sync', 'close'] as const)('blocks later calls and result publication on %s storage uncertainty', async stage => {
    let armed = false;
    const ctx = await setup(undefined, async (current, _handle, payload) => {
      if (armed && current === stage && payload.includes('"phase":"scoring"')) { armed = false; throw new Error('Injected selection save failure'); }
    });
    try { await ctx.controller.create(ctx.id, input()); armed = true; const s = await ctx.run();
      expect(s.storage?.status).toBe('unconfirmed'); expect(s.room.selection!.optionSet).toBeNull(); expect(ctx.requests).toHaveLength(1);
      await expect(ctx.run()).rejects.toMatchObject({ code: 'STORAGE_UNCONFIRMED' });
      await ctx.controller.recover(ctx.id); expect(ctx.controller.get(ctx.id).status).toBe('indeterminate');
      await ctx.controller.rebuild(ctx.id, randomUUID(), 1); const completed = await ctx.run(); expect(completed.room.selection!.phase).toBe('complete');
      expect(roomStateSchema.safeParse(completed).success).toBe(true);
    } finally { await ctx.cleanup(); }
  });

  it('refuses reuse of the generating seat native session for scoring', async () => {
    const ctx = await setup(undefined, undefined, 0, 'reused-session');
    try { await ctx.controller.create(ctx.id, input()); const s = await ctx.run();
      expect(s.status).toBe('indeterminate'); expect(s.room.selection!.ratings).toHaveLength(0); expect(s.room.selection!.result).toBeNull();
      expect(s.room.calls).toHaveLength(2); expect(s.pauseReason).toContain('session');
    } finally { await ctx.cleanup(); }
  });

  it.each(['provider', 'timeout'])('requires explicit reconstruction after %s uncertainty', async failure => {
    let fail = true;
    const ctx = await setup(r => { if (fail && failure === 'provider' && r.room!.purpose === 'selection-rating') throw new Error('Fixture provider failure'); return fakeRoomResponse(r); }, undefined, failure === 'timeout' ? 5 : 0);
    try {
      await ctx.controller.create(ctx.id, { ...input(), limits: { ...input().limits, turnTimeoutMs: failure === 'timeout' ? 50 : 5000 } });
      const s = await ctx.run(); expect(s.status).toBe('indeterminate'); expect(s.room.selection!.result).toBeNull();
      await expect(ctx.run()).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
      fail = false; await ctx.controller.rebuild(ctx.id, randomUUID(), 1);
      await ctx.controller.configure(ctx.id, { expectedVersion: 1, limits: { ...input().limits, turnTimeoutMs: 5000 } });
      expect((await ctx.run()).room.selection!.phase).toBe('complete');
    } finally { await ctx.cleanup(); }
  });

  it('does not publish a ranking before its durable commit and completes recovery without extra model calls', async () => {
    let armed = true;
    const ctx = await setup(undefined, async (stage, _handle, payload) => { if (armed && stage === 'sync' && payload.includes('"phase":"complete"')) { armed = false; throw new Error('Ranking sync failed'); } });
    try { await ctx.controller.create(ctx.id, input()); const s = await ctx.run();
      expect(s.storage?.status).toBe('unconfirmed'); expect(s.room.selection!.ratings).toHaveLength(2); expect(s.room.selection!.result).toBeNull(); expect(ctx.requests).toHaveLength(3);
      await ctx.controller.recover(ctx.id); await ctx.controller.rebuild(ctx.id, randomUUID(), 1);
      expect((await ctx.run()).room.selection!.phase).toBe('complete'); expect(ctx.requests).toHaveLength(3);
    } finally { await ctx.cleanup(); }
  });
});
