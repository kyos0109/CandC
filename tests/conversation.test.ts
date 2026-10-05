import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeAdapter } from '../src/adapters/fake.js';
import { buildPrompt } from '../src/adapters/types.js';
import { parseContribution, publicPreview } from '../src/conversation.js';
import { DiscussionController } from '../src/controller.js';
import { input, request, setup, waitUntil } from './helpers.js';

describe('autonomous conversation', () => {
  it('allows consecutive contributions, yields fairly, strips control text and stops when both wait', async () => {
    const order: string[] = [];
    let codexCalls = 0, claudeCalls = 0;
    const context = await setup({
      codex: new FakeAdapter('codex', r => { expect(r.autonomous).toBe(true); order.push('codex'); codexCalls++; return `Point ${codexCalls}\n[[CANDC:${codexCalls <= 4 ? 'continue' : 'done'}]]`; }),
      claude: new FakeAdapter('claude', () => { order.push('claude'); claudeCalls++; return `Point ${claudeCalls}\n[[CANDC:${claudeCalls === 1 ? 'yield' : 'done'}]]`; }),
    });
    try {
      const id = randomUUID();
      await context.controller.create(id, input({ mode: 'auto', flow: 'free', limits: { maxRounds: 10, maxDurationMs: 30_000, turnTimeoutMs: 2_000 } }));
      await context.controller.start(id, randomUUID()); await context.controller.wait(id);
      expect(order).toEqual(['codex', 'claude', 'codex', 'codex', 'codex', 'claude', 'codex']);
      const state = context.controller.get(id);
      expect(state.status).toBe('paused');
      expect(state.pauseReason).toBe('Both agents are waiting for new input.');
      expect(state.messages.every(m => !m.text.includes('[[CANDC:'))).toBe(true);
      expect(state.messages.at(-1)?.continuation).toBe('done');
      const restored = new DiscussionController(context.store, { codex: new FakeAdapter('codex'), claude: new FakeAdapter('claude') });
      await restored.initialize(); expect(restored.get(id)).toEqual(state);
      await context.controller.send(id, randomUUID(), 'Consider another constraint.', 'both');
      await context.controller.start(id, randomUUID()); await context.controller.wait(id);
      expect(order.slice(-2)).toEqual(['claude', 'codex']);
    } finally { await context.cleanup(); }
  });

  it('keeps manual boundaries and enforces the total contribution budget with repeated speakers', async () => {
    const context = await setup({ codex: new FakeAdapter('codex', () => 'Point\n[[CANDC:continue]]'), claude: new FakeAdapter('claude', () => 'Point\n[[CANDC:continue]]') });
    try {
      const id = randomUUID();
      await context.controller.create(id, input({ flow: 'free', limits: { maxRounds: 2, maxDurationMs: 30_000, turnTimeoutMs: 2_000 } }));
      await context.controller.start(id, randomUUID()); await context.controller.wait(id);
      expect(context.controller.get(id).messages).toHaveLength(3);
      await context.controller.configure(id, { mode: 'auto' });
      await context.controller.start(id, randomUUID()); await context.controller.wait(id);
      expect(context.controller.get(id).messages.filter(m => m.sender !== 'user').map(m => m.sender)).toEqual(['codex', 'claude', 'claude', 'claude']);
      expect(context.controller.get(id).pauseReason).toBe('Round limit reached.');
      await expect(context.controller.start(id, randomUUID())).rejects.toMatchObject({ code: 'ROUND_LIMIT' });
    } finally { await context.cleanup(); }
  });

  it('pauses after the current contribution and stops an autonomous continuation immediately', async () => {
    let calls = 0;
    const context = await setup({ codex: new FakeAdapter('codex', () => { calls++; return 'Detailed point '.repeat(15) + '\n[[CANDC:continue]]'; }, 15), claude: new FakeAdapter('claude') });
    try {
      const id = randomUUID(); await context.controller.create(id, input({ mode: 'auto', flow: 'free' }));
      await context.controller.start(id, randomUUID()); await waitUntil(() => calls === 1);
      await expect(context.controller.configure(id, { flow: 'alternating' })).rejects.toMatchObject({ code: 'BUSY' });
      await context.controller.pause(id); await context.controller.wait(id);
      expect(context.controller.get(id).messages).toHaveLength(2);
      await context.controller.start(id, randomUUID());
      await waitUntil(() => calls === 2); await context.controller.stop(id); await context.controller.wait(id);
      expect(context.controller.get(id).status).toBe('stopped');
      expect(context.controller.get(id).messages.at(-1)?.status).toBe('cancelled');
    } finally { await context.cleanup(); }
  });

  it('defaults missing/malformed control to yield and enables the prompt only for free discussion', () => {
    expect(parseContribution('Answer')).toEqual({ text: 'Answer', continuation: 'yield' });
    expect(parseContribution('Answer\n[[CANDC:unknown]]').continuation).toBe('yield');
    expect(parseContribution('Answer\n[[CANDC:continue]]')).toEqual({ text: 'Answer', continuation: 'continue' });
    expect(publicPreview('Answer\n[[CANDC:cont')).toBe('Answer');
    expect(buildPrompt(request({ autonomous: true }))).toContain('Participate proactively');
    expect(buildPrompt(request({ purpose: 'summary' }))).not.toContain('Participate proactively');
  });
});
