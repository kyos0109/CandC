import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiscussionStore } from '../src/store.js';
import { RoomController } from '../src/room-controller.js';
import { roomInputSchema, roomStateSchema, ROOM_CONTROL_START, ROOM_CONTROL_END, type RoomControl, type RoomDiscussion, type RoomInput } from '../src/room-contract.js';
import { RoomFakeAdapter } from '../src/adapters/room-fake.js';
import { buildPrompt, type TurnRequest } from '../src/adapters/types.js';
import { conclusionPolicy, type ConclusionDelivery } from '../src/conclusion.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); });
const delivery: ConclusionDelivery = { status: 'complete', kind: 'answer', basis: ['Supporting reasoning from the saved discussion.'] };
const approved = { adequate: true, reason: 'The exact result supplies the requested answer and preserves its material limitations.', gaps: [] };
const proposal = (result = 'An answer with its operation, tradeoffs and limits.'): RoomControl['action'] => ({ type: 'propose', result, dissent: [], unresolved: [], delivery });
const envelope = (r: TurnRequest, action: RoomControl['action']) => {
  const peer = r.room!.messages.findLast(m => m.recipient === 'all' && m.sender !== 'user' && m.sender !== r.room!.actor);
  return `Saved public response for ${r.room!.actor}.\n${ROOM_CONTROL_START}\n${JSON.stringify({ version: 3, taskVersion: r.room!.taskVersion, grantId: r.room!.grantId, continuation: 'done', action,
    references: peer ? [{ messageId: peer.id, disposition: 'checked', reason: 'Peer argument assessed; this is a fixture.' }] : [] })}\n${ROOM_CONTROL_END}`;
};
async function setup(respond: (r: TurnRequest) => RoomControl['action'], patch: Partial<RoomInput> = {}) {
  const directory = await mkdtemp(path.resolve('.cache/conclusion-test-'));
  const store = new DiscussionStore<RoomDiscussion>(directory, undefined, roomStateSchema);
  const requests: TurnRequest[] = [];
  const createController = () => {
    const adapters = new Map<string, RoomFakeAdapter>();
    return new RoomController(new DiscussionStore<RoomDiscussion>(directory, undefined, roomStateSchema), (provider, workspace) => {
      if (!adapters.has(workspace)) adapters.set(workspace, new RoomFakeAdapter(provider, r => { requests.push(r); return envelope(r, respond(r)); }, 0));
      return adapters.get(workspace)!;
    });
  };
  const controller = createController(); await controller.initialize();
  const id = randomUUID();
  await controller.create(id, roomInputSchema.parse({ behaviorVersion: 3, discussionPolicyVersion: 1, topic: 'Design an exchange that responds to peer arguments.', mode: 'conclusion', moderator: null,
    participants: ['codex', 'claude'].map(id => ({ id, provider: id, role: 'speaker', settings: { model: 'fixture', effort: 'low' }, instructions: '' })),
    limits: { maxRounds: 6, maxDurationMs: 30_000, turnTimeoutMs: 5_000 }, ...patch }));
  cleanup.push(async () => { await controller.close(); await rm(directory, { recursive: true, force: true }); });
  return { controller, store, requests, directory, id, createController, async run() { await controller.start(id, randomUUID()); await controller.wait(id); return controller.get(id); } };
}

describe('conclusion delivery and independent review (deterministic, not semantic model evaluation)', () => {
  it('saves a metadata-free answer without accepting it as a conclusion; requests a correction within existing limits', async () => {
    const ctx = await setup(() => ({ type: 'propose', result: 'Implement a process and test it later.', dissent: [], unresolved: [] }), { limits: { maxRounds: 2, maxDurationMs: 30_000, turnTimeoutMs: 5_000, maxModeratorCalls: 20 } });
    const s = await ctx.run();
    expect(s.room.outcome).toBeNull(); expect(s.room.proposal).toBeNull();
    expect(s.room.contributions).toBe(4); expect(s.messages.filter(m => m.sender !== 'user')).toHaveLength(4);
    expect(ctx.requests[1]!.room!.task).toContain('requested answer itself');
  });
  it('does not count agreement without an independent delivery review', async () => {
    const ctx = await setup(r => r.room!.proposal ? { type: 'confirm', proposalId: r.room!.proposal.id } : proposal());
    const s = await ctx.run();
    expect(s.room.proposal!.confirmed).toEqual(['codex']); expect(s.room.outcome).toBeNull();
    expect(s.room.conclusionRequest?.reason).toContain('agreement alone');
    expect(s.room.contributions).toBe(5); expect(s.pauseReason).toContain('修正上限');
  });
  it('a peer rejects a work-list-only draft, the author supplies the answer, and every peer reviews the new version', async () => {
    let revision = 0;
    const ctx = await setup(r => {
      if (r.room!.actor === 'codex') return proposal(++revision === 1 ? 'Implement a process and test it later.' : 'Deliver public peer answers to independent sessions, connect each objection to its response, and retain disputed outcomes.');
      return { type: 'confirm', proposalId: r.room!.proposal!.id, review: revision === 1 ? { adequate: false, reason: 'The user requested an actual design, but this text only promises future work.', gaps: ['Specify how peers receive and respond to one another.'] } : approved };
    });
    const s = await ctx.run(); const records = await ctx.store.records(ctx.id);
    const first = records.find(r => r.state.room.proposal?.reviews?.some(v => !v.adequate))!.state;
    expect(first.room.outcome).toBeNull(); expect(first.room.proposal!.confirmed).toEqual(['codex']);
    expect(first.room.proposal!.reviews![0]!.gaps).toContain('Specify how peers receive and respond to one another.');
    expect(ctx.requests[2]!.room!.task).toContain('actual design');
    expect(s.room.proposal!.id).not.toBe(first.room.proposal!.id);
    const replaced = records.find(r => r.state.room.proposal?.id === s.room.proposal!.id)!.state;
    expect(replaced.room.proposal!.confirmed).toEqual(['codex']); expect(replaced.room.proposal!.reviews).toEqual([]);
    expect(s.room.outcome?.result).toContain('Deliver public peer answers'); expect(s.room.contributions).toBe(4);
    expect(s.room.outcome?.delivery).toEqual(delivery);
    const reloaded = ctx.createController(); await reloaded.initialize(); expect(reloaded.get(ctx.id)).toEqual(s); await reloaded.close();
  });
  it('does not accept adequate=true when the review still lists missing requested content', async () => {
    const ctx = await setup(r => r.room!.proposal && r.room!.actor !== r.room!.proposal.author ? { type: 'confirm', proposalId: r.room!.proposal.id, review: { ...approved, gaps: ['Requested comparison missing.'] } } : proposal());
    const s = await ctx.run(); expect(s.room.outcome).toBeNull(); expect(s.room.proposal!.confirmed).toEqual(['codex']);
  });
  it.each<ConclusionDelivery['kind']>(['answer', 'disagreement', 'undetermined'])('allows a complete %s response with honest reservations', async kind => {
    const ctx = await setup(r => r.room!.proposal ? { type: 'confirm', proposalId: r.room!.proposal.id, review: approved } : { type: 'propose', result: 'The requested answer, including the basis for its remaining uncertainty or distinct positions.', delivery: { ...delivery, kind }, dissent: ['A retained position.'], unresolved: ['A nonblocking limitation.'] });
    const s = await ctx.run(); expect(s.room.outcome?.delivery).toEqual({ ...delivery, kind }); expect(s.room.contributions).toBe(2);
    expect(s.room.outcome?.dissent).toEqual(['A retained position.']); expect(s.room.outcome?.unresolved).toEqual(['A nonblocking limitation.']);
  });
  it('retains partial delivery after agreement instead of declaring it complete', async () => {
    const ctx = await setup(r => r.room!.proposal ? { type: 'confirm', proposalId: r.room!.proposal.id, review: approved } : { type: 'propose', result: 'Only the first part of the requested answer is available.', delivery: { ...delivery, status: 'partial' }, dissent: [], unresolved: ['The second requested part is missing.'] });
    const s = await ctx.run(); expect(s.room.outcome?.delivery?.status).toBe('partial'); expect(s.room.outcome?.unresolved).toContain('The second requested part is missing.');
  });
  it('a partial result must specify the actual missing content', async () => {
    const ctx = await setup(() => ({ type: 'propose', result: 'Partial content.', delivery: { ...delivery, status: 'partial' }, dissent: [], unresolved: [] }));
    const s = await ctx.run(); expect(s.room.outcome).toBeNull(); expect(s.room.conclusionRequest?.reason).toContain('remains missing');
  });
  it.each(['Compare engineering alternatives.', 'Write a poem about autumn.', 'Explore competing philosophical positions.', 'Give me a plan and next steps.'])('uses the same neutral policy for %s', async topic => {
    const ctx = await setup(r => r.room!.proposal ? { type: 'confirm', proposalId: r.room!.proposal.id, review: approved } : proposal(topic), { topic });
    const s = await ctx.run(); expect(s.room.outcome?.result).toBe(topic);
    const prompts = ctx.requests.map(r => JSON.parse(buildPrompt(r)));
    expect(prompts.every(p => p.conclusionPolicy === conclusionPolicy)).toBe(true);
    expect(prompts[0].conclusionPolicy).toContain('no domain, scenario, fixed stages');
    expect(prompts[0].conclusionPolicy).toContain('unless the user requested a plan');
    expect(prompts[0].conclusionPolicy).toContain('creative forms remain valid');
  });
  it('manual boundaries still stop after one round even when a reviewer requests revision', async () => {
    const ctx = await setup(r => r.room!.proposal ? { type: 'confirm', proposalId: r.room!.proposal.id, review: { adequate: false, reason: 'Requested answer is incomplete.', gaps: ['Missing explanation.'] } } : proposal(), { mode: 'manual' });
    const s = await ctx.run(); expect(s.room.contributions).toBe(2); expect(s.room.outcome).toBeNull(); expect(s.room.conclusionRequest?.target).toBe('codex');
  });
  it('preserves a large valid review without exceeding the correction-task contract', async () => {
    const gaps = Array.from({ length: 10 }, (_, i) => `${i}:` + 'g'.repeat(2_000));
    const ctx = await setup(r => r.room!.proposal ? { type: 'confirm', proposalId: r.room!.proposal.id, review: { adequate: false, reason: 'Several parts of the requested answer are missing.', gaps } } : proposal(), { mode: 'manual' });
    const s = await ctx.run(); expect(s.room.proposal?.reviews?.[0]?.gaps).toEqual(gaps);
    expect(s.room.conclusionRequest!.reason.length).toBeLessThan(16_000); expect(s.pauseReason).not.toContain('INVALID_STATE');
    expect(roomStateSchema.safeParse(s).success).toBe(true);
  });
  it('rejects persisted confirmation with unknown peer-review provenance', async () => {
    const ctx = await setup(r => r.room!.proposal ? { type: 'confirm', proposalId: r.room!.proposal.id, review: approved } : proposal());
    const s = await ctx.run(); s.room.proposal!.reviews![0]!.callId = randomUUID();
    expect(roomStateSchema.safeParse(s).success).toBe(false);
  });
  it('an authorized judge must supply delivery metadata but does not need fabricated peer agreement', async () => {
    let finishes = 0;
    const ctx = await setup(() => ({ type: 'finish', result: 'A ruling with a supporting explanation.', dissent: [], unresolved: [], ...(++finishes > 1 ? { delivery } : {}) }), { discussionPolicyVersion: undefined, moderatorMode: 'judge', moderator: { id: 'moderator', provider: 'codex', role: 'moderator', settings: { model: 'fixture', effort: 'low' } } });
    const s = await ctx.run(); expect(s.room.commands.map(c => c.applied)).toEqual([false, true]); expect(s.room.outcome?.authority).toBe('moderator');
    expect(s.room.outcome?.delivery).toEqual(delivery); expect(s.room.contributions).toBe(0);
  });
  it('loads legacy proposals without rewriting them and clears their unchecked confirmations only on explicit continuation', async () => {
    const ctx = await setup(r => r.room!.proposal ? { type: 'confirm', proposalId: r.room!.proposal.id, review: approved } : proposal());
    const s = ctx.controller.get(ctx.id); const { deliveryVersion: _, conclusionRequest: __, ...legacyRoom } = s.room;
    const legacy = { ...s, room: { ...legacyRoom, proposal: { id: randomUUID(), author: 'codex', taskVersion: 1, result: 'Legacy draft.', dissent: [], unresolved: [], confirmed: ['codex', 'claude'] } } };
    await ctx.controller.close(); const file = path.join(ctx.directory, ctx.id + '.jsonl');
    // Seed a pre-policy journal in this test's owned directory, rather than deleting fields with an append-only patch.
    await writeFile(file, JSON.stringify({ state: legacy, event: { discussionId: ctx.id, sequence: legacy.sequence, type: 'created', at: new Date().toISOString(), data: {}, commitId: randomUUID() } }) + '\n');
    const bytes = await readFile(file);
    const reloaded = ctx.createController(); await reloaded.initialize();
    expect(await readFile(file)).toEqual(bytes); expect(reloaded.get(ctx.id).room.proposal?.confirmed).toHaveLength(2);
    await reloaded.start(ctx.id, randomUUID()); await reloaded.wait(ctx.id);
    expect(ctx.requests[0]!.room!.proposal).toBeNull(); expect(reloaded.get(ctx.id).room.deliveryVersion).toBe(1);
    expect(reloaded.get(ctx.id).room.outcome?.delivery).toEqual(delivery); await reloaded.close();
  });
});
