import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeAdapter } from '../src/adapters/fake.js';
import type { AgentAdapter, TurnRequest } from '../src/adapters/types.js';
import { buildPrompt } from '../src/adapters/types.js';
import { DiscussionController } from '../src/controller.js';
import { discussionStateSchema, type AgentId, type Discussion } from '../src/domain.js';
import { CONTROL_END, CONTROL_START, parseFocused, focusedPreview, selectInput, materializeInput } from '../src/focused.js';
import type { Control } from '../src/v2-contract.js';
import { input, request, setup, waitUntil } from './helpers.js';

const focusedInput = () => input({ behaviorVersion: 2, flow: 'free', limits: { maxRounds: 20, maxDurationMs: 30_000, turnTimeoutMs: 2_000 } });
function envelope(req: TurnRequest, action: Control['action'] = { type: 'none' }, annotation?: unknown, continuation = 'yield') {
  const task = req.contract!.taskCard;
  return `Main judgment with conditions.\n\n## Details\nEvidence and counterexamples.\n${CONTROL_START}\n` + JSON.stringify({ version: 2,
    issueId: task.issueId, issueVersion: task.issueVersion, taskVersion: task.version, continuation, action,
    ...(annotation === undefined ? {} : { annotation }) }) + `\n${CONTROL_END}`;
}
const recorder = (id: AgentId, calls: TurnRequest[], respond = (r: TurnRequest) => envelope(r)) => {
  const fake = new FakeAdapter(id, respond, 0);
  return { id, backend: 'fake' as const, async *run(req: TurnRequest) { calls.push(structuredClone({ ...req, signal: undefined } as unknown as TurnRequest)); yield* fake.run(req); } };
};

describe('focused input and native session receipts', () => {
  it('keeps openings independent, sends only deltas and never resends its own committed answer', async () => {
    const codex: TurnRequest[] = [], claude: TurnRequest[] = [];
    const ctx = await setup({ codex: recorder('codex', codex), claude: recorder('claude', claude) });
    try {
      const id = randomUUID(); await ctx.controller.create(id, focusedInput());
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const first = ctx.controller.get(id);
      expect(codex[0]!.context.map(m => m.sender)).toEqual(['user']);
      expect(claude[0]!.context.map(m => m.sender)).toEqual(['user']);
      const self = first.messages.find(m => m.sender === 'codex')!.id;
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      expect(codex[1]!.context.some(m => m.id === self)).toBe(false);
      expect(codex[1]!.context.some(m => m.sender === 'user')).toBe(false);
      const state = ctx.controller.get(id);
      expect(state.v2!.calls).toHaveLength(4);
      expect(state.v2!.receipts).toHaveLength(2);
      expect(state.v2!.calls[2]!.diagnostics.input.messageCount).toBeLessThan(first.messages.length);
      expect(state.v2!.calls[2]!.diagnostics.input.characters).toBeLessThan(state.v2!.calls[2]!.diagnostics.input.fullHistoryCharacters);
      expect(state.v2!.calls.every(c => c.status === 'completed')).toBe(true);
      expect(state.v2!.calls.every(c => c.diagnostics.usage === null)).toBe(true);
      expect(state.v2!.calls[0]!.diagnostics.timings.cleanup).not.toBeNull();
      for (const call of state.v2!.calls) {
        const payload = buildPrompt(materializeInput(state, call, new AbortController().signal));
        expect(createHash('sha256').update(payload).digest('hex')).toBe(call.snapshot.payloadHash);
        expect(payload.length).toBe(call.diagnostics.input.characters);
        expect(call.snapshot.taskCard.references.every(ref => !('text' in ref))).toBe(true);
      }
      expect(state.messages.some(m => m.text.includes(CONTROL_START))).toBe(false);
      const journal = await readFile(path.join(ctx.directory, `${id}.jsonl`), 'utf8');
      for (const text of new Set(state.messages.filter(m => m.sender !== 'user').map(m => m.text))) {
        const serialized = JSON.stringify(text).slice(1, -1);
        expect(journal.split(serialized).length - 1).toBe(state.messages.filter(m => m.text === text).length);
      }
      expect((await ctx.store.records(id)).at(-1)!.state).toEqual(JSON.parse(JSON.stringify(state)));
      expect(journal.trim().split('\n').every(line => JSON.parse(line).version === 3)).toBe(true);
    } finally { await ctx.cleanup(); }
  });
  it('prioritizes multiple undelivered users, preserves arrival snapshots and directed routing', async () => {
    const calls: TurnRequest[] = [], peer: TurnRequest[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fake = new FakeAdapter('codex', r => envelope(r), 0);
    const codex: AgentAdapter = { id: 'codex', backend: 'fake', async *run(req) { calls.push(req); if (calls.length === 1) await gate; yield* fake.run(req); } };
    const ctx = await setup({ codex, claude: recorder('claude', peer) });
    try {
      const id = randomUUID(); await ctx.controller.create(id, focusedInput());
      const first = randomUUID(), second = randomUUID(), privateId = randomUUID();
      await ctx.controller.send(id, first, 'First new requirement', 'both');
      await ctx.controller.send(id, second, 'Second new requirement', 'both');
      await ctx.controller.start(id, randomUUID()); await waitUntil(() => calls.length === 1);
      await ctx.controller.send(id, privateId, 'Private Codex requirement', 'codex');
      const whileRunning = ctx.controller.get(id);
      expect(whileRunning.v2!.calls[0]!.snapshot.messages.some(m => m.id === privateId)).toBe(false);
      release(); await ctx.controller.wait(id);
      const saved = ctx.controller.get(id);
      const initial = saved.v2!.calls[0]!;
      expect(initial.snapshot.messages.map(m => m.id)).toContain(first);
      expect(initial.snapshot.messages.map(m => m.id)).toContain(second);
      expect(saved.v2!.receipts.find(r => r.agent === 'codex')!.messages.some(m => m.id === privateId)).toBe(false);
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      expect(calls.some(r => r.context.some(m => m.id === privateId))).toBe(true);
      expect(peer.every(r => !buildPrompt(r).includes('Private Codex requirement'))).toBe(true);
      const privateAnswer = ctx.controller.get(id).messages.findLast(m => m.sender === 'codex')!;
      expect(privateAnswer.recipient).toBe('codex');
      await expect(ctx.controller.send(id, randomUUID(), 'Check hidden request', 'claude', privateId)).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
    } finally { release(); await ctx.cleanup(); }
  });
  it('deduplicates the initial topic, versions goals and evidence, and deliberately reattaches eligible references', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID(), state = await ctx.controller.create(id, focusedInput());
      const selection = selectInput(state, 'codex', request({ purpose: 'discussion' }));
      expect(selection.request.contract!.configuration!.topic).toBeUndefined();
      expect(selection.call.snapshot.taskCard.goal).toContain(state.messages[0]!.id);
      expect(buildPrompt(selection.request).split(state.topic)).toHaveLength(2);
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      let current = ctx.controller.get(id);
      await ctx.controller.configure(id, { goal: 'Revised goal', expectedVersion: current.v2!.configurationVersion });
      current = ctx.controller.get(id);
      const changed = selectInput(current, 'codex', request({ purpose: 'discussion' }));
      expect(changed.request.contract!.configuration!.goal).toBe('Revised goal');
      const firstEvidence = { source: 'https://example.com/source', text: 'Version one', sha256: 'one', retrievedAt: current.createdAt, truncated: false };
      current.evidence = [firstEvidence, { ...firstEvidence, text: 'Version two', sha256: 'two' }];
      current.v2!.receipts.find(r => r.agent === 'codex')!.evidence = [{ id: firstEvidence.source, version: 'one' }];
      const changedEvidence = selectInput(current, 'codex', request({ purpose: 'discussion' }));
      expect(changedEvidence.call.snapshot.evidence).toEqual([{ id: firstEvidence.source, version: 'two', recordIndex: 1 }]);
      expect(changedEvidence.request.contract!.taskCard.references.length).toBeGreaterThan(0);
      expect(changedEvidence.call.diagnostics.input.references).toBeGreaterThan(2);
      const topicBefore = current.topic;
      await ctx.controller.configure(id, { topic: 'Changed title', expectedVersion: current.v2!.configurationVersion });
      current = ctx.controller.get(id);
      const changedTopic = selectInput(current, 'codex', request({ purpose: 'discussion' }));
      expect(changedTopic.request.contract!.configuration!.topic).toBe('Changed title');
      expect(current.messages[0]!.text).toBe(topicBefore);
    } finally { await ctx.cleanup(); }
  });
  it('records the exact eligible retrieval when repeated evidence has the same source and content version', async () => {
    const ctx = await setup();
    try {
      const state = await ctx.controller.create(randomUUID(), focusedInput());
      const evidence = { source: 'https://example.com/repeated', text: 'Identical public content', sha256: 'same-version', retrievedAt: state.createdAt, truncated: false };
      state.evidence = [{ ...evidence, owner: 'codex', generation: randomUUID() },
        { ...evidence, owner: 'claude', retrievedAt: '2026-10-03T01:00:00.000Z' },
        { ...evidence, owner: 'claude', retrievedAt: '2026-10-03T02:00:00.000Z' }];
      const selected = selectInput(state, 'claude', request({ purpose: 'discussion' }));
      expect(selected.request.evidence).toEqual([state.evidence[1]]);
      expect(selected.call.snapshot.evidence).toEqual([{ id: evidence.source, version: evidence.sha256, recordIndex: 1 }]);
      const reconstructed = buildPrompt(materializeInput(state, selected.call, new AbortController().signal));
      expect(createHash('sha256').update(reconstructed).digest('hex')).toBe(selected.call.snapshot.payloadHash);
      const prepared = { ...state, v2: { ...state.v2!, receipts: [selected.receipt], calls: [selected.call] } };
      expect(discussionStateSchema.safeParse(prepared).success).toBe(true);
      const broken = structuredClone(prepared);
      broken.v2.calls[0]!.snapshot.evidence[0]!.recordIndex = 99;
      expect(discussionStateSchema.safeParse(broken).success).toBe(false);
    } finally { await ctx.cleanup(); }
  });
  it('uses isolated auxiliary sessions without advancing ordinary receipts', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID(); await ctx.controller.create(id, focusedInput());
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const before = ctx.controller.get(id);
      await ctx.controller.start(id, randomUUID(), 'summary'); await ctx.controller.wait(id);
      const after = ctx.controller.get(id);
      expect(after.sessions).toEqual(before.sessions);
      expect(after.v2!.receipts.filter(r => before.v2!.receipts.some(old => old.generation === r.generation))).toEqual(before.v2!.receipts);
      expect(after.v2!.calls.filter(c => c.snapshot.purpose === 'summary').every(c => c.snapshot.sessionId === null)).toBe(true);
    } finally { await ctx.cleanup(); }
  });
  it('rejects oversized complete payloads before preparing or calling providers', async () => {
    const calls: TurnRequest[] = [];
    const ctx = await setup({ codex: recorder('codex', calls), claude: new FakeAdapter('claude') });
    try {
      const id = randomUUID(); await ctx.controller.create(id, focusedInput());
      for (let n = 0; n < 18; n++) await ctx.controller.send(id, randomUUID(), 'z'.repeat(32_000), 'both');
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      expect(ctx.controller.get(id).status).toBe('paused');
      expect(ctx.controller.get(id).v2!.calls).toHaveLength(0);
      expect(calls).toHaveLength(0);
    } finally { await ctx.cleanup(); }
  });
});

describe('required control and optional response annotations', () => {
  it.each(['missing', 'invalid', 'optional-invalid'] as const)('saves delivery independently of %s metadata', async kind => {
    const codex: AgentAdapter = { id: 'codex', backend: 'fake', async *run(req) {
      yield { type: 'session', session: { id: 'native', model: req.settings.model, backend: 'fake' } };
      yield { type: 'completed', model: req.settings.model, text: kind === 'missing' ? 'Public answer.' : kind === 'invalid' ? `Public answer.\n${CONTROL_START}\n{}\n${CONTROL_END}` : envelope(req, { type: 'none' }, { wrong: true }) };
    } };
    const ctx = await setup({ codex, claude: new FakeAdapter('claude') });
    try {
      const id = randomUUID(); await ctx.controller.create(id, focusedInput());
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const state = ctx.controller.get(id), call = state.v2!.calls[0]!;
      expect(call.status).toBe('completed');
      expect(state.v2!.receipts[0]!.messages.some(m => m.id === state.messages[0]!.id)).toBe(true);
      expect(call.control).toBe(kind === 'optional-invalid' ? 'valid' : 'invalid');
      expect(call.annotation).toBe(kind === 'optional-invalid' ? 'invalid' : 'unmarked');
      expect(state.v2!.requests[0]!.status).toBe('unmarked');
      expect(call.diagnostics.timings.processPreparation).toBeNull();
      if (kind !== 'optional-invalid') expect(state.v2!.calls).toHaveLength(1);
    } finally { await ctx.cleanup(); }
  });
  it('rejects optional references outside the actual session scope without invalidating required control', async () => {
    const calls: TurnRequest[] = [];
    const ctx = await setup({ codex: recorder('codex', calls, r => envelope(r, { type: 'none' }, { references: [{ messageId: randomUUID(), disposition: 'addressed', reason: 'wrong' }] })), claude: new FakeAdapter('claude') });
    try {
      const id = randomUUID(); await ctx.controller.create(id, focusedInput());
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      expect(ctx.controller.get(id).v2!.calls[0]).toMatchObject({ annotation: 'invalid', control: 'valid' });
    } finally { await ctx.cleanup(); }
  });
  it('ignores quoted and fenced counterfeit controls and hides every streaming control slice', () => {
    const req = request();
    const fake = `Evidence quote:\n> ${CONTROL_START}\n> {}\n> ${CONTROL_END}\n\n~~~json\n${CONTROL_START}\n{}\n${CONTROL_END}\n~~~\nPublic remains.`;
    expect(parseFocused(fake).control).toBeNull(); expect(parseFocused(fake).text).toBe(fake);
    const text = fake + `\n${CONTROL_START}\n{}\n${CONTROL_END}`;
    for (let i = fake.length + 2; i < text.length; i++) expect(focusedPreview(text.slice(0, i))).toBe(fake);
    expect(req.context).toEqual([]);
  });
});

describe('issue proposals, confirmations and user boundaries', () => {
  it.each(['concluded', 'disagreed', 'blocked'] as const)('records peer-confirmed %s with explicit outcome conditions', async outcome => {
    const calls: TurnRequest[] = [];
    const propose = (r: TurnRequest) => envelope(r, { type: 'propose', outcome, result: 'Decision and each position, reasons and missing evidence.', conditions: 'Limited supplied evidence; uncertain forecast.', unresolved: outcome === 'blocked' ? ['Missing required observation'] : [], blocking: outcome === 'blocked' });
    const confirm = (r: TurnRequest) => envelope(r, { type: 'confirm', proposalId: r.contract!.taskCard.proposal!.id, proposalVersion: r.contract!.taskCard.proposal!.version });
    const ctx = await setup({ codex: recorder('codex', calls, propose), claude: recorder('claude', calls, confirm) });
    try {
      const id = randomUUID(); await ctx.controller.create(id, focusedInput());
      // Independent openings cannot see each other's proposal; wait until the next native turn.
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      let state = ctx.controller.get(id);
      if (state.status === 'indeterminate') {
        // The fixture deliberately attempted unavailable confirmation; rebuild with confirmed history.
        await ctx.controller.rebuild(id, randomUUID(), state.v2!.taskVersion);
      }
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      state = ctx.controller.get(id);
      expect(state.v2!.issues[0]!.confirmation?.author).toBe('claude');
      expect(state.v2!.issues[0]!.status).toBe(outcome);
      expect(state.v2!.completed).toBe(false);
      if (outcome === 'blocked') expect(state.pauseReason).toContain('Missing information');
    } finally { await ctx.cleanup(); }
  });
  it('retains pending suggestions without unilateral switching, skips distinctly, and prevents stale settings', async () => {
    const ctx = await setup({ codex: new FakeAdapter('codex', r => envelope(r, { type: 'suggest', title: 'Extension' }), 0), claude: new FakeAdapter('claude', r => envelope(r), 0) });
    try {
      const id = randomUUID(), initial = await ctx.controller.create(id, focusedInput());
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      let state = ctx.controller.get(id);
      expect(state.v2!.currentIssueId).toBe(initial.v2!.currentIssueId);
      expect(state.v2!.issues.find(i => i.title === 'Extension')!.status).toBe('pending');
      const issueId = state.v2!.currentIssueId!;
      await ctx.controller.issueAction(id, randomUUID(), state.v2!.taskVersion, 'skip', issueId);
      state = ctx.controller.get(id); expect(state.v2!.issues[0]!.status).toBe('skipped');
      expect(state.v2!.issues[0]!.confirmation).toBeNull();
      await ctx.controller.configure(id, { constraints: 'New limits', expectedVersion: state.v2!.configurationVersion });
      await expect(ctx.controller.configure(id, { constraints: 'Old limits', expectedVersion: state.v2!.configurationVersion })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    } finally { await ctx.cleanup(); }
  });
  it.each(['valid', 'invalid'] as const)('keeps original attribution and applies a queued user switch even with %s control', async validity => {
    const calls: TurnRequest[] = [], fake = new FakeAdapter('codex', r => validity === 'valid' ? envelope(r) : `Public answer\n${CONTROL_START}\n{}\n${CONTROL_END}`, 0);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const ctx = await setup({ codex: { id: 'codex', backend: 'fake', async *run(req) { calls.push(req); await gate; yield* fake.run(req); } }, claude: new FakeAdapter('claude') });
    try {
      const id = randomUUID(); await ctx.controller.create(id, focusedInput());
      let state = ctx.controller.get(id);
      const next = randomUUID(); await ctx.controller.issueAction(id, randomUUID(), state.v2!.taskVersion, 'add', next, 'New issue');
      await ctx.controller.start(id, randomUUID()); await waitUntil(() => calls.length === 1);
      state = ctx.controller.get(id);
      await ctx.controller.issueAction(id, randomUUID(), state.v2!.taskVersion, 'select', next);
      await ctx.controller.pause(id); release(); await ctx.controller.wait(id);
      state = ctx.controller.get(id);
      expect(state.messages.at(-1)!.taskVersion).toBe(calls[0]!.contract!.taskCard.version);
      expect(state.v2!.currentIssueId).toBe(next);
      expect(state.v2!.calls[0]!.control).toBe(validity === 'valid' ? 'stale' : 'invalid');
      expect(state.messages.at(-1)!.status).toBe('completed');
      expect(state.v2!.receipts[0]!.status).toBe('valid');
      expect(state.v2!.queuedIssue).toBeNull();
      expect(state.v2!.issues.filter(i => i.status === 'active')).toHaveLength(1);
    } finally { release(); await ctx.cleanup(); }
  });
  it('enforces explicit version contracts and upgrades legacy history without old receipt assumptions', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID(); await ctx.controller.create(id, input());
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const old = ctx.controller.get(id), newId = randomUUID();
      const upgraded = await ctx.controller.upgrade(id, newId);
      expect(upgraded.behaviorVersion).toBe(2); expect(upgraded.v2!.sourceDiscussionId).toBe(id);
      expect(upgraded.v2!.receipts).toEqual([]); expect(upgraded.sessions).toEqual({});
      expect(upgraded.elapsedMs).toBe(old.elapsedMs); expect(upgraded.limits).toEqual(old.limits);
      expect(upgraded.messages.map(m => m.text)).toEqual(old.messages.map(m => m.text));
      expect(ctx.controller.get(id)).toEqual(old);
      expect(await ctx.controller.upgrade(id, newId)).toEqual(upgraded);
      expect(discussionStateSchema.safeParse({ ...upgraded, v2: undefined }).success).toBe(false);
      expect(discussionStateSchema.safeParse({ ...upgraded, messages: [{ ...upgraded.messages[0], taskVersion: undefined }] }).success).toBe(false);
      expect(discussionStateSchema.safeParse({ ...old, behaviorVersion: undefined }).data?.behaviorVersion).toBe(1);
    } finally { await ctx.cleanup(); }
  });
});
