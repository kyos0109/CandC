import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeAdapter } from '../src/adapters/fake.js';
import { input, setup } from './helpers.js';

describe('conversation termination regressions', () => {
  it.each(['auto', 'conclusion'] as const)('accepts marker-only done and waits without claiming agreement in %s mode', async mode => {
    const ctx = await setup({ codex: new FakeAdapter('codex', () => '[[CANDC:done]]'), claude: new FakeAdapter('claude', () => '  [[CANDC:done]]\n') });
    try {
      const id = randomUUID();
      await ctx.controller.create(id, input({ mode, flow: 'free' }));
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const state = ctx.controller.get(id);
      expect(state.status).toBe('paused');
      expect(state.pauseReason).toBe(mode === 'auto' ? 'Both agents are waiting for new input.' : 'No confirmed conclusion; additional input is required.');
      expect(state.messages.slice(1)).toHaveLength(2);
      for (const message of state.messages.slice(1)) expect(message).toMatchObject({ text: '（沒有新的補充）', status: 'completed', continuation: 'done' });
      expect((await ctx.controller.events(id)).some(event => event.type === 'error')).toBe(false);
    } finally { await ctx.cleanup(); }
  });

  it.each(['', '   ', '[[CANDC:continue]]', '[[CANDC:yield]]', '[[CANDC:conclude]]'])('does not accept empty substantive output: %j', async text => {
    const ctx = await setup({ codex: new FakeAdapter('codex', () => text), claude: new FakeAdapter('claude') });
    try {
      const id = randomUUID(); await ctx.controller.create(id, input({ flow: 'free', mode: 'conclusion' }));
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      expect(ctx.controller.get(id).status).toBe('indeterminate');
      expect((await ctx.controller.events(id)).find(event => event.type === 'error')?.data.code).toBe('EMPTY_RESULT');
    } finally { await ctx.cleanup(); }
  });

  it.each(['auto', 'conclusion'] as const)('pauses yield to a done peer before the budget and resumes on new input in %s mode', async mode => {
    let calls = 0;
    const ctx = await setup({
      codex: new FakeAdapter('codex', () => { calls++; return 'No more points.\n[[CANDC:done]]'; }),
      claude: new FakeAdapter('claude', () => { calls++; return 'Your turn.\n[[CANDC:yield]]'; }),
    });
    try {
      const id = randomUUID(); await ctx.controller.create(id, input({ flow: 'free', mode, limits: { maxRounds: 5, maxDurationMs: 30_000, turnTimeoutMs: 2_000 } }));
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      expect(calls).toBe(2);
      const state = ctx.controller.get(id);
      expect(state.status).toBe('paused');
      expect(state.pauseReason).toBe(mode === 'auto' ? 'Both agents are waiting for new input.' : 'No confirmed conclusion; additional input is required.');
      expect(state.messages.at(-1)?.continuation).toBe('yield');
      await ctx.controller.send(id, randomUUID(), 'A new constraint to consider.', 'both');
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      expect(calls).toBeGreaterThan(2);
      expect(calls).toBeLessThan(7);
      expect(ctx.controller.get(id).status).toBe('paused');
    } finally { await ctx.cleanup(); }
  });

  it('allows a substantive continuation after the peer is done', async () => {
    let claudeCalls = 0;
    const ctx = await setup({
      codex: new FakeAdapter('codex', () => 'No more points.\n[[CANDC:done]]'),
      claude: new FakeAdapter('claude', () => { claudeCalls++; return `Concrete point ${claudeCalls}.\n[[CANDC:${claudeCalls === 1 ? 'continue' : 'done'}]]`; }),
    });
    try {
      const id = randomUUID(); await ctx.controller.create(id, input({ flow: 'free', mode: 'auto' }));
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      expect(claudeCalls).toBe(2);
      expect(ctx.controller.get(id).pauseReason).toBe('Both agents are waiting for new input.');
    } finally { await ctx.cleanup(); }
  });
});
