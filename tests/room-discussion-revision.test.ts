import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiscussionStore } from '../src/store.js';
import { RoomController } from '../src/room-controller.js';
import { RoomFakeAdapter, fakeRoomResponse } from '../src/adapters/room-fake.js';
import { buildPrompt, type TurnRequest } from '../src/adapters/types.js';
import { roomInputSchema, roomStateSchema, parseRoomAnswer, ROOM_CONTROL_START, ROOM_CONTROL_END, type RoomControl, type RoomDiscussion, type RoomInput } from '../src/room-contract.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
const delivery = { status: 'complete', kind: 'answer', basis: ['Reasoned public assessment.'] } as const;
const review = { adequate: true, reason: 'Independently assessed the exact public answer.', gaps: [] };
const proposal = (): RoomControl['action'] => ({ type: 'propose', result: 'A reviewed answer with reservations.', dissent: ['A retained objection.'], unresolved: ['A remaining uncertainty.'], delivery: { ...delivery, basis: [...delivery.basis] } });
function response(r: TurnRequest, action: RoomControl['action'] = { type: 'none' }, extra: object = {}, continuation = 'yield') {
  const peer = r.room!.messages.findLast(m => m.sender !== 'user' && m.sender !== r.room!.actor && m.recipient === 'all' && m.purpose === 'discussion');
  return `Public analysis by ${r.room!.actor}.\n${ROOM_CONTROL_START}\n${JSON.stringify({ version: 3, taskVersion: r.room!.taskVersion, grantId: r.room!.grantId, action, continuation,
    references: peer ? [{ messageId: peer.id, disposition: 'checked', reason: 'Public peer argument assessed.' }] : [], ...extra })}\n${ROOM_CONTROL_END}`;
}
async function setup(respond = fakeRoomResponse, patch: Partial<RoomInput> = {}) {
  const directory = await mkdtemp(path.resolve('.cache/discussion-revision-'));
  if (!directory.startsWith(path.resolve('.cache') + path.sep)) throw new Error('Cleanup must stay in the workspace cache.');
  const requests: TurnRequest[] = [], controllers: RoomController[] = [], storageErrors: unknown[] = [];
  const build = async () => {
    const adapters = new Map<string, RoomFakeAdapter>();
    const store = new DiscussionStore<RoomDiscussion>(directory, undefined, roomStateSchema);
    const commit = store.commit.bind(store);
    store.commit = async (...args) => { try { await commit(...args); } catch (error) { storageErrors.push(error); throw error; } };
    const controller = new RoomController(store, (provider, workspace) => {
      if (!adapters.has(workspace)) adapters.set(workspace, new RoomFakeAdapter(provider, r => { requests.push(r); return respond(r); }, 0));
      return adapters.get(workspace)!;
    });
    await controller.initialize(); controllers.push(controller); return controller;
  };
  const controller = await build(), id = randomUUID();
  await controller.create(id, roomInputSchema.parse({ behaviorVersion: 3, discussionPolicyVersion: 1, topic: 'Discuss the original question freely.', mode: 'auto', flow: 'alternating', moderator: null,
    participants: ['codex', 'claude'].map(id => ({ id, provider: id, role: 'speaker', instructions: '', settings: { model: 'fixture', effort: 'low' } })),
    limits: { maxRounds: 2, maxDurationMs: 30_000, turnTimeoutMs: 5_000 }, ...patch }));
  cleanups.push(async () => { for (const c of controllers) await c.close(); await rm(directory, { recursive: true, force: true }); });
  return { controller, id, requests, directory, build, storageErrors, async run() { await controller.start(id, randomUUID()); await controller.wait(id); return controller.get(id); } };
}
const moderator = { id: 'moderator', provider: 'codex', role: 'moderator', settings: { model: 'fixture', effort: 'low' } } as const;

describe('neutral discussion, reviewed stages and optional metadata', () => {
  it.each(['free', 'alternating'] as const)('pauses a reviewed proposal without repeatedly calling done speakers in %s flow', async flow => {
    let reviewed = false;
    const ctx = await setup(r => {
      if (r.room!.actor === 'moderator') return response(r, { type: 'observe' }, {}, 'done');
      if (!r.room!.proposal) return response(r, proposal(), {}, 'done');
      if (r.room!.actor === 'claude' && !reviewed) {
        reviewed = true;
        return response(r, { type: 'confirm', proposalId: r.room!.proposal.id,
          review: { adequate: true, reason: 'The conditional answer is acceptable, but requested evidence remains missing.', gaps: ['Verify the requested evidence.'] } }, {}, 'done');
      }
      return response(r, { type: 'none' }, {}, 'done');
    }, { mode: 'conclusion', flow, moderator, limits: { maxRounds: 8, maxDurationMs: 30_000, turnTimeoutMs: 5_000, maxModeratorCalls: 30 } });
    const s = await ctx.run();
    expect(ctx.requests.filter(r => r.room!.actor !== 'moderator').map(r => r.room!.actor)).toEqual(['codex', 'claude', 'codex', 'claude']);
    expect(s.status).toBe('paused'); expect(s.pauseReason).toContain('提案尚未通過審查');
    expect(s.room.proposal?.reviews?.[0]?.gaps).toEqual(['Verify the requested evidence.']);
    expect(s.room.proposal?.confirmed).toEqual(['codex']); expect(s.room.outcome).toBeNull();
    expect(s.room.interimResults ?? []).toEqual([]); expect(ctx.storageErrors).toEqual([]);
  });
  it('runs a queued task despite done speakers and pauses only after that task and the peer response finish', async () => {
    const ctx = await setup(r => {
      if (!r.room!.proposal) return response(r, proposal(), {}, 'done');
      if (r.room!.actor === 'claude' && !r.room!.proposal.reviews?.length) return response(r,
        { type: 'confirm', proposalId: r.room!.proposal.id, review: { adequate: false, reason: 'Evidence is missing.', gaps: ['Obtain evidence.'] } }, {}, 'done');
      if (r.room!.conclusionRequest?.kind === 'review') return response(r, { type: 'none' }, { work: {
        tasks: [{ key: 'follow-up', kind: 'analysis', target: 'codex', task: 'Examine the retained limitation.', sources: [r.messageId] }],
      } }, 'done');
      if (r.room!.execution?.currentTaskKey === 'follow-up') return response(r, { type: 'none' }, { work: {
        completedTasks: [{ key: 'follow-up', sources: [r.messageId] }],
      } }, 'done');
      return response(r, { type: 'none' }, {}, 'done');
    }, { mode: 'conclusion', limits: { maxRounds: 8, maxDurationMs: 30_000, turnTimeoutMs: 5_000, maxModeratorCalls: 30 } });
    const s = await ctx.run();
    expect(ctx.requests.map(r => r.room!.actor)).toEqual(['codex', 'claude', 'codex', 'codex', 'claude']);
    expect(s.room.workflow?.tasks).toMatchObject([{ key: 'follow-up', status: 'completed' }]);
    expect(s.status).toBe('paused'); expect(s.pauseReason).toContain('提案尚未通過審查'); expect(s.room.outcome).toBeNull();
    expect(s.room.proposal?.confirmed).toEqual(['codex']); expect(ctx.storageErrors).toEqual([]);
  });
  it.each(['auto', 'conclusion'] as const)('%s hands substantive review back to peers after a rebuttal or neutral fallback', async mode => {
    for (const shape of ['none', 'downgraded'] as const) {
      let rejected = false;
      const ctx = await setup(r => {
        if (!r.room!.proposal) return response(r, proposal());
        if (r.room!.actor === 'claude' && !rejected) {
          rejected = true;
          return response(r, { type: 'confirm', proposalId: r.room!.proposal.id, review: { adequate: false, reason: 'The trade-off remains disputed.', gaps: ['Address the cost.'] } });
        }
        return response(r, { type: 'none' }, shape === 'downgraded' && r.room!.conclusionRequest?.target === r.room!.actor ? { unknown: true } : {});
      }, { mode });
      const s = await ctx.run(); expect(ctx.requests.map(r => r.room!.actor)).toEqual(['codex', 'claude', 'codex', 'claude']);
      expect(ctx.requests[2]!.room!.conclusionRequest?.kind).toBe('review'); expect(ctx.requests[3]!.room!.conclusionRequest).toBeNull();
      const subsequentPeer = JSON.parse(buildPrompt(ctx.requests[3]!));
      expect(subsequentPeer.conclusionPolicy).toBeUndefined(); expect(subsequentPeer.deliveryControlExamples).toBeUndefined();
      expect(subsequentPeer.proposal).toEqual(ctx.requests[3]!.room!.proposal);
      expect(s.room.proposal!.confirmed).toEqual(['codex']); expect(s.room.proposal!.reviews![0]!.adequate).toBe(false);
      expect(s.room.conclusionRequest).toBeNull(); expect(s.room.outcome).toBeNull(); expect(s.room.interimResults ?? []).toEqual([]);
      if (shape === 'downgraded') expect(s.room.calls[2]!.metadataDiagnostics).toContain('control-schema');
    }
  });
  it('consumes a review response before a manual boundary and does not restore it on reload', async () => {
    let rejected = false;
    const ctx = await setup(r => !r.room!.proposal ? response(r, proposal()) : r.room!.actor === 'claude' && !rejected ?
      (rejected = true, response(r, { type: 'confirm', proposalId: r.room!.proposal.id, review: { adequate: false, reason: 'A retained objection.', gaps: ['Explain the cost.'] } })) : response(r),
    { mode: 'manual', limits: { maxRounds: 3, maxDurationMs: 30_000, turnTimeoutMs: 5_000, maxModeratorCalls: 20 } });
    const first = await ctx.run(); expect(first.room.conclusionRequest?.kind).toBe('review');
    await ctx.run(); const rebuttal = ctx.controller.get(ctx.id); expect(rebuttal.room.conclusionRequest).toBeNull();
    expect(ctx.requests.map(r => r.room!.actor)).toEqual(['codex', 'claude', 'codex', 'claude']); expect(rebuttal.room.proposal!.confirmed).toEqual(['codex']);
    await ctx.controller.close(); const loaded = await ctx.build(); expect(loaded.get(ctx.id).room.conclusionRequest).toBeNull();
    expect(loaded.get(ctx.id).room.proposal).toEqual(rebuttal.room.proposal);
  });
  it('consumes a legacy untyped review request after its author responds', async () => {
    let rejected = false;
    const ctx = await setup(r => {
      if (!r.room!.proposal) return response(r, proposal());
      if (r.room!.actor === 'claude' && !rejected) {
        rejected = true; return response(r, { type: 'confirm', proposalId: r.room!.proposal.id,
          review: { adequate: false, reason: 'A retained legacy objection.', gaps: ['Explain the cost.'] } });
      }
      return response(r);
    }, { mode: 'manual' });
    await ctx.run(); await ctx.controller.close();
    const records = await new DiscussionStore<RoomDiscussion>(ctx.directory, undefined, roomStateSchema).records(ctx.id);
    for (const { state } of records) if (state.room.conclusionRequest?.kind === 'review') delete state.room.conclusionRequest.kind;
    await writeFile(path.join(ctx.directory, ctx.id + '.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
    const loaded = await ctx.build(); expect(loaded.get(ctx.id).room.conclusionRequest?.kind).toBeUndefined();
    await loaded.start(ctx.id, randomUUID()); await loaded.wait(ctx.id);
    expect(ctx.requests.map(r => r.room!.actor)).toEqual(['codex', 'claude', 'codex', 'claude']);
    expect(loaded.get(ctx.id).room.conclusionRequest).toBeNull(); expect(loaded.get(ctx.id).room.proposal!.confirmed).toEqual(['codex']);
  });
  it('retains a new technical repair request created by the substantive response', async () => {
    const ctx = await setup(r => response(r, !r.room!.proposal ? proposal() : r.room!.actor === 'claude' ?
      { type: 'confirm', proposalId: r.room!.proposal.id, review: { adequate: false, reason: 'Missing requested reasoning.', gaps: ['Explain the cost.'] } } :
      { type: 'propose', result: 'A revised public answer without delivery metadata.', dissent: [], unresolved: [] }));
    const s = await ctx.run(); expect(ctx.requests.map(r => r.room!.actor)).toEqual(['codex', 'claude', 'codex', 'codex']);
    expect(ctx.requests[2]!.room!.conclusionRequest?.kind).toBe('review'); expect(ctx.requests[3]!.room!.conclusionRequest?.kind).toBe('repair');
    expect(s.room.conclusionRequest?.kind).toBe('repair'); expect(s.room.proposal!.confirmed).toEqual(['codex']); expect(s.room.outcome).toBeNull();
  });
  it('does not consume a substantive request on a failed provider response', async () => {
    const ctx = await setup(r => {
      if (r.room!.conclusionRequest?.kind === 'review') throw new Error('Fixture provider failure before a completed rebuttal.');
      return response(r, !r.room!.proposal ? proposal() : { type: 'confirm', proposalId: r.room!.proposal.id,
        review: { adequate: false, reason: 'Unresolved objection.', gaps: ['Explain the cost.'] } });
    });
    const s = await ctx.run(); expect(s.room.calls[2]!.status).toBe('failed'); expect(s.room.conclusionRequest?.kind).toBe('review');
    expect(s.room.proposal!.confirmed).toEqual(['codex']); expect(s.room.outcome).toBeNull();
  });
  it.each(['none', 'downgraded'] as const)('a %s review response restores the deferred facilitator invitation', async shape => {
    let rejected = false;
    const ctx = await setup(r => {
      if (r.room!.actor === 'moderator') return response(r, r.room!.openingSpeaker ? { type: 'observe' } : { type: 'speak', target: 'claude', task: 'Respond to the public rebuttal.' });
      if (!r.room!.proposal) return response(r, proposal());
      if (r.room!.actor === 'claude' && !rejected) {
        rejected = true; return response(r, { type: 'confirm', proposalId: r.room!.proposal.id, review: { adequate: false, reason: 'An unresolved trade-off.', gaps: ['Explain the cost.'] } });
      }
      return response(r, { type: 'none' }, shape === 'downgraded' && r.room!.conclusionRequest?.kind === 'review' ? { unknown: true } : {});
    }, { moderator, moderatorMode: 'facilitator' });
    const s = await ctx.run(), speakers = ctx.requests.filter(r => r.room!.actor !== 'moderator');
    expect(speakers.map(r => r.room!.actor)).toEqual(['codex', 'claude', 'codex', 'claude']);
    expect(speakers[3]!.room!.task).toContain('Respond to the public rebuttal.'); expect(s.room.conclusionRequest).toBeNull();
    expect(s.room.proposal!.confirmed).toEqual(['codex']); expect(s.room.outcome).toBeNull();
  });
  it('does not charge substantive peer rejections to the format repair budget', async () => {
    const ctx = await setup(r => response(r, r.room!.proposal && r.room!.proposal.author !== r.room!.actor ?
      { type: 'confirm', proposalId: r.room!.proposal.id, review: { adequate: false, reason: 'The explanation remains incomplete.', gaps: ['Explain the trade-off.'] } } : proposal()),
    { limits: { maxRounds: 6, maxDurationMs: 30_000, turnTimeoutMs: 5_000, maxModeratorCalls: 20 } });
    const s = await ctx.run(); expect(s.room.contributions).toBe(12); expect(s.room.outcome).toBeNull();
    expect(s.pauseReason).not.toContain('修正上限'); expect(s.room.proposal!.reviews![0]!.adequate).toBe(false);
  });
  it('resets format repairs across independently resolved delivery and review episodes', async () => {
    let turn = 0;
    const ctx = await setup(r => {
      const phase = turn++ % 4;
      return response(r, phase === 0 ? { type: 'propose', result: 'A saved answer needing metadata.', dissent: [], unresolved: [] } : phase === 1 ? proposal() :
        { type: 'confirm', proposalId: r.room!.proposal!.id, ...(phase === 3 ? { review } : {}) });
    }, { limits: { maxRounds: 8, maxDurationMs: 30_000, turnTimeoutMs: 5_000, maxModeratorCalls: 20 } });
    const s = await ctx.run(); expect(ctx.storageErrors.map(String)).toEqual([]); expect(s.room.contributions).toBe(16); expect(s.room.interimResults).toHaveLength(4); expect(s.room.outcome).toBeNull();
    await ctx.controller.close(); const bytes = await readFile(path.join(ctx.directory, ctx.id + '.jsonl'));
    const reloaded = await ctx.build(); expect(reloaded.get(ctx.id).room.interimResults).toEqual(s.room.interimResults);
    expect(await readFile(path.join(ctx.directory, ctx.id + '.jsonl'))).toEqual(bytes);
  });
  it.each(['auto', 'conclusion'] as const)('%s treats exhausted format repairs according to execution mode', async mode => {
    const ctx = await setup(r => response(r, { type: 'propose', result: 'Saved public reasoning.', dissent: [], unresolved: [] }),
      { mode, limits: { maxRounds: 4, maxDurationMs: 30_000, turnTimeoutMs: 5_000, maxModeratorCalls: 20 } });
    const s = await ctx.run(); expect(s.room.outcome).toBeNull(); expect(s.room.interimResults ?? []).toEqual([]);
    expect(s.room.contributions).toBe(mode === 'auto' ? 8 : 4);
    if (mode === 'auto') expect(s.room.calls.some(c => c.metadataDiagnostics?.includes('delivery-repair-limit'))).toBe(true);
    else expect(s.pauseReason).toContain('修正上限');
  });
  it('defers and retains an invitation while its peer supplies the missing review', async () => {
    let reviews = 0;
    const ctx = await setup(r => {
      if (r.room!.actor === 'moderator') return response(r, r.room!.openingSpeaker ? { type: 'observe' } : { type: 'speak', target: 'codex', task: 'Discuss the retained public objection.' });
      return response(r, !r.room!.proposal ? r.room!.messages.some(m => m.sender !== 'user' && m.purpose === 'discussion') ? { type: 'none' } : proposal() :
        { type: 'confirm', proposalId: r.room!.proposal.id, ...(reviews++ ? { review } : {}) });
    }, { moderator, moderatorMode: 'facilitator' });
    const s = await ctx.run(), speakers = ctx.requests.filter(r => r.room!.actor !== 'moderator');
    expect(speakers.map(r => r.room!.actor)).toEqual(['codex', 'claude', 'claude', 'codex']);
    expect(speakers[3]!.room!.task).toContain('retained public objection'); expect(s.room.interimResults).toHaveLength(1);
  });
  it.each(['root-review', 'confirm-delivery', 'missing-continuation', 'unknown-field', 'unknown-action', 'missing-action'] as const)('safely downgrades %s without accepting its claims or stopping peers', async shape => {
    const ctx = await setup(r => {
      const value = JSON.parse(response(r).split(ROOM_CONTROL_START)[1]!.split(ROOM_CONTROL_END)[0]!);
      value.work = { questions: [{ key: 'rejected_question', text: 'Unaccepted metadata.', reason: '', sources: [r.messageId] }] };
      if (shape === 'root-review') value.review = review;
      if (shape === 'confirm-delivery') value.action = { type: 'confirm', proposalId: randomUUID(), delivery };
      if (shape === 'missing-continuation') delete value.continuation;
      if (shape === 'unknown-field') value.extra = 'Rejected raw payload.';
      if (shape === 'unknown-action') value.action = { type: 'unexpected' };
      if (shape === 'missing-action') delete value.action;
      return `Saved public reasoning.\n${ROOM_CONTROL_START}\n${JSON.stringify(value)}\n${ROOM_CONTROL_END}`;
    });
    const s = await ctx.run(); expect(s.room.contributions).toBe(4); expect(s.room.outcome).toBeNull(); expect(s.room.proposal).toBeNull();
    expect(s.room.workflow!.questions).toEqual([]); expect(s.room.calls.every(c => !c.controlDiagnostic && c.metadataDiagnostics?.includes('control-schema'))).toBe(true);
    expect(s.room.calls.every(c => c.references.length === 0)).toBe(true);
  });
  it('downgrades malformed opening control to observe and keeps the reserved first speaker', async () => {
    const ctx = await setup(r => r.room!.openingSpeaker ? response(r, { type: 'observe' }, { review }) : fakeRoomResponse(r), { mode: 'manual', moderator });
    const s = await ctx.run(); expect(ctx.requests.slice(0, 3).map(r => r.room!.actor)).toEqual(['moderator', 'codex', 'claude']);
    expect(s.room.commands[0]!.action.type).toBe('observe'); expect(s.room.contributions).toBe(2);
    expect(s.room.calls[0]!.metadataDiagnostics).toContain('control-schema');
  });
  it.each(['task-version', 'grant', 'invalid-identity', 'version'] as const)('does not downgrade malformed control with %s', async fault => {
    const ctx = await setup(r => {
      const value = { version: fault === 'version' ? 99 : 3, taskVersion: fault === 'task-version' ? 999 : fault === 'invalid-identity' ? '1' : r.room!.taskVersion,
        grantId: fault === 'grant' ? randomUUID() : r.room!.grantId, action: { type: 'unexpected' }, continuation: 'yield' };
      return `Saved answer.\n${ROOM_CONTROL_START}\n${JSON.stringify(value)}\n${ROOM_CONTROL_END}`;
    });
    const s = await ctx.run(); expect(ctx.requests).toHaveLength(1); expect(s.room.contributions).toBe(0);
    expect(s.room.calls[0]!.controlDiagnostic).toBe(fault === 'task-version' || fault === 'grant' ? fault : 'schema');
    expect(s.room.calls[0]!.metadataDiagnostics ?? []).not.toContain('control-schema'); expect(s.room.outcome).toBeNull();
  });
  it('does not neutralize a valid speaker control that requests moderator authority', async () => {
    const ctx = await setup(r => response(r, { type: 'pause', reason: 'Unauthorized speaker command.' }));
    const s = await ctx.run(); expect(ctx.requests).toHaveLength(1); expect(s.pauseReason).toContain('Speaker cannot issue moderator commands');
    expect(s.room.calls[0]!.metadataDiagnostics ?? []).not.toContain('control-schema'); expect(s.room.commands).toEqual([]);
  });
  it.each(['manual', 'auto', 'conclusion'] as const)('initial %s exchanges do not receive the full conclusion policy or conclusion examples', async mode => {
    const ctx = await setup(r => response(r), { mode }); await ctx.run();
    const first = JSON.parse(buildPrompt(ctx.requests[0]!));
    expect(first.conclusionPolicy).toBeUndefined(); expect(first.deliveryControlExamples).toBeUndefined();
    expect(first.controlPolicy).toContain('continue means'); expect(first.controlPolicy).toContain('done means');
  });
  it('facilitator opening and routine coordination never receive speaker delivery instructions', async () => {
    const ctx = await setup(fakeRoomResponse, { mode: 'manual', moderator, moderatorMode: 'facilitator' }); await ctx.run();
    for (const r of ctx.requests.filter(r => r.room!.actor === 'moderator')) {
      const p = JSON.parse(buildPrompt(r)); expect(p.conclusionPolicy).toBeUndefined(); expect(p.deliveryControlExamples).toBeUndefined();
      expect(p.policy).toContain('connect'); expect(p.policy).not.toContain('prefer observe and silence');
    }
  });
  it('supplies symmetric exact peer review examples only when there is a peer proposal', async () => {
    const ctx = await setup(r => response(r, r.room!.proposal ? { type: 'confirm', proposalId: r.room!.proposal.id, review } : proposal()), { mode: 'conclusion' });
    const s = await ctx.run(); expect(s.room.outcome?.authority).toBe('participants'); expect(s.room.contributions).toBe(2);
    const peer = JSON.parse(buildPrompt(ctx.requests[1]!)); expect(peer.conclusionPolicy).toBeDefined();
    expect(peer.deliveryControlExamples).toHaveLength(2);
    expect(peer.deliveryControlExamples.map((p: { action: { review: { adequate: boolean } } }) => p.action.review.adequate)).toEqual([false, true]);
    expect(peer.deliveryControlExamples.every((p: { action: { proposalId: string } }) => p.action.proposalId === s.room.proposal!.id)).toBe(true);
    expect(peer.reviewExamplePolicy).toContain('equally available');
  });
  it('does not repeat accepted review instructions while another peer has not reviewed', async () => {
    const ctx = await setup(r => response(r, !r.room!.proposal ? proposal() : r.room!.actor === 'claude' && !r.room!.proposal.reviews?.some(v => v.actor === 'claude') ?
      { type: 'confirm', proposalId: r.room!.proposal.id, review } : { type: 'none' }),
    { participants: ['codex', 'claude', 'codex-2'].map(id => ({ id, provider: id === 'claude' ? 'claude' : 'codex', role: 'speaker', instructions: '', settings: { model: 'fixture', effort: 'low' } })) });
    const s = await ctx.run(), peerTurns = ctx.requests.filter(r => r.room!.actor === 'claude');
    expect(peerTurns).toHaveLength(2);
    expect(JSON.parse(buildPrompt(peerTurns[0]!)).conclusionPolicy).toBeDefined();
    const unreviewedPeer = ctx.requests.find(r => r.room!.actor === 'codex-2')!;
    expect(unreviewedPeer.room!.proposal!.reviews![0]!.actor).toBe('claude');
    expect(JSON.parse(buildPrompt(unreviewedPeer)).conclusionPolicy).toBeDefined();
    const repeated = JSON.parse(buildPrompt(peerTurns[1]!));
    expect(repeated.conclusionPolicy).toBeUndefined(); expect(repeated.deliveryControlExamples).toBeUndefined();
    expect(repeated.proposal).toEqual(peerTurns[1]!.room!.proposal); expect(s.room.proposal!.confirmed).toEqual(['codex', 'claude']);
    expect(s.room.outcome).toBeNull(); expect(s.room.interimResults ?? []).toEqual([]);
  });
  it('restores independent review instructions for a replacement proposal', async () => {
    let rejected = false;
    const ctx = await setup(r => response(r, r.room!.actor === 'codex' ? proposal() :
      { type: 'confirm', proposalId: r.room!.proposal!.id, review: rejected ? review :
        (rejected = true, { adequate: false, reason: 'The first proposal omits requested reasoning.', gaps: ['Explain the trade-off.'] }) }));
    await ctx.run(); const peers = ctx.requests.filter(r => r.room!.actor === 'claude');
    expect(peers).toHaveLength(2); expect(peers[1]!.room!.proposal!.id).not.toBe(peers[0]!.room!.proposal!.id);
    expect(peers[1]!.room!.proposal!.reviews).toEqual([]);
    for (const r of peers) {
      const p = JSON.parse(buildPrompt(r)); expect(p.conclusionPolicy).toBeDefined();
      expect(p.deliveryControlExamples.every((v: { action: { type: string; proposalId: string } }) => v.action.type === 'confirm' && v.action.proposalId === r.room!.proposal!.id)).toBe(true);
    }
  });
  it('retains exact confirmation repair examples for a peer that already rejected the proposal', async () => {
    let turn = 0;
    const ctx = await setup(r => {
      const phase = turn++;
      return response(r, phase === 0 ? proposal() : phase === 1 ? { type: 'confirm', proposalId: r.room!.proposal!.id,
        review: { adequate: false, reason: 'A disputed trade-off.', gaps: ['Explain the cost.'] } } : phase === 3 ?
        { type: 'confirm', proposalId: randomUUID(), review } : phase === 4 ? { type: 'confirm', proposalId: r.room!.proposal!.id, review } : { type: 'none' });
    }, { limits: { maxRounds: 3, maxDurationMs: 30_000, turnTimeoutMs: 5_000, maxModeratorCalls: 20 } });
    await ctx.run(); const correction = ctx.requests[4]!;
    expect(correction.room!.conclusionRequest).toMatchObject({ target: 'claude', kind: 'repair' });
    expect(correction.room!.proposal!.reviews![0]!.adequate).toBe(false);
    const p = JSON.parse(buildPrompt(correction)); expect(p.conclusionPolicy).toBeDefined();
    expect(p.deliveryControlExamples).toHaveLength(2);
    expect(p.deliveryControlExamples.every((v: { action: { type: string; proposalId: string } }) => v.action.type === 'confirm' && v.action.proposalId === correction.room!.proposal!.id)).toBe(true);
  });
  it.each(['auto', 'manual'] as const)('%s saves reviewed stages without ending the discussion and reloads them unchanged', async mode => {
    const ctx = await setup(r => response(r, r.room!.proposal ? { type: 'confirm', proposalId: r.room!.proposal.id, review } :
      r.room!.messages.some(m => m.sender !== 'user' && m.purpose === 'discussion') ? { type: 'none' } : proposal()), { mode });
    const s = await ctx.run(); expect(s.room.outcome).toBeNull(); expect(s.room.proposal).toBeNull();
    expect(s.room.interimResults).toHaveLength(1); expect(s.room.interimResults![0]).toMatchObject({ confirmed: ['codex', 'claude'], dissent: ['A retained objection.'], delivery });
    expect(s.room.contributions).toBe(mode === 'auto' ? 4 : 2);
    if (mode === 'manual') { await ctx.run(); expect(ctx.controller.get(ctx.id).room.contributions).toBe(4); }
    await ctx.controller.close(); const bytes = await readFile(path.join(ctx.directory, ctx.id + '.jsonl'));
    const loaded = await ctx.build(); expect(await readFile(path.join(ctx.directory, ctx.id + '.jsonl'))).toEqual(bytes);
    expect(loaded.get(ctx.id).room.interimResults).toEqual(s.room.interimResults);
  });
  it.each(['work', 'references', 'delivery', 'review'] as const)('invalid optional %s rejects only its claims and records a safe diagnostic', field => {
    const r = { room: { actor: 'codex', taskVersion: 1, grantId: randomUUID(), messages: [] } } as unknown as TurnRequest;
    const text = field === 'delivery' ? response(r, { ...proposal(), delivery: { ...delivery, basis: [] } } as RoomControl['action']) :
      field === 'review' ? response(r, { type: 'confirm', proposalId: randomUUID(), review: { adequate: true } } as RoomControl['action']) :
      response(r, { type: 'none' }, { [field]: field === 'work' ? { tasks: [{ key: 'invalid key' }] } : [{ messageId: 'invalid' }] });
    const parsed = parseRoomAnswer(text); expect(parsed.control).not.toBeNull(); expect(parsed.diagnostic).toBeUndefined();
    expect(parsed.metadataDiagnostics).toContain(field + '-schema');
  });
  it.each(['duplicate-confirmation', 'missing-review', 'wrong-review-call', 'fatal-call', 'summary-call', 'neutral-proposal', 'neutral-review'] as const)('rejects persisted interim results with %s', async fault => {
    const ctx = await setup(r => response(r, r.room!.proposal ? { type: 'confirm', proposalId: r.room!.proposal.id, review } :
      r.room!.messages.some(m => m.sender !== 'user' && m.purpose === 'discussion') ? { type: 'none' } : proposal()), { mode: 'manual' });
    const valid = await ctx.run(), forged = structuredClone(valid), stage = forged.room.interimResults![0]!;
    if (fault === 'duplicate-confirmation') stage.confirmed.push(stage.author);
    if (fault === 'missing-review') stage.reviews = [];
    if (fault === 'wrong-review-call') stage.reviews![0]!.callId = stage.id;
    if (fault === 'fatal-call') forged.room.calls[1]!.controlDiagnostic = 'grant';
    if (fault === 'summary-call') forged.room.calls[1]!.purpose = 'summary';
    if (fault === 'neutral-proposal') forged.room.calls[0]!.metadataDiagnostics = ['control-schema'];
    if (fault === 'neutral-review') forged.room.calls[1]!.metadataDiagnostics = ['control-schema'];
    expect(roomStateSchema.safeParse(forged).success).toBe(false);
    await ctx.controller.send(ctx.id, randomUUID(), 'A public clarification.', 'all');
    expect(roomStateSchema.safeParse(ctx.controller.get(ctx.id)).success).toBe(true);
    expect(ctx.controller.get(ctx.id).room.interimResults).toEqual(valid.room.interimResults);
  });
  it('a malformed delivery cannot become a proposal or a completed answer', async () => {
    const ctx = await setup(r => response(r, { ...proposal(), delivery: { ...delivery, basis: [] } } as RoomControl['action']), { mode: 'manual' });
    const s = await ctx.run(); expect(s.room.contributions).toBe(2); expect(s.room.proposal).toBeNull(); expect(s.room.outcome).toBeNull();
    expect(s.room.interimResults ?? []).toEqual([]); expect(s.room.conclusionRequest).not.toBeNull();
    expect(s.room.calls.every(c => c.metadataDiagnostics?.includes('delivery-schema'))).toBe(true);
  });
  it.each(['work-schema', 'work-reference', 'references'] as const)('%s does not stop the next speaker or apply rejected claims', async kind => {
    const ctx = await setup(r => response(r, { type: 'none' }, kind === 'references' ? { references: [{ messageId: randomUUID(), disposition: 'checked', reason: 'Unavailable source.' }] } :
      { work: { questions: [{ key: kind === 'work-schema' ? 'invalid key' : 'unavailable_source', text: 'Rejected question.', reason: '', sources: [randomUUID()] }] } }), { mode: 'manual' });
    const s = await ctx.run(); expect(s.room.contributions).toBe(2); expect(s.room.workflow?.questions).toEqual([]);
    expect(s.room.calls.every(c => c.status === 'completed' && c.metadataDiagnostics?.includes(kind))).toBe(true);
    if (kind === 'references') expect(s.room.calls.every(c => c.references.length === 0)).toBe(true);
  });
  it('ignores an incorrect confirmation and lets its peer finish an independent review', async () => {
    let mistaken = false;
    const ctx = await setup(r => response(r, !r.room!.proposal ? proposal() : !mistaken ? (mistaken = true, { type: 'confirm', proposalId: randomUUID(), review }) :
      { type: 'confirm', proposalId: r.room!.proposal.id, review }), { mode: 'conclusion', limits: { maxRounds: 4, maxDurationMs: 30_000, turnTimeoutMs: 5_000, maxModeratorCalls: 20 } });
    const s = await ctx.run(); expect(s.room.outcome?.authority).toBe('participants'); expect(s.room.contributions).toBe(3);
    expect(s.room.calls[1]?.metadataDiagnostics).toContain('proposal-reference'); expect(s.room.proposal!.reviews).toHaveLength(1);
  });
  it('rejects a capacity-exceeding report atomically and still runs the next speaker', async () => {
    let turn = 0;
    const ctx = await setup(r => {
      const index = turn++;
      return response(r, { type: 'none' }, { work: { questions: Array.from({ length: 10 }, (_, n) => ({ key: `question_${index}_${n}`, text: `Question ${index}/${n}`, reason: 'Nonblocking fixture question.', sources: [r.messageId] })) } });
    });
    const s = await ctx.run(); expect(s.room.contributions).toBe(4); expect(s.room.workflow!.questions).toHaveLength(20);
    expect(s.room.calls[2]!.metadataDiagnostics).toContain('work-limit'); expect(s.room.calls[3]!.metadataDiagnostics).toContain('work-limit');
    expect(s.room.workflow!.questions.every(q => q.sources.every(id => s.room.calls.slice(0, 2).some(c => c.id === id)))).toBe(true);
    expect(s.room.calls.every(c => c.status === 'completed' && !c.controlDiagnostic)).toBe(true);
  });
  it('retains eligible references while rejecting unseen response claims', async () => {
    const unseen = randomUUID();
    const ctx = await setup(r => {
      const peer = r.room!.messages.findLast(m => m.sender !== 'user' && m.sender !== r.room!.actor && m.purpose === 'discussion');
      return response(r, { type: 'none' }, { references: [
        ...(peer ? [{ messageId: peer.id, disposition: 'checked', reason: 'Eligible public peer.' }] : []),
        { messageId: unseen, disposition: 'addressed', reason: 'Rejected unseen request claim.' },
      ] });
    }, { mode: 'manual' });
    const s = await ctx.run(); expect(s.room.contributions).toBe(2); expect(s.room.calls[1]!.references).toHaveLength(1);
    expect(s.room.calls[1]!.references[0]!.messageId).toBe(s.room.calls[0]!.id);
    expect(s.room.calls.every(c => c.metadataDiagnostics?.includes('references') && !c.references.some(r => r.messageId === unseen))).toBe(true);
  });
  it.each(['grant', 'task-version'] as const)('keeps %s mismatch fatal even when optional metadata is invalid', async kind => {
    const ctx = await setup(r => response(r, { type: 'none' }, { work: 'invalid', ...(kind === 'grant' ? { grantId: randomUUID() } : { taskVersion: r.room!.taskVersion + 1 }) }));
    const s = await ctx.run(); expect(s.room.contributions).toBe(0); expect(ctx.requests).toHaveLength(1); expect(s.room.calls[0]?.controlDiagnostic).toBe(kind);
  });
  it('judge speakers receive no unused conclusion examples and rejected proposals do not decide a ruling', async () => {
    const ctx = await setup(r => r.room!.actor !== 'moderator' ? response(r, proposal()) : response(r,
      r.room!.messages.filter(m => m.purpose === 'discussion' && m.sender !== 'user').length >= 2 ? { type: 'finish', result: 'An explicit ruling.', dissent: [], unresolved: [], delivery: { ...delivery, basis: [...delivery.basis] } } :
      { type: 'speak', target: r.room!.messages.some(m => m.sender === 'codex') ? 'claude' : 'codex', task: 'Discuss the question.' }), { moderator, moderatorMode: 'judge' });
    const s = await ctx.run(); expect(s.room.outcome?.authority).toBe('moderator'); expect(s.room.proposal).toBeNull();
    const judge = ctx.requests.find(r => r.room!.actor === 'moderator')!;
    expect(judge.room!.task).toContain('letting peers develop'); expect(judge.room!.task).not.toContain('or finish with limitations');
    expect(JSON.parse(buildPrompt({ ...judge, room: { ...judge.room!, purpose: 'monitor' } })).policy).toContain('observe by default');
    for (const r of ctx.requests.filter(r => r.room!.actor !== 'moderator')) {
      const p = JSON.parse(buildPrompt(r)); expect(p.deliveryControlExamples).toBeUndefined(); expect(p.controlPolicy).toContain('Speaker action: none');
    }
    expect(s.room.calls.filter(c => c.participant !== 'moderator').every(c => c.metadataDiagnostics?.includes('unsupported-action'))).toBe(true);
  });
  it('preserves an ordinary invitation across a manual boundary and includes it alongside pending work', async () => {
    const ctx = await setup(r => {
      if (r.room!.actor === 'moderator') return response(r, r.room!.openingSpeaker ? { type: 'observe' } : { type: 'speak', target: 'claude', task: 'Respond to the unresolved public objection.' });
      return response(r, { type: 'none' }, r.room!.actor === 'codex' ? { work: { tasks: [{ key: 'pending_comparison', kind: 'analysis', target: 'claude', task: 'Continue the pending comparison.', sources: [r.messageId] }] } } : {});
    }, { mode: 'manual', moderator, moderatorMode: 'facilitator' });
    await ctx.run(); await ctx.controller.configure(ctx.id, { limits: { maxRounds: 3, maxDurationMs: 30_000, turnTimeoutMs: 5_000 }, expectedVersion: ctx.controller.get(ctx.id).room.configurationVersion });
    // Configuring intentionally clears stale grants. Obtain a current invitation at the next boundary.
    await ctx.run(); const before = ctx.requests.length; await ctx.run();
    expect(ctx.requests[before]?.room?.actor).toBe('claude'); expect(ctx.requests[before]?.room?.task).toContain('pending comparison');
    expect(ctx.requests[before]?.room?.task).toContain('unresolved public objection'); expect(ctx.requests[before]?.room?.task).not.toContain('optional angle');
  });
  it('debate prompts examine the assigned position while permitting evidence-based revision', async () => {
    const ctx = await setup(r => response(r), { mode: 'manual', kind: 'debate', participants: ['codex', 'claude'].map(id => ({ id, provider: id as 'codex' | 'claude', role: 'speaker', instructions: 'Examine an assigned position.', settings: { model: 'fixture', effort: 'low' } })) });
    await ctx.controller.configure(ctx.id, { confirmRoles: true, expectedVersion: ctx.controller.get(ctx.id).room.configurationVersion }); await ctx.run();
    const p = JSON.parse(buildPrompt(ctx.requests[0]!)); expect(p.debatePolicy).toContain('assigned position'); expect(p.debatePolicy).toContain('evidence');
    expect(p.debatePolicy).not.toContain('must disagree');
  });
});
