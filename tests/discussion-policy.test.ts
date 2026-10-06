import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiscussionStore, type StorageFault } from '../src/store.js';
import { RoomController } from '../src/room-controller.js';
import { roomInputSchema, roomStateSchema, ROOM_CONTROL_START, ROOM_CONTROL_END, parseRoomAnswer, type RoomInput, type RoomControl, type RoomDiscussion } from '../src/room-contract.js';
import { RoomFakeAdapter, fakeRoomResponse } from '../src/adapters/room-fake.js';
import { buildPrompt, type AgentAdapter, type TurnRequest } from '../src/adapters/types.js';
import { continuationTask, emptyWorkflow, runnableTasks } from '../src/discussion-policy.js';
import { withDelivery } from './fixtures/conclusion.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0)) await fn(); });
const input = (patch: Partial<RoomInput> = {}): RoomInput => roomInputSchema.parse({ behaviorVersion: 3, discussionPolicyVersion: 1, topic: 'Compare alternatives with missing personal preferences.', goal: 'Reach a useful conditional answer.', constraints: '', backend: 'fake', mode: 'auto', kind: 'discussion', flow: 'free', research: false, roots: [],
  participants: ['codex', 'claude'].map(id => ({ id, provider: id, role: 'speaker', settings: { model: 'fixture', effort: 'medium' }, instructions: '' })),
  moderator: { id: 'moderator', provider: 'codex', role: 'moderator', settings: { model: 'fixture', effort: 'medium' } }, moderatorMode: 'judge',
  limits: { maxRounds: 5, maxDurationMs: 30_000, turnTimeoutMs: 5_000, maxModeratorCalls: 30 }, ...patch });
function response(r: TurnRequest, action: RoomControl['action'], work?: unknown, continuation = 'done', checked = true) {
  const peer = r.room!.messages.findLast(m => m.sender !== 'user' && m.sender !== 'moderator' && m.sender !== r.room!.actor && m.recipient === 'all');
  return 'Conditional analysis with a concrete next step.\n' + ROOM_CONTROL_START + '\n' + JSON.stringify({ version: 3, taskVersion: r.room!.taskVersion, grantId: r.room!.grantId,
    continuation, action: withDelivery(action), references: peer && checked ? [{ messageId: peer.id, disposition: 'checked', reason: 'Check the peer claim; not verification.' }] : [], ...(work ? { work } : {}) }) + '\n' + ROOM_CONTROL_END;
}
const report = (r: TurnRequest, fields: object = {}) => ({ checkpoint: { answer: 'Conditional checkpoint, not a questionnaire.', reasons: ['A stated assumption.'], dissent: ['An unresolved counterexample.'], unknowns: ['Current price still needs checking.'], sources: [r.messageId] }, ...fields });
async function setup(respond: (r: TurnRequest) => string = fakeRoomResponse, fault?: StorageFault, observedResearch = false, delayMs = 0) {
  const directory = await mkdtemp(path.resolve('.cache/policy-test-'));
  const requests: TurnRequest[] = [];
  const build = () => {
    const adapters = new Map<string, AgentAdapter>();
    return new RoomController(new DiscussionStore<RoomDiscussion>(directory, fault, roomStateSchema), (provider, _workspace, backend, actor) => {
      const k = `${backend}/${provider}/${actor}`;
      if (!adapters.has(k)) {
        const fake = new RoomFakeAdapter(provider, r => { requests.push(structuredClone({ ...r, signal: undefined } as unknown as TurnRequest)); return respond(r); }, delayMs);
        adapters.set(k, backend === 'fake' ? fake : { id: provider, backend: 'live', async *run(r) { for await (const e of fake.run(r)) {
          if (observedResearch && r.research && e.type === 'completed') yield { type: 'tool', name: 'fixture-public-research' } as const;
          yield e.type === 'session' ? { ...e, session: { ...e.session, backend: 'live' as const } } : e;
        } } });
      }
      return adapters.get(k)!;
    });
  };
  const controller = build(); await controller.initialize();
  cleanups.push(async () => { await controller.close(); await rm(directory, { recursive: true, force: true }); });
  return { controller, requests, directory, build, async run(patch: Partial<RoomInput> = {}) { const id = randomUUID(); await controller.create(id, input(patch)); await controller.start(id, randomUUID()); await controller.wait(id); return controller.get(id); } };
}

describe('active discussion policy deterministic acceptance (not live reasoning quality)', () => {
  it('shows a controlled before/after: the same early pause runs zero legacy speakers but active policy redirects to both speakers', async () => {
    const ctx = await setup(r => response(r, r.room!.actor === 'moderator' ? { type: 'pause', reason: 'Need a personal preference.' } : { type: 'none' }, report(r)));
    const before = await ctx.run({ discussionPolicyVersion: undefined });
    const after = await ctx.run();
    expect(before.room.contributions).toBe(0); expect(before.room.workflow).toBeUndefined();
    expect(after.room.contributions).toBe(2); expect(after.room.outcome).toBeNull(); expect(after.room.workflow?.checkpoint?.answer).toContain('Conditional');
    expect(after.room.commands.filter(c => !c.applied)).toHaveLength(2);
  });
  it.each([true, false])('keeps a deduplicated personal question nonblocking while an analysis task executes (moderator=%s)', async moderator => {
    const ctx = await setup(r => {
      if (r.room!.actor === 'moderator') return response(r, { type: 'pause', reason: 'Waiting for budget.' });
      const q = { key: r.room!.actor === 'codex' ? 'budget' : 'budget-duplicate', text: 'What is your budget?', reason: 'Personal preference only.', sources: [r.messageId] };
      return response(r, { type: 'none' }, report(r, { questions: [q],
        tasks: r.room!.actor === 'codex' ? [{ key: 'compare-scenarios', kind: 'analysis', target: 'claude', task: 'Compare explicit budget scenarios without waiting.', sources: [r.messageId] }] : [],
        completedTasks: r.room!.execution?.currentTaskKey ? [{ key: r.room!.execution.currentTaskKey, sources: [r.messageId] }] : [] }));
    });
    const s = await ctx.run({ moderator: moderator ? input().moderator : null });
    expect(s.room.contributions).toBe(2); expect(s.room.workflow?.questions).toHaveLength(1);
    expect(s.room.workflow?.tasks[0]?.status).toBe('completed');
    expect(ctx.requests.some(r => r.room?.actor === 'claude' && r.room.task.includes('budget scenarios'))).toBe(true);
  });
  it('does not finish before coverage and peer checking, and does not require manufactured unanimity', async () => {
    const ctx = await setup(r => response(r, r.room!.actor === 'moderator' ? { type: 'finish', result: 'A limited answer.', dissent: ['A real reservation.'], unresolved: ['A limitation.'] } : { type: 'none' }, report(r)));
    const s = await ctx.run(); expect(s.room.contributions).toBe(2); expect(s.room.outcome?.authority).toBe('moderator'); expect(s.room.outcome?.dissent).toEqual(['A real reservation.']);
  });
  it('bounds repeated unproductive redirects when agents never provide a peer-check reference', async () => {
    const ctx = await setup(r => response(r, r.room!.actor === 'moderator' ? { type: 'pause', reason: 'No more information.' } : { type: 'none' }, undefined, 'done', false));
    const s = await ctx.run(); expect(s.status).toBe('paused'); expect(s.room.outcome).toBeNull(); expect(s.room.calls.length).toBeLessThan(12); expect(s.pauseReason).toContain('修正上限');
  });
  it('allows all four configured speakers to contribute before accepting a moderator finish', async () => {
    const ctx = await setup(r => response(r, r.room!.actor === 'moderator' ? { type: 'finish', result: 'Conditional result.', dissent: [], unresolved: [] } : { type: 'none' }));
    const s = await ctx.run({ participants: ['codex', 'claude', 'codex-2', 'claude-2'].map((id, i) => ({ ...input().participants[i % 2]!, id })) });
    expect(s.room.contributions).toBe(4); expect(s.room.outcome?.authority).toBe('moderator');
  });
  it('publishes an already confirmed proposal after the remaining peer-check task completes', async () => {
    const ctx = await setup(r => {
      const checking = r.room!.task.trim().startsWith('Check a specific');
      const action: RoomControl['action'] = checking ? { type: 'none' } : r.room!.proposal ? { type: 'confirm', proposalId: r.room!.proposal.id } : { type: 'propose', result: 'Conditional peer result.', dissent: ['A reservation.'], unresolved: ['A limit.'] };
      return response(r, action, report(r), 'done', checking);
    });
    const s = await ctx.run({ moderator: null, mode: 'conclusion' });
    expect(s.room.contributions).toBe(3); expect(s.room.outcome?.authority).toBe('participants'); expect(s.room.outcome?.dissent).toEqual(['A reservation.']);
  });
  it.each([false, true])('research completion requires an observed authorized tool operation (observed=%s)', async observed => {
    const ctx = await setup(r => response(r, { type: 'none' }, report(r, r.room!.actor === 'codex' ? {
      tasks: [{ key: 'lookup-facts', kind: 'research', target: 'claude', task: 'Check a primary source.', sources: [r.messageId] }],
    } : { completedTasks: [{ key: 'lookup-facts', sources: [r.messageId] }] })), undefined, observed);
    const s = await ctx.run({ moderator: null, backend: 'live', research: true });
    expect(s.room.workflow?.tasks[0]?.status).toBe(observed ? 'completed' : 'pending');
    const researcher = s.room.calls.find(c => c.participant === 'claude' && c.purpose === 'discussion')!;
    expect(researcher.controlDiagnostic).toBeUndefined();
    expect(researcher.metadataDiagnostics?.includes('work-reference') ?? false).toBe(!observed);
    expect(researcher.researchPerformed === true).toBe(observed);
    expect(s.room.contributions).toBeGreaterThanOrEqual(2);
  });
  it('user stop aborts an active turn and never schedules a checkpoint or another speaker', async () => {
    let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
    const ctx = await setup(r => { enter(); return fakeRoomResponse(r); }, undefined, false, 100);
    const id = randomUUID(); await ctx.controller.create(id, input({ moderator: null })); await ctx.controller.start(id, randomUUID());
    await entered; await ctx.controller.stop(id); await ctx.controller.wait(id);
    const s = ctx.controller.get(id); expect(s.status).toBe('stopped'); expect(ctx.requests).toHaveLength(1);
    expect(s.room.workflow?.checkpoint).toBeNull(); expect(s.room.calls[0]?.status).toBe('cancelled');
  });
  it('research disabled leaves research pending, but executes independent analysis; capabilities are explicit in both prompts', async () => {
    const ctx = await setup(r => response(r, { type: 'none' }, report(r, r.room!.actor === 'codex' ? { tasks: [
      { key: 'lookup-facts', kind: 'research', task: 'Check primary sources.', sources: [r.messageId] },
      { key: 'analyze-range', kind: 'analysis', target: 'claude', task: 'Analyze an explicit range instead.', sources: [r.messageId] },
    ] } : { completedTasks: [{ key: 'analyze-range', sources: [r.messageId] }] })));
    const s = await ctx.run({ moderator: null }); expect(s.room.contributions).toBe(2); expect(s.room.workflow?.tasks.find(t => t.key === 'lookup-facts')?.status).toBe('pending');
    expect(runnableTasks(s)).toHaveLength(0);
    const request = ctx.requests[0]!;
    const p = JSON.parse(buildPrompt(request)); expect(p.execution).toMatchObject({ mode: 'auto', researchAvailable: false, policyVersion: 1 });
    expect(p.discussionPolicy).toContain('Do not end every answer with a questionnaire');
    expect(JSON.parse(buildPrompt({ ...request, room: { ...request.room!, execution: { ...request.room!.execution!, mode: 'conclusion', researchAvailable: true } } })).execution).toMatchObject({ mode: 'conclusion', researchAvailable: true });
  });
  it('manual mode saves a checkpoint without an extra synthesis call at the round boundary', async () => {
    const ctx = await setup(); const s = await ctx.run({ moderator: null, mode: 'manual' });
    expect(s.room.contributions).toBe(2); expect(s.room.calls).toHaveLength(2); expect(s.room.workflow?.checkpoint).not.toBeNull(); expect(s.status).toBe('paused');
  });
  it('summary updates the conclusion checkpoint without declaring completion or changing tasks', async () => {
    const ctx = await setup(); const s = await ctx.run({ mode: 'manual' });
    await ctx.controller.start(s.id, randomUUID(), 'summary'); await ctx.controller.wait(s.id);
    const after = ctx.controller.get(s.id); expect(after.room.workflow?.checkpoint?.kind).toBe('synthesis'); expect(after.room.outcome).toBeNull(); expect(after.room.workflow?.tasks).toEqual(s.room.workflow?.tasks);
  });
  it.each(['envelope', 'json', 'schema', 'task-version', 'grant'] as const)('saves a safe %s diagnostic and faithful analysis without applying invalid control', async diagnostic => {
    const ctx = await setup(r => {
      const good = response(r, { type: 'none' });
      return diagnostic === 'envelope' ? 'An already generated answer.' : diagnostic === 'json' ? 'Answer\n' + ROOM_CONTROL_START + '\n{bad secret=private-token}\n' + ROOM_CONTROL_END : diagnostic === 'schema' ? good.replace('"type":"none"', '"type":"unexpected"') : diagnostic === 'task-version' ? good.replace('"taskVersion":1', '"taskVersion":999') : good.replace(/"grantId":"[^"]+"/, '"grantId":"' + randomUUID() + '"');
    });
    const s = await ctx.run({ moderator: null }); expect(s.room.calls[0]?.status).toBe('completed');
    if (diagnostic === 'schema') {
      expect(s.room.calls[0]?.controlDiagnostic).toBeUndefined(); expect(s.room.calls[0]?.metadataDiagnostics).toContain('control-schema');
      expect(s.room.contributions).toBe(s.participants.length * s.limits.maxRounds);
    } else expect(s.room.calls[0]?.controlDiagnostic).toBe(diagnostic);
    expect(s.room.workflow?.checkpoint?.kind).toBe('analysis');
    expect(s.room.outcome).toBeNull(); expect(s.pauseReason).not.toContain('private-token');
  });
  it('rejects private source IDs in shared metadata, saves the public answer, and preserves prior workflow', async () => {
    let privateId = '';
    const ctx = await setup(r => privateId && r.room!.actor === 'codex' ? response(r, { type: 'none' }, report(r, { questions: [{ key: 'leak', text: 'Private question.', reason: '', sources: [privateId] }] })) : fakeRoomResponse(r));
    const first = await ctx.run({ moderator: null, mode: 'manual' }); privateId = randomUUID();
    await ctx.controller.send(first.id, privateId, 'PRIVATE-SOURCE-FIXTURE', 'codex'); await ctx.controller.start(first.id, randomUUID()); await ctx.controller.wait(first.id);
    const s = ctx.controller.get(first.id), rejected = s.room.calls.findLast(c => c.participant === 'codex' && c.purpose === 'discussion')!;
    expect(rejected.controlDiagnostic).toBeUndefined(); expect(rejected.metadataDiagnostics).toContain('work-reference'); expect(s.room.workflow?.questions).toHaveLength(0);
    expect(s.room.contributions).toBe(first.room.contributions + 2);
    expect(JSON.stringify(s.room.workflow)).not.toContain('PRIVATE-SOURCE-FIXTURE');
    expect(JSON.stringify(ctx.requests.filter(r => r.room?.actor === 'claude'))).not.toContain('PRIVATE-SOURCE-FIXTURE');
  });
  it('resolves a pending question only with a visible completed user message', async () => {
    let answered = false;
    const ctx = await setup(r => response(r, { type: 'none' }, report(r, answered ? { answeredQuestions: [{ key: 'budget', sources: [r.room!.messages.findLast(m => m.sender === 'user')!.id] }] } : { questions: [{ key: 'budget', text: 'Your budget?', reason: 'Personal preference.', sources: [r.messageId] }] })));
    const s = await ctx.run({ moderator: null, mode: 'manual' }); answered = true;
    await ctx.controller.send(s.id, randomUUID(), 'Budget is 100.', 'all'); await ctx.controller.start(s.id, randomUUID()); await ctx.controller.wait(s.id);
    expect(ctx.controller.get(s.id).room.workflow?.questions[0]?.status).toBe('answered');
  });
  it('loads old journals without rewriting and explicitly enables policy with fresh sessions', async () => {
    const ctx = await setup(); const s = await ctx.run({ discussionPolicyVersion: undefined, mode: 'manual' });
    const file = path.join(ctx.directory, s.id + '.jsonl'), bytes = await readFile(file);
    const reloaded = ctx.build(); await reloaded.initialize(); expect(await readFile(file)).toEqual(bytes); expect(reloaded.get(s.id).room.workflow).toBeUndefined();
    await reloaded.configure(s.id, { expectedVersion: s.room.configurationVersion, discussionPolicyVersion: 1 });
    const after = reloaded.get(s.id); expect(after.room.workflow).toEqual(emptyWorkflow()); expect(after.room.sessions).toEqual({}); expect(after.messages.slice(0, s.messages.length)).toEqual(s.messages); expect(after.activity).toBeNull(); await reloaded.close();
  });
  it('changing research retires native sessions, preserves history, and never starts a turn', async () => {
    const ctx = await setup(); const s = await ctx.run({ moderator: null, backend: 'live', mode: 'manual' });
    const calls = ctx.requests.length;
    await ctx.controller.configure(s.id, { expectedVersion: s.room.configurationVersion, research: true });
    let next = ctx.controller.get(s.id); expect(next.research).toBe(true); expect(next.room.sessions).toEqual({}); expect(ctx.requests).toHaveLength(calls);
    await ctx.controller.start(s.id, randomUUID()); await ctx.controller.wait(s.id); next = ctx.controller.get(s.id); expect(ctx.requests.at(-1)?.research).toBe(true);
    await ctx.controller.configure(s.id, { expectedVersion: next.room.configurationVersion, research: false }); expect(ctx.controller.get(s.id).roots).toEqual([]); expect(ctx.controller.get(s.id).room.sessions).toEqual({});
    await expect(ctx.controller.configure(s.id, { expectedVersion: 1, research: true })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });
  it.each(['afterAppend', 'sync', 'close'] as const)('never schedules another turn after uncertain %s of checkpoint metadata', async stage => {
    let armed = false;
    const fault: StorageFault = async current => { if (armed && current === stage) { armed = false; throw new Error('Uncertain checkpoint fixture.'); } };
    const ctx = await setup(r => { armed = true; return response(r, { type: 'none' }, report(r)); }, fault);
    const s = await ctx.run({ moderator: null }); expect(s.storage?.status).toBe('unconfirmed'); expect(ctx.requests).toHaveLength(1); expect(s.room.workflow?.checkpoint).toBeNull();
    await ctx.controller.recover(s.id); expect(ctx.controller.get(s.id).room.workflow?.checkpoint?.kind).toBe('synthesis'); expect(ctx.requests).toHaveLength(1);
  });
  it('does not count invalid calls as a valid peer check and ignores muted seats for coverage', async () => {
    const ctx = await setup(); const s = await ctx.run({ mode: 'manual' });
    const copy = structuredClone(s); copy.room.calls.forEach(c => { c.controlDiagnostic = 'grant'; }); expect(continuationTask(copy)).not.toBeNull();
    copy.room.muted = copy.participants.map(p => p.id); expect(continuationTask(copy)).toBeNull();
    copy.room.muted = [copy.participants[1]!.id]; expect(continuationTask(copy)).toBeNull();
  });
});

describe('control parsing diagnostics', () => {
  it('distinguishes malformed JSON from unsupported schema without exposing raw output', () => {
    expect(parseRoomAnswer('Text only').diagnostic).toBe('envelope');
    expect(parseRoomAnswer('Text\n' + ROOM_CONTROL_START + '\n{}\n' + ROOM_CONTROL_END).diagnostic).toBe('schema');
  });
});

describe('facilitator and explicitly authorized judge modes', () => {
  it('opens briefly before speaker-led discussion, has no monitor, and presents only a speaker-confirmed result', async () => {
    const ctx = await setup(); const s = await ctx.run({ moderatorMode: undefined, mode: 'conclusion' });
    expect(ctx.requests.slice(0, 3).map(r => r.room!.actor)).toEqual(['moderator', 'codex', 'claude']);
    expect(s.room.calls[0]?.openingSpeaker).toBe('codex');
    expect(s.room.outcome?.authority).toBe('participants'); expect(s.room.proposal?.confirmed).toEqual(['codex', 'claude']);
    expect(s.room.calls.filter(c => c.purpose === 'monitor')).toHaveLength(0);
    expect(s.room.calls.filter(c => c.participant === 'moderator')).toHaveLength(2);
    expect(s.room.sessions.moderator!.id).not.toBe(s.room.sessions.codex!.id);
    const prompt = JSON.parse(buildPrompt(ctx.requests.at(-1)!));
    expect(prompt.policy).toContain('ordinary facilitator'); expect(prompt.policy).toContain('at most two short sentences');
    expect(prompt.controlPolicy).toContain('Facilitator actions: observe; speak');
    expect(prompt.controlPolicy).not.toContain('finish {'); expect(prompt.controlPolicy).not.toContain('pause {');
    expect(prompt.discussionPolicy).toBeUndefined(); expect(prompt.proposal.confirmed).toHaveLength(2);
    expect(JSON.parse(buildPrompt(ctx.requests[1]!)).discussionPolicy).toContain('no fixed decision framework');
  });
  it.each<RoomControl['action']>([
    { type: 'pause', reason: 'Premature pause.' }, { type: 'finish', result: 'One-sided ruling.', dissent: [], unresolved: [] },
    { type: 'mute', target: 'codex', reason: 'Disagreement.' }, { type: 'interrupt', reason: 'Research request.' },
    { type: 'topic', title: 'Narrowed topic.', reason: 'Preference.' },
  ])('rejects facilitator force command $type without stopping other speakers', async action => {
    const ctx = await setup(r => r.room!.actor === 'moderator' ? response(r, action) : fakeRoomResponse(r));
    const s = await ctx.run({ moderatorMode: 'facilitator' });
    expect(s.room.contributions).toBe(4); expect(s.room.outcome).toBeNull(); expect(s.topic).toBe(input().topic);
    expect(s.room.muted).toEqual([]); expect(s.room.pendingTopic).toBeNull(); expect(s.room.commands.length).toBeGreaterThan(0);
    expect(s.room.commands.every(c => !c.applied)).toBe(true); expect(s.room.calls.some(c => c.status === 'cancelled')).toBe(false);
    expect(s.room.workflow?.checkpoint?.actor).not.toBe('moderator');
  });
  it('does not produce a result when speakers merely stop, even if the facilitator declares a conclusion', async () => {
    const ctx = await setup(r => response(r, r.room!.actor === 'moderator' ? { type: 'finish', result: 'Unsupported agreement.', dissent: [], unresolved: [] } : { type: 'none' }));
    const s = await ctx.run({ moderatorMode: 'facilitator' });
    expect(s.room.contributions).toBe(2); expect(s.room.outcome).toBeNull(); expect(s.room.commands[0]?.applied).toBe(false);
  });
  it('explicit judge mode can issue a ruling, labeled separately from speaker consensus', async () => {
    const ctx = await setup(r => response(r, { type: 'finish', result: 'Explicitly authorized ruling.', dissent: ['A dissent.'], unresolved: [] }));
    const s = await ctx.run({ moderatorMode: 'judge', discussionPolicyVersion: undefined });
    expect(s.room.contributions).toBe(0); expect(s.room.outcome?.authority).toBe('moderator'); expect(s.room.commands[0]?.applied).toBe(true);
  });
  it('keeps speakers running when ordinary coordination reaches its call budget', async () => {
    const ctx = await setup(); const s = await ctx.run({ moderatorMode: 'facilitator', mode: 'manual', limits: { ...input().limits, maxModeratorCalls: 1 } });
    expect(s.room.moderatorCalls).toBe(1); expect(s.room.contributions).toBe(2);
    await ctx.controller.start(s.id, randomUUID()); await ctx.controller.wait(s.id);
    const continued = ctx.controller.get(s.id);
    expect(continued.room.contributions).toBe(4); expect(continued.room.moderatorCalls).toBe(1);
  });
  it('loads an omitted-mode journal unchanged and selects ordinary authority only on explicit start', async () => {
    const ctx = await setup(); const id = randomUUID();
    await ctx.controller.create(id, input({ moderatorMode: undefined, mode: 'manual' })); await ctx.controller.close();
    const file = path.join(ctx.directory, id + '.jsonl'), bytes = await readFile(file);
    const reloaded = ctx.build(); await reloaded.initialize();
    expect(reloaded.get(id).moderatorMode).toBeUndefined(); expect(ctx.requests).toHaveLength(0);
    expect(await readFile(file)).toEqual(bytes);
    await reloaded.start(id, randomUUID()); await reloaded.wait(id);
    expect(reloaded.get(id).moderatorMode).toBe('facilitator');
    expect(ctx.requests.slice(0, 2).map(r => r.room!.actor)).toEqual(['moderator', 'codex']); await reloaded.close();
  });
  it('changes authority only while idle with a version check, retires sessions, and preserves history without auto-start', async () => {
    const ctx = await setup(); const s = await ctx.run({ moderatorMode: undefined, mode: 'manual' }); const requests = ctx.requests.length;
    await ctx.controller.configure(s.id, { expectedVersion: s.room.configurationVersion, moderatorMode: 'judge' });
    const judge = ctx.controller.get(s.id); expect(judge.room.sessions).toEqual({}); expect(judge.messages.slice(0, s.messages.length)).toEqual(s.messages);
    expect(ctx.requests).toHaveLength(requests); expect(judge.moderatorMode).toBe('judge');
    await expect(ctx.controller.configure(s.id, { expectedVersion: s.room.configurationVersion, moderatorMode: 'facilitator' })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await ctx.controller.configure(s.id, { expectedVersion: judge.room.configurationVersion, moderatorMode: 'facilitator' });
    expect(ctx.controller.get(s.id).moderatorMode).toBe('facilitator'); expect(ctx.requests).toHaveLength(requests);
    const bytes = await readFile(path.join(ctx.directory, s.id + '.jsonl')); const reloaded = ctx.build(); await reloaded.initialize();
    expect(await readFile(path.join(ctx.directory, s.id + '.jsonl'))).toEqual(bytes); await reloaded.close();
  });
  it('accepts the observed underscore work keys without weakening command validation', () => {
    const request = { room: { actor: 'codex', taskVersion: 2, grantId: null, messages: [] }, messageId: randomUUID() } as unknown as TurnRequest;
    expect(parseRoomAnswer(response(request, { type: 'none' }, report(request, { tasks: [{ key: 'tesla_conditional_decision', kind: 'analysis', task: 'Analyze the original topic.', sources: [request.messageId] }] }))).control?.work?.tasks[0]?.key).toBe('tesla_conditional_decision');
  });
});
