import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RoomController } from '../src/room-controller.js';
import { DiscussionStore } from '../src/store.js';
import { RoomFakeAdapter, fakeRoomResponse } from '../src/adapters/room-fake.js';
import { roomStateSchema, roomInputSchema, ROOM_CONTROL_START, ROOM_CONTROL_END, type RoomInput, type RoomDiscussion, type RoomControl, type ProviderId } from '../src/room-contract.js';
import type { AgentAdapter, AgentEvent, TurnRequest } from '../src/adapters/types.js';
import { withDelivery } from './fixtures/conclusion.js';

// Several seats may share one provider. Every case runs for all four providers: the seat model must not favour any of them.
const providers = ['codex', 'claude', 'gemini', 'grok'] as const;
const effortFor = (provider: ProviderId): RoomInput['participants'][number]['settings']['effort'] => provider === 'gemini' || provider === 'grok' ? null : 'medium';
const seats = (provider: ProviderId): RoomInput['participants'] => [
  { id: provider, provider, role: 'speaker', instructions: '', label: `${provider} A`, settings: { model: `fixture-${provider}`, effort: effortFor(provider) } },
  { id: `${provider}-2`, provider, role: 'speaker', instructions: '', label: `${provider} B`, settings: { model: `fixture-${provider}`, effort: effortFor(provider) } },
];
const moderator = (provider: ProviderId = 'codex'): NonNullable<RoomInput['moderator']> => ({ id: 'moderator', provider, role: 'moderator', settings: { model: 'fixture-moderator', effort: effortFor(provider) } });
const input = (participants: RoomInput['participants'], overrides: Partial<RoomInput> = {}): RoomInput => ({ behaviorVersion: 3, topic: 'Seat fixture.', goal: 'Compare two sessions.', constraints: '',
  backend: 'fake', kind: 'discussion', mode: 'manual', flow: 'alternating', participants, moderator: null, moderatorMode: 'judge', research: false, roots: [],
  limits: { maxRounds: 4, maxDurationMs: 20_000, turnTimeoutMs: 5_000, maxModeratorCalls: 500 }, ...overrides });
const envelope = (r: TurnRequest, action: RoomControl['action'], text = 'Public fixture answer.') =>
  `${text}\n${ROOM_CONTROL_START}\n${JSON.stringify({ version: 3, taskVersion: r.room!.taskVersion, grantId: r.room!.grantId, continuation: 'yield', action: withDelivery(action) })}\n${ROOM_CONTROL_END}`;
async function setup(respond: (r: TurnRequest) => string = fakeRoomResponse, adapterFor?: (provider: ProviderId, actor: string) => AgentAdapter) {
  const directory = await mkdtemp(path.resolve('.cache/room-seat-test-'));
  const store = new DiscussionStore<RoomDiscussion>(directory, undefined, roomStateSchema);
  const adapters = new Map<string, AgentAdapter>(); const requests: TurnRequest[] = [];
  const controller = new RoomController(store, (provider, workspace, _, actor) => {
    let adapter = adapters.get(workspace);
    if (!adapter) { adapter = adapterFor?.(provider, actor) ?? new RoomFakeAdapter(provider, r => { const { signal, ...payload } = r; requests.push({ ...structuredClone(payload), signal }); return respond(r); }, 0); adapters.set(workspace, adapter); }
    return adapter;
  });
  await controller.initialize();
  return { directory, controller, requests, cleanup: async () => { await controller.close(); await rm(directory, { recursive: true, force: true }); } };
}

describe('several seats on one provider', () => {
  it.each(providers)('runs two %s seats as independent sessions and reloads them', async provider => {
    const ctx = await setup();
    try {
      const id = randomUUID(); await ctx.controller.create(id, input(seats(provider))); await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const s = ctx.controller.get(id);
      expect(s.status).toBe('paused'); expect(s.room.contributions).toBe(2);
      expect(s.messages.filter(m => m.purpose === 'discussion' && m.sender !== 'user').map(m => m.sender).sort()).toEqual([provider, `${provider}-2`].sort());
      expect(s.room.sessions[provider]!.id).not.toBe(s.room.sessions[`${provider}-2`]!.id);
      expect(new Set(s.room.calls.map(c => c.generation)).size).toBe(2);
      expect(s.room.calls.map(c => c.participant).sort()).toEqual([provider, `${provider}-2`].sort());
      expect(s.room.calls.every(c => c.provider === provider)).toBe(true);
      const reload = new RoomController(new DiscussionStore<RoomDiscussion>(ctx.directory, undefined, roomStateSchema), () => new RoomFakeAdapter(provider));
      await reload.initialize(); expect(reload.get(id)).toEqual(s); await reload.close();
    } finally { await ctx.cleanup(); }
  });

  it.each(providers)('keeps a private message for one %s seat away from its same-provider twin and the moderator', async provider => {
    const ctx = await setup();
    try {
      const id = randomUUID(); await ctx.controller.create(id, input(seats(provider), { moderator: moderator() }));
      await ctx.controller.send(id, randomUUID(), 'PRIVATE-TO-FIRST-SEAT', provider);
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      expect(ctx.requests.filter(r => r.room!.actor === provider).some(r => JSON.stringify(r).includes('PRIVATE-TO-FIRST-SEAT'))).toBe(true);
      const others = ctx.requests.filter(r => r.room!.actor !== provider); expect(others.length).toBeGreaterThan(0);
      for (const r of others) expect(JSON.stringify(r)).not.toContain('PRIVATE-TO-FIRST-SEAT');
    } finally { await ctx.cleanup(); }
  });

  it.each(providers)('lets the moderator mute and address %s seats by seat id', async provider => {
    let call = 0;
    const ctx = await setup(r => {
      if (r.room!.actor !== 'moderator') return envelope(r, { type: 'none' });
      call++;
      return envelope(r, call === 1 ? { type: 'mute', target: `${provider}-2`, reason: 'Repeats itself.' } : call === 2 ? { type: 'speak', target: provider, task: 'Answer.' }
        : { type: 'finish', result: 'Done.', dissent: [], unresolved: [] });
    });
    try {
      const id = randomUUID(); await ctx.controller.create(id, input(seats(provider), { mode: 'auto', moderator: moderator() })); await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const s = ctx.controller.get(id);
      expect(s.room.outcome?.authority).toBe('moderator'); expect(s.room.muted).toEqual([`${provider}-2`]);
      // Muting one seat must not mark its same-provider twin as muted in the roster the moderator sees.
      const roster = ctx.requests.filter(r => r.room!.actor === 'moderator').at(-1)!.room!.roster;
      expect(roster.find(p => p.id === provider)).toMatchObject({ muted: false, label: `${provider} A` });
      expect(roster.find(p => p.id === `${provider}-2`)).toMatchObject({ muted: true, label: `${provider} B` });
      expect(s.messages.some(m => m.sender === provider && m.purpose === 'discussion')).toBe(true);
      expect(s.messages.some(m => m.sender === `${provider}-2` && m.purpose === 'discussion')).toBe(false);
    } finally { await ctx.cleanup(); }
  });

  it.each(providers)('fails closed when two %s seats are handed the same native session', async provider => {
    const ctx = await setup(undefined, () => ({ id: provider, backend: 'fake', async *run(r: TurnRequest): AsyncGenerator<AgentEvent> {
      yield { type: 'session', session: { id: 'shared-native-session', model: r.settings.model, backend: 'fake' } };
      yield { type: 'completed', model: r.settings.model, text: envelope(r, { type: 'none' }) };
    } }));
    try {
      const id = randomUUID(); await ctx.controller.create(id, input(seats(provider))); await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const s = ctx.controller.get(id); expect(s.pauseReason).toContain('another participant'); expect(s.room.sessions[`${provider}-2`]).toBeUndefined();
    } finally { await ctx.cleanup(); }
  });

  it('routes directed input only to configured seat ids', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID(); await ctx.controller.create(id, input(seats('claude')));
      await ctx.controller.send(id, randomUUID(), 'To the second Claude seat.', 'claude-2');
      await expect(ctx.controller.send(id, randomUUID(), 'To nobody.', 'claude-3')).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
    } finally { await ctx.cleanup(); }
  });
});

describe('seat id contract', () => {
  it('runs and resumes a seat named constructor without treating an inherited property as a session', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID(), actor: string = 'constructor', participants = seats('codex'); participants[0] = { ...participants[0]!, id: actor };
      await ctx.controller.create(id, input(participants, { flow: 'free' }));
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      expect(ctx.controller.get(id).room.contributions).toBe(2);
      const firstSession = ctx.controller.get(id).room.sessions[actor];
      expect(firstSession).toMatchObject({ backend: 'fake' });
      await ctx.controller.send(id, randomUUID(), 'Private follow-up.', 'constructor');
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const state = ctx.controller.get(id); expect(state.status).toBe('paused'); expect(state.room.contributions).toBe(4);
      expect(state.room.sessions[actor]).toEqual(expect.objectContaining({ id: firstSession!.id }));
    } finally { await ctx.cleanup(); }
  });
  it('accepts shared providers but rejects duplicate, reserved or malformed seat ids and labels', () => {
    const [first] = seats('claude');
    expect(roomInputSchema.safeParse(input(seats('claude'))).success).toBe(true);
    expect(roomInputSchema.safeParse(input([first!, first!])).success).toBe(false);
    for (const bad of ['moderator', 'user', 'all', 'both', 'Claude', '2fast', 'x'.repeat(25)])
      expect(roomInputSchema.safeParse(input([first!, { ...first!, id: bad }])).success, bad).toBe(false);
    expect(roomInputSchema.safeParse(input([first!, { ...first!, id: 'claude-2', label: '' }])).success).toBe(false);
    expect(roomInputSchema.parse(input([first!, { ...first!, id: 'claude-2', label: '  Padded  ' }])).participants[1]!.label).toBe('Padded');
  });

  it('still reads records whose seat ids equal their providers', () => {
    const legacy = (['codex', 'claude'] as const).map(provider => ({ id: provider, provider, role: 'speaker' as const, instructions: '', settings: { model: `fixture-${provider}`, effort: 'medium' as const } }));
    expect(roomInputSchema.safeParse(input(legacy)).success).toBe(true);
  });

  it('rejects room state that references an unknown seat', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID(); await ctx.controller.create(id, input(seats('codex')));
      const s = ctx.controller.get(id); expect(roomStateSchema.safeParse(s).success).toBe(true);
      const proposal = { id: randomUUID(), author: 'ghost', taskVersion: 1, result: 'x', dissent: [], unresolved: [], confirmed: [] };
      for (const room of [{ ...s.room, currentSpeaker: 'ghost' }, { ...s.room, muted: ['ghost'] }, { ...s.room, proposal }])
        expect(roomStateSchema.safeParse({ ...s, room }).success).toBe(false);
    } finally { await ctx.cleanup(); }
  });
});
