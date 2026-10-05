import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { FakeAdapter } from '../src/adapters/fake.js';
import { DiscussionController } from '../src/controller.js';
import { input, setup, waitUntil } from './helpers.js';

it.each(['stopped', 'indeterminate'] as const)('summary pause preserves %s and blocks native session reuse', async status => {
  const ctx = await setup({ codex: new FakeAdapter('codex', undefined, 30), claude: new FakeAdapter('claude') });
  try {
    const id = randomUUID(); const state = await ctx.controller.create(id, input());
    await ctx.store.commit({ ...state, status, sequence: 2, sessions: { codex: { id: 'uncertain-session', backend: 'fake', model: 'fixture' } } }, {
      sequence: 2, discussionId: id, type: 'state', at: new Date().toISOString(), data: {},
    });
    await ctx.controller.initialize();
    await ctx.controller.start(id, randomUUID(), 'summary');
    await ctx.controller.pause(id); await ctx.controller.wait(id);
    expect(ctx.controller.get(id)).toMatchObject({ status, activity: null });
    await expect(ctx.controller.start(id, randomUUID())).rejects.toMatchObject({ code: status === 'stopped' ? 'STOPPED' : 'RECONCILIATION_REQUIRED' });
    expect(ctx.controller.get(id).messages.filter(m => m.purpose === 'summary')).toHaveLength(1);
  } finally { await ctx.cleanup(); }
});

it.each(['stopped', 'indeterminate'] as const)('summary context limit preserves %s', async status => {
  const ctx = await setup();
  try {
    const id = randomUUID(); const state = await ctx.controller.create(id, input());
    await ctx.store.commit({ ...state, status, sequence: 2, messages: [{ ...state.messages[0]!, text: 'x'.repeat(1_000_001) }] }, {
      sequence: 2, discussionId: id, type: 'state', at: new Date().toISOString(), data: {},
    });
    await ctx.controller.initialize();
    await ctx.controller.start(id, randomUUID(), 'summary'); await ctx.controller.wait(id);
    expect(ctx.controller.get(id)).toMatchObject({ status, activity: null });
    expect(ctx.controller.get(id).sessions).toEqual({});
  } finally { await ctx.cleanup(); }
});

it.each(['auto', 'conclusion'] as const)('delivers directed input arriving during a turn before settling in %s mode', async mode => {
  let codexCalls = 0;
  const seen: string[][] = [];
  const ctx = await setup({
    codex: new FakeAdapter('codex', request => {
      codexCalls++; seen.push(request.context.map(m => m.text));
      return `Point\n[[CANDC:${codexCalls === 1 ? 'yield' : 'done'}]]`;
    }, 30),
    claude: new FakeAdapter('claude', () => 'Your turn\n[[CANDC:yield]]'),
  });
  try {
    const id = randomUUID(); await ctx.controller.create(id, input({ mode, flow: 'free', limits: { maxRounds: 5, maxDurationMs: 30_000, turnTimeoutMs: 2_000 } }));
    await ctx.controller.start(id, randomUUID());
    await waitUntil(() => codexCalls === 2);
    const messageId = randomUUID();
    await ctx.controller.send(id, messageId, 'New directed constraint', 'codex');
    await ctx.controller.wait(id);
    expect(seen[1]).not.toContain('New directed constraint');
    expect(seen[2]).toContain('New directed constraint');
    expect(ctx.controller.get(id).messages.findLast(m => m.sender === 'codex')?.inputMessageId).toBe(messageId);
    expect(ctx.controller.get(id).status).toBe('paused');
    const restored = new DiscussionController(ctx.store, { codex: new FakeAdapter('codex'), claude: new FakeAdapter('claude') });
    await restored.initialize(); expect(restored.get(id)).toEqual(ctx.controller.get(id));
  } finally { await ctx.cleanup(); }
});

it('requires an explicit round-limit increase after reconstruction exceeds the carried budget', async () => {
  let calls = 0;
  const ctx = await setup({ codex: new FakeAdapter('codex', () => { calls++; return 'Answer'; }), claude: new FakeAdapter('claude', () => { calls++; return 'Answer'; }) });
  try {
    const id = randomUUID(); const limits = { maxRounds: 1, maxDurationMs: 30_000, turnTimeoutMs: 2_000 };
    await ctx.controller.create(id, input({ limits }));
    await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
    const fork = await ctx.controller.fork(id, randomUUID());
    await expect(ctx.controller.start(fork.id, randomUUID())).rejects.toMatchObject({ code: 'ROUND_LIMIT' });
    expect(calls).toBe(2);
    await ctx.controller.configure(fork.id, { limits: { ...limits, maxRounds: 2 } });
    await ctx.controller.start(fork.id, randomUUID()); await ctx.controller.wait(fork.id);
    expect(calls).toBe(4);
  } finally { await ctx.cleanup(); }
});
