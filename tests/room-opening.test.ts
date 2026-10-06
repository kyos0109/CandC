import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DiscussionStore } from '../src/store.js';
import { RoomController } from '../src/room-controller.js';
import { RoomFakeAdapter, fakeRoomResponse } from '../src/adapters/room-fake.js';
import { buildPrompt, type TurnRequest } from '../src/adapters/types.js';
import { roomInputSchema, roomStateSchema, roomControlSchema, parseRoomAnswer, ROOM_CONTROL_START, ROOM_CONTROL_END, type RoomDiscussion, type RoomInput } from '../src/room-contract.js';
import { misplacedDeliveryCases, moveDeliveryOutsideAction } from './fixtures/misplaced-delivery.js';
import { waitUntil } from './helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function setup(respond = fakeRoomResponse, patch: Partial<RoomInput> = {}, delayMs = 0) {
  const directory = await mkdtemp(path.resolve('.cache/opening-test-')), requests: TurnRequest[] = [];
  if (!directory.startsWith(path.resolve('.cache') + path.sep)) throw new Error('Test cleanup must stay inside the workspace cache.');
  const controllers: RoomController[] = [];
  const build = async () => {
    const adapters = new Map<string, RoomFakeAdapter>();
    const controller = new RoomController(new DiscussionStore<RoomDiscussion>(directory, undefined, roomStateSchema), (provider, workspace) => {
      if (!adapters.has(workspace)) adapters.set(workspace, new RoomFakeAdapter(provider, r => { requests.push(r); return respond(r); }, delayMs));
      return adapters.get(workspace)!;
    });
    await controller.initialize(); controllers.push(controller); return controller;
  };
  const controller = await build(), id = randomUUID();
  await controller.create(id, roomInputSchema.parse({ behaviorVersion: 3, discussionPolicyVersion: 1, topic: 'Compare useful perspectives.', goal: 'An independent discussion.', mode: 'manual', flow: 'alternating', moderatorMode: 'facilitator',
    participants: ['claude', 'codex'].map(id => ({ id, provider: id, label: `${id} speaker`, role: 'speaker', instructions: `PRIVATE-ROLE-${id}`, settings: { model: 'fixture', effort: 'medium' } })),
    moderator: { id: 'moderator', provider: 'codex', role: 'moderator', settings: { model: 'fixture', effort: 'medium' } },
    limits: { maxRounds: 10, maxDurationMs: 30_000, turnTimeoutMs: 5_000, maxModeratorCalls: 100 }, ...patch }));
  cleanups.push(async () => { for (const c of controllers) await c.close(); await rm(directory, { recursive: true, force: true }); });
  return { controller, id, directory, requests, build, async run() { await controller.start(id, randomUUID()); await controller.wait(id); return controller.get(id); } };
}
function envelope(control: object) { return `Saved analysis.\n${ROOM_CONTROL_START}\n${JSON.stringify(control)}\n${ROOM_CONTROL_END}`; }
const delivery = { status: 'complete', kind: 'answer', basis: ['A stated argument with limitations.'] };
const control = () => ({ version: 3, taskVersion: 2, grantId: randomUUID(), continuation: 'yield', action: { type: 'propose', result: 'A qualified answer.', dissent: ['An alternative view.'], unresolved: ['A remaining uncertainty.'], delivery } });

describe('observed delivery nesting and facilitator opening', () => {
  it.each(misplacedDeliveryCases)('accepts only the known nesting error: $name', sample => {
    const value = { ...control(), continuation: sample.continuation, ...(sample.references ? { references: [{ messageId: randomUUID(), disposition: 'addressed', reason: 'Answered the public request.' }] } : {}) };
    const parsed = parseRoomAnswer(moveDeliveryOutsideAction(envelope(value)));
    expect(parsed.diagnostic).toBeUndefined(); expect(parsed.control?.action).toEqual(value.action);
  });
  it.each([
    { action: { type: 'none' } }, { action: { type: 'observe' } }, { action: { type: 'confirm', proposalId: randomUUID() } },
    { action: { ...control().action, delivery } }, { action: { ...control().action, delivery: null } },
    { extra: true }, { grantId: 'invalid' }, { taskVersion: -1 },
  ])('rejects conflicting, inappropriate or otherwise invalid controls: %j', patch => {
    const { delivery: _, ...action } = control().action;
    expect(parseRoomAnswer(envelope({ ...control(), action, delivery, ...patch })).diagnostic).toBe('schema');
  });
  it.each([
    { patch: { delivery: { ...delivery, extra: true } }, diagnostic: 'delivery-schema' },
    { patch: { delivery: null }, diagnostic: 'delivery-schema' },
    { patch: { work: { checkpoint: { answer: 'Invalid source.', sources: ['invalid'] } } }, diagnostic: 'work-schema' },
  ])('rejects optional claims without discarding a valid envelope: $diagnostic', ({ patch, diagnostic }) => {
    const { delivery: _, ...action } = control().action;
    const parsed = parseRoomAnswer(envelope({ ...control(), action, delivery, ...patch }));
    expect(parsed.control).not.toBeNull(); expect(parsed.diagnostic).toBeUndefined(); expect(parsed.metadataDiagnostics).toContain(diagnostic);
    if (diagnostic === 'delivery-schema') expect(parsed.control!.action).not.toHaveProperty('delivery');
    else expect(parsed.control).not.toHaveProperty('work');
  });
  it('opens before the scheduled first speaker without exposing private input or prescribing a verdict', async () => {
    const ctx = await setup(); await ctx.controller.send(ctx.id, randomUUID(), 'PRIVATE-INPUT-CODEX', 'codex');
    const s = await ctx.run();
    expect(ctx.requests.slice(0, 3).map(r => r.room!.actor)).toEqual(['moderator', 'claude', 'codex']);
    const opening = JSON.parse(buildPrompt(ctx.requests[0]!));
    expect(opening.openingSpeaker).toBe('claude'); expect(opening.openingPolicy).toContain('Do not answer');
    expect(opening.controlPolicy).toContain('Opening action: observe only'); expect(opening.conclusionPolicy).toBeUndefined();
    expect(JSON.stringify(opening)).not.toContain('PRIVATE-'); expect(opening.topic).toBe(s.topic);
    expect(s.room.calls[0]).toMatchObject({ participant: 'moderator', purpose: 'moderation', openingSpeaker: 'claude', status: 'completed' });
    expect(s.room.contributions).toBe(2); expect(s.room.calls.filter(c => c.purpose === 'monitor')).toHaveLength(0);
  });
  it('does not repeat the opening on continuation, reload, session reconstruction or additional input', async () => {
    const ctx = await setup(); await ctx.run(); await ctx.controller.start(ctx.id, randomUUID()); await ctx.controller.wait(ctx.id);
    await ctx.controller.close(); const bytes = await readFile(path.join(ctx.directory, ctx.id + '.jsonl'));
    const reloaded = await ctx.build(); expect(await readFile(path.join(ctx.directory, ctx.id + '.jsonl'))).toEqual(bytes);
    await reloaded.rebuild(ctx.id, randomUUID(), reloaded.get(ctx.id).room.taskVersion);
    await reloaded.send(ctx.id, randomUUID(), 'Consider this additional public point.', 'all');
    await reloaded.start(ctx.id, randomUUID()); await reloaded.wait(ctx.id);
    expect(reloaded.get(ctx.id).room.calls.filter(c => 'openingSpeaker' in c)).toHaveLength(1);
    expect(reloaded.get(ctx.id).room.contributions).toBe(6);
  });
  it('does not allow an opening invitation to replace the scheduled first speaker', async () => {
    const ctx = await setup(r => {
      const text = fakeRoomResponse(r); if (!(r.room && 'openingSpeaker' in r.room)) return text;
      const parsed = parseRoomAnswer(text);
      return envelope({ ...parsed.control, action: { type: 'speak', target: 'codex', task: 'Switch the first speaker.' } });
    });
    const s = await ctx.run();
    expect(ctx.requests[1]?.room?.actor).toBe('claude'); expect(s.room.commands[0]?.applied).toBe(false);
    expect(s.room.contributions).toBe(2);
  });
  it('honors pause during the opening and resumes without another opening', async () => {
    const ctx = await setup(fakeRoomResponse, {}, 10); await ctx.controller.start(ctx.id, randomUUID());
    await waitUntil(() => ctx.requests.length > 0); await ctx.controller.pause(ctx.id); await ctx.controller.wait(ctx.id);
    expect(ctx.controller.get(ctx.id).room.contributions).toBe(0);
    await ctx.run(); expect(ctx.requests.filter(r => r.room && 'openingSpeaker' in r.room)).toHaveLength(1);
    expect(ctx.controller.get(ctx.id).room.contributions).toBe(2);
  });
  it('honors stop during the opening without scheduling a speaker or automatically retrying', async () => {
    const ctx = await setup(fakeRoomResponse, {}, 10); await ctx.controller.start(ctx.id, randomUUID());
    await waitUntil(() => ctx.requests.length > 0); await ctx.controller.stop(ctx.id); await ctx.controller.wait(ctx.id);
    const s = ctx.controller.get(ctx.id);
    expect(s.status).toBe('stopped'); expect(s.room.contributions).toBe(0); expect(s.room.calls).toHaveLength(1);
    await expect(ctx.controller.start(ctx.id, randomUUID())).rejects.toMatchObject({ code: 'STOPPED' });
    expect(ctx.requests).toHaveLength(1);
  });
  it.each(['task-version', 'grant'] as const)('does not bypass %s validation while correcting delivery nesting', async diagnostic => {
    const ctx = await setup(r => {
      const text = fakeRoomResponse(r), parsed = parseRoomAnswer(text);
      if (parsed.control?.action.type !== 'propose') return text;
      const value = { ...parsed.control, ...(diagnostic === 'grant' ? { grantId: randomUUID() } : { taskVersion: parsed.control.taskVersion + 1 }) };
      return moveDeliveryOutsideAction(envelope(value));
    }, { mode: 'conclusion' });
    const s = await ctx.run(); expect(s.room.outcome).toBeNull(); expect(s.room.contributions).toBe(0);
    expect(s.room.calls.at(-1)?.controlDiagnostic).toBe(diagnostic); expect(s.room.calls).toHaveLength(2);
  });
  it.each(misplacedDeliveryCases)('continues to the peer and a reviewed outcome: $name', async sample => {
    const ctx = await setup(r => {
      const text = fakeRoomResponse(r), parsed = parseRoomAnswer(text);
      if (parsed.control?.action.type !== 'propose') return text;
      const value = { ...parsed.control, continuation: sample.continuation };
      if (!sample.references) value.references = [];
      return moveDeliveryOutsideAction(envelope(value));
    }, { mode: 'conclusion' });
    const s = await ctx.run();
    expect(s.room.contributions).toBe(2); expect(s.room.outcome?.authority).toBe('participants');
    expect(s.room.proposal?.confirmed).toEqual(['claude', 'codex']); expect(s.room.proposal?.reviews).toHaveLength(1);
    expect(s.room.calls.every(c => c.status === 'completed' && !c.controlDiagnostic)).toBe(true);
    const prompt = JSON.parse(buildPrompt(ctx.requests.find(r => r.room?.actor === 'codex')!));
    expect(prompt.deliveryControlPolicy).toContain('action.delivery'); expect(prompt.deliveryControlPolicy).toContain('action.review');
    for (const example of prompt.deliveryControlExamples) expect(roomControlSchema.safeParse(example).success).toBe(true);
  });
});
