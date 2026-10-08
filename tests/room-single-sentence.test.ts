import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setLocale } from '../web/i18n.js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { RoomController } from '../src/room-controller.js';
import { DiscussionStore, type StorageFault } from '../src/store.js';
import { RoomFakeAdapter, fakeRoomResponse } from '../src/adapters/room-fake.js';
import { buildPrompt, type AgentAdapter, type AgentEvent, type TurnRequest } from '../src/adapters/types.js';
import { ROOM_CONTROL_START, ROOM_CONTROL_END, roomInputSchema, roomStateSchema, type RoomControl, type RoomDiscussion, type RoomInput, type RoomPrompt } from '../src/room-contract.js';
import type { RunEvent } from '../src/domain.js';
import { sentenceProblem } from '../src/single-sentence.js';
import { waitUntil } from './helpers.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { setLocale('zh-TW'); vi.unstubAllGlobals(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
const envelope = (r: TurnRequest, text = '保留限制，先確認證據。', action: RoomControl['action'] = { type: 'none' }) =>
  `${text}\n${ROOM_CONTROL_START}\n${JSON.stringify({ version: 3, taskVersion: r.room!.taskVersion, grantId: r.room!.grantId, continuation: 'yield', action, references: [] })}\n${ROOM_CONTROL_END}`;
const input = (patch: Partial<RoomInput> = {}) => roomInputSchema.parse({ behaviorVersion: 3, singleSentence: true, topic: 'Discuss the evidence.',
  flow: 'alternating', participants: ['codex', 'claude'].map(id => ({ id, provider: id, role: 'speaker', settings: { model: 'fixture', effort: 'low' } })),
  limits: { maxRounds: 4, maxDurationMs: 30_000, turnTimeoutMs: 5_000 }, ...patch });
async function setup(respond: (r: TurnRequest) => string = envelope, patch: Partial<RoomInput> = {}, fault?: StorageFault,
  wrap?: (adapter: AgentAdapter) => AgentAdapter) {
  const directory = await mkdtemp(path.resolve('.cache/sentence-test-'));
  const store = new DiscussionStore<RoomDiscussion>(directory, fault, roomStateSchema);
  const requests: Array<{ room: RoomPrompt; session: TurnRequest['session']; messageId: string; requestId: string | undefined; prompt: string }> = [];
  const adapters = new Map<string, AgentAdapter>();
  const controller = new RoomController(store, (provider, workspace) => {
    if (!adapters.has(workspace)) {
      const adapter = new RoomFakeAdapter(provider, respond, 0);
      const wrapped = wrap?.(adapter) ?? adapter;
      adapters.set(workspace, { id: provider, backend: 'fake', run(r) {
        requests.push({ room: structuredClone(r.room!), session: r.session && { ...r.session }, messageId: r.messageId, requestId: r.requestId, prompt: buildPrompt(r) });
        return wrapped.run(r);
      } });
    }
    return adapters.get(workspace)!;
  });
  await controller.initialize(); const id = randomUUID(); await controller.create(id, input(patch));
  const events: RunEvent[] = []; controller.subscribe(id, event => events.push(event));
  cleanups.push(async () => { await controller.close(); await rm(directory, { recursive: true, force: true }); });
  return { id, controller, store, requests, events, directory, async run(purpose: 'discussion' | 'summary' = 'discussion') {
    await controller.start(id, randomUUID(), purpose); await controller.wait(id); return controller.get(id);
  } };
}

describe('single-sentence room execution', () => {
  it('clarifies contradictory review metadata without losing a disclosed limitation', async () => {
    let reviews = 0;
    const text = '目前證據不足，但已足以提供保留限制的條件式答案。';
    const ctx = await setup(r => envelope(r, text, !r.room!.proposal ? {
      type: 'propose', result: text, dissent: [], unresolved: ['目前證據不足'],
      delivery: { status: 'complete', kind: 'answer', basis: ['已足以提供保留限制的條件式答案'] },
    } : { type: 'confirm', proposalId: r.room!.proposal.id,
      review: { adequate: true, reason: text, gaps: ++reviews === 1 ? ['目前證據不足'] : [] } }), { mode: 'conclusion' });
    const s = await ctx.run();
    expect(ctx.requests.map(r => r.room.actor)).toEqual(['codex', 'claude', 'claude']);
    expect(ctx.requests.every(r => !r.room.sentenceCorrection)).toBe(true);
    expect(s.room.outcome?.unresolved).toEqual(['目前證據不足']); expect(s.room.proposal?.confirmed).toEqual(['codex', 'claude']);
  });
  it('persists the creation choice, rejects later changes, and loads old rooms without a default field', async () => {
    const ctx = await setup(); await ctx.run();
    const reloaded = new RoomController(new DiscussionStore<RoomDiscussion>(ctx.directory, undefined, roomStateSchema), () => { throw new Error('No automatic generation.'); });
    await reloaded.initialize(); expect(reloaded.get(ctx.id).singleSentence).toBe(true); await reloaded.close();
    await expect(ctx.controller.configure(ctx.id, { expectedVersion: 1, singleSentence: false } as Parameters<RoomController['configure']>[1])).rejects.toThrow('fixed');
    const old = await setup(r => envelope(r, 'First sentence. Second sentence.'), { singleSentence: undefined });
    const state = await old.run(); expect(state.singleSentence).toBeUndefined(); expect(state.room.contributions).toBe(2);
    expect(old.requests.every(r => !JSON.parse(r.prompt).singleSentencePolicy)).toBe(true);
    expect((await readFile(path.join(old.directory, old.id + '.jsonl'), 'utf8'))).not.toContain('singleSentence');
    expect(roomInputSchema.safeParse({ ...input(), singleSentence: 'yes' }).success).toBe(false);
    expect(roomInputSchema.safeParse(input({ kind: 'selection', singleSentence: false, mode: 'conclusion', selection: { version: 1, optionCount: 2 } })).success).toBe(true);
    expect(roomInputSchema.safeParse({ ...input(), kind: 'selection', mode: 'conclusion', selection: { version: 1, optionCount: 2 } }).success).toBe(false);
  });
  it('rewrites once in the same seat/session and publishes only the accepted answer', async () => {
    const ctx = await setup(r => envelope(r, r.room!.actor === 'codex' && !r.room!.sentenceCorrection ? 'REJECTED_FIRST. REJECTED_SECOND.' : '保留限制，先確認證據。'));
    await ctx.controller.send(ctx.id, randomUUID(), 'PRIVATE_FOR_CODEX', 'codex');
    const s = await ctx.run();
    expect(s.room.contributions).toBe(2); expect(s.room.calls).toHaveLength(2); expect(ctx.requests).toHaveLength(3);
    expect(ctx.requests[0]!.messageId).toBe(ctx.requests[1]!.messageId);
    expect(ctx.requests[0]!.requestId).not.toBe(ctx.requests[1]!.requestId);
    expect(s.room.calls[0]!.sentenceRewrite!.requestId).toBe(ctx.requests[1]!.requestId);
    expect(ctx.requests[1]!.session!.id).toBe(s.room.sessions.codex!.id);
    expect(ctx.requests[1]!.room).toMatchObject({ actor: 'codex', sentenceCorrection: 'sentences', messages: [] });
    expect(ctx.requests[1]!.room.task).toBe(ctx.requests[0]!.room.task);
    expect(JSON.parse(ctx.requests[1]!.prompt).sentenceCorrectionPolicy).toContain('Rewrite this same turn once');
    expect(s.room.calls[0]!.sentenceRewrite?.reason).toBe('sentences');
    expect(s.messages.filter(m => m.sender !== 'user')).toHaveLength(2);
    expect(ctx.events.filter(e => e.type === 'progress').every(e => !e.data.preview)).toBe(true);
    expect(JSON.stringify(ctx.events)).not.toContain('REJECTED_FIRST');
    expect(JSON.stringify(ctx.requests.at(-1))).not.toContain('PRIVATE_FOR_CODEX');
    expect(JSON.stringify(ctx.requests.at(-1))).not.toContain('REJECTED_FIRST');
    expect(await readFile(path.join(ctx.directory, ctx.id + '.jsonl'), 'utf8')).not.toContain('REJECTED_FIRST');
  });
  it('fails after exactly two completed invalid answers without saving text or response claims', async () => {
    const ctx = await setup(r => envelope(r, 'REJECTED_ONE. REJECTED_TWO.'));
    const s = await ctx.run();
    expect(ctx.requests).toHaveLength(2); expect(s.status).toBe('paused'); expect(s.pauseReason).toContain('未通過檢查');
    expect(s.room.calls).toHaveLength(1); expect(s.room.calls[0]!.status).toBe('failed');
    expect(s.room.contributions).toBe(0); expect(s.room.proposal).toBeNull(); expect(s.room.sessions).toEqual({});
    expect(s.messages.every(m => m.sender === 'user')).toBe(true);
    expect(JSON.stringify(await ctx.store.records(ctx.id))).not.toContain('REJECTED_ONE');
    // The UI is typechecked with its bundler config, separately from NodeNext tests.
    const viewModule = '../web/RoomView.js'; const { RoomView } = await import(viewModule);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    for (const locale of ['zh-TW', 'en'] as const) {
      setLocale(locale);
      const html = renderToStaticMarkup(createElement(RoomView, { state: s, progress: null, busy: false,
        perform: async () => {}, panel: null, setPanel: () => {}, historyToggle: null, controls: null,
        readingMode: 'full', setReadingMode: () => {}, visible: true }));
      expect(html).toContain(locale === 'en' ? 'Single-sentence mode' : '一句模式');
      expect(html).toContain(locale === 'en' ? 'The response failed the single-sentence check' : '一句模式發言未通過檢查');
      expect(html).not.toContain('REJECTED_ONE'); expect(html).not.toContain('REJECTED_TWO');
      expect(html).toContain('Discuss the evidence.');
    }
  });
  it('rejects multi-field conclusions and does not count an invalid peer review', async () => {
    const ctx = await setup(r => {
      const text = 'Use the evidence, retaining its limits.';
      const action: RoomControl['action'] = r.room!.proposal ? { type: 'confirm', proposalId: r.room!.proposal.id, review: { adequate: true, reason: 'An extra sentence.', gaps: [] } } :
        { type: 'propose', result: text, dissent: [], unresolved: [], delivery: { status: 'complete', kind: 'answer', basis: ['the evidence'] } };
      return envelope(r, text, action);
    }, { mode: 'conclusion' });
    const s = await ctx.run(); expect(ctx.requests).toHaveLength(3); expect(s.room.proposal?.confirmed).toEqual(['codex']);
    expect(s.room.proposal?.reviews).toEqual([]); expect(s.room.outcome).toBeNull(); expect(s.room.contributions).toBe(1);
    expect(s.room.calls.at(-1)!.sentenceRewrite?.reason).toBe('metadata');
  });
  it.each(['facilitator', 'judge', 'none'] as const)('keeps %s conclusions, summaries and optional work compatible', async mode => {
    const ctx = await setup(fakeRoomResponse, { mode: 'conclusion', discussionPolicyVersion: 1,
      ...(mode === 'none' ? {} : { moderatorMode: mode, moderator: { id: 'moderator', provider: 'codex', role: 'moderator', settings: { model: 'fixture', effort: 'low' } } }) });
    const s = await ctx.run(); expect(s.room.outcome).not.toBeNull();
    expect(s.room.calls.every(c => c.status === 'completed' && !c.sentenceRewrite)).toBe(true);
    expect(s.messages.filter(m => m.sender !== 'user' && m.purpose !== 'notice').every(m => sentenceProblem(m.text) === null)).toBe(true);
    const summary = await ctx.run('summary'); expect(summary.messages.some(m => m.purpose === 'summary')).toBe(true);
    expect(summary.room.outcome).toEqual(s.room.outcome);
  });
  it.each(['stop', 'pause'] as const)('respects %s while a rewrite is producing a draft', async action => {
    let started = false;
    const ctx = await setup(r => envelope(r, 'Invalid first. Invalid second.'), {}, undefined, adapter => ({ ...adapter,
      id: adapter.id, backend: 'fake', async *run(r): AsyncGenerator<AgentEvent> {
        if (!r.room!.sentenceCorrection) { yield* adapter.run(r); return; }
        started = true;
        yield { type: 'session', session: r.session! }; yield { type: 'delta', text: 'HIDDEN_REWRITE_DRAFT.' };
        await waitUntil(() => action === 'stop' ? r.signal.aborted : ctx.controller.get(ctx.id).pauseReason?.includes('User requested pause') === true);
        r.signal.throwIfAborted(); yield { type: 'completed', text: envelope(r), model: r.settings.model };
      } }));
    await ctx.controller.start(ctx.id, randomUUID()); await waitUntil(() => started);
    await ctx.controller[action](ctx.id); await ctx.controller.wait(ctx.id); const s = ctx.controller.get(ctx.id);
    expect(ctx.requests).toHaveLength(2); expect(s.status).toBe(action === 'stop' ? 'stopped' : 'paused');
    expect(s.room.contributions).toBe(action === 'stop' ? 0 : 1); expect(JSON.stringify(ctx.events)).not.toContain('HIDDEN_REWRITE_DRAFT');
    await ctx.controller.pause(ctx.id); expect(ctx.controller.get(ctx.id).status).toBe(s.status);
  });
  it('does not start a rewrite if pause was requested during the initial answer', async () => {
    let started = false;
    const ctx = await setup(envelope, {}, undefined, adapter => ({ id: adapter.id, backend: 'fake', async *run(r): AsyncGenerator<AgentEvent> {
      started = true; yield { type: 'session', session: { id: randomUUID(), model: r.settings.model, backend: 'fake' } };
      await waitUntil(() => ctx.controller.get(ctx.id).pauseReason?.includes('User requested pause') === true);
      yield { type: 'completed', text: envelope(r, 'First. Second.'), model: r.settings.model };
    } }));
    await ctx.controller.start(ctx.id, randomUUID()); await waitUntil(() => started); await ctx.controller.pause(ctx.id); await ctx.controller.wait(ctx.id);
    expect(ctx.requests).toHaveLength(1); expect(ctx.controller.get(ctx.id).status).toBe('paused');
  });
  it.each(['rewrite', 'answer'] as const)('blocks later writes and calls when the %s commit is uncertain', async target => {
    let failed = false, laterWrites = 0;
    const fault: StorageFault = async (stage, _, payload) => {
      if (failed && stage === 'beforeAppend') laterWrites++;
      if (!failed && stage === 'sync' && payload.includes(target === 'rewrite' ? '"sentenceRewrite"' : '保留限制')) {
        failed = true; throw new Error('Injected uncertain sentence commit.');
      }
    };
    const ctx = await setup(r => envelope(r, r.room!.sentenceCorrection ? '保留限制，先確認證據。' : 'First. Second.'), {}, fault);
    const s = await ctx.run(); expect(failed).toBe(true); expect(s.storage?.status).toBe('unconfirmed');
    expect(ctx.requests).toHaveLength(target === 'rewrite' ? 1 : 2); expect(laterWrites).toBe(0); expect(s.room.contributions).toBe(0);
    await ctx.controller.close();
    const reloaded = new RoomController(new DiscussionStore<RoomDiscussion>(ctx.directory, async (stage, handle, payload) => {
      if (stage === 'recoverySync') throw new Error('Recovery remains unconfirmed.');
      await fault(stage, handle, payload);
    }, roomStateSchema), () => { throw new Error('Must not replay.'); });
    await reloaded.initialize(); expect(reloaded.get(ctx.id).status).toBe('indeterminate'); await reloaded.close(); expect(laterWrites).toBe(0);
  });
  it('never retries an unknown provider outcome or leaks its unfinished draft', async () => {
    const ctx = await setup(envelope, {}, undefined, adapter => ({ id: adapter.id, backend: 'fake', async *run(r): AsyncGenerator<AgentEvent> {
      yield { type: 'session', session: { id: randomUUID(), model: r.settings.model, backend: 'fake' } };
      yield { type: 'delta', text: 'HIDDEN_UNFINISHED.' }; throw new Error('Provider transport failed.');
    } }));
    const s = await ctx.run(); expect(s.status).toBe('indeterminate'); expect(ctx.requests).toHaveLength(1);
    expect(JSON.stringify(ctx.events)).not.toContain('HIDDEN_UNFINISHED'); expect(s.messages).toHaveLength(1);
  });
});
