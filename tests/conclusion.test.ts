import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { FakeAdapter } from '../src/adapters/fake.js';
import { parseContribution } from '../src/conversation.js';
import { input, setup } from './helpers.js';

it.each(['free', 'alternating'] as const)('pauses only after a peer confirms the same conclusion in %s flow', async flow => {
  let count = 0;
  const respond = (agent: 'codex' | 'claude') => new FakeAdapter(agent, request => {
    expect(request.untilConclusion).toBe(true);
    const proposal = request.context.findLast(m => m.sender !== 'user' && m.sender !== agent && m.continuation === 'conclude');
    count++;
    return proposal ? `I verify and accept the proposal.\n[[CANDC:conclude:${proposal.id}]]` : 'Proposed answer with limitations.\n[[CANDC:conclude]]';
  });
  const context = await setup({ codex: respond('codex'), claude: respond('claude') });
  try {
    const id = randomUUID();
    await context.controller.create(id, input({ flow, mode: 'conclusion' }));
    await context.controller.start(id, randomUUID()); await context.controller.wait(id);
    const state = context.controller.get(id);
    expect(count).toBe(3); expect(state.status).toBe('paused');
    expect(state.pauseReason).toBe('Conclusion confirmed by both agents.');
    expect(state.messages.at(-1)?.conclusionRef).toBeTruthy();
    expect(state.messages.every(m => !m.text.includes('[[CANDC:'))).toBe(true);
    await context.controller.send(id, randomUUID(), 'Consider a changed requirement.', 'both');
    await context.controller.start(id, randomUUID()); await context.controller.wait(id);
    expect(count).toBeGreaterThan(3);
  } finally { await context.cleanup(); }
});

it('does not treat unrelated proposals or an invalid reference as confirmed agreement', async () => {
  const context = await setup({ codex: new FakeAdapter('codex', () => 'Proposal A\n[[CANDC:conclude]]'),
    claude: new FakeAdapter('claude', () => `Proposal B\n[[CANDC:conclude:${randomUUID()}]]`) });
  try {
    const id = randomUUID(); await context.controller.create(id, input({ flow: 'free', mode: 'conclusion', limits: { maxRounds: 2, maxDurationMs: 30_000, turnTimeoutMs: 2_000 } }));
    await context.controller.start(id, randomUUID()); await context.controller.wait(id);
    expect(context.controller.get(id).messages.filter(m => m.sender !== 'user')).toHaveLength(4);
    expect(context.controller.get(id).pauseReason).toBe('Round limit reached.');
  } finally { await context.cleanup(); }
});

it('distinguishes missing information from a confirmed conclusion', async () => {
  const context = await setup({ codex: new FakeAdapter('codex', () => 'Need data.\n[[CANDC:done]]'), claude: new FakeAdapter('claude', () => 'Need evidence.\n[[CANDC:done]]') });
  try {
    const id = randomUUID(); await context.controller.create(id, input({ mode: 'conclusion', flow: 'alternating' }));
    await context.controller.start(id, randomUUID()); await context.controller.wait(id);
    expect(context.controller.get(id).pauseReason).toBe('No confirmed conclusion; additional input is required.');
  } finally { await context.cleanup(); }
});

it('parses a confirmation reference and retains malformed markers as ordinary text', () => {
  const id = randomUUID();
  expect(parseContribution(`Accept.\n[[CANDC:conclude:${id}]]`)).toEqual({ text: 'Accept.', continuation: 'conclude', conclusionRef: id });
  expect(parseContribution('Accept.\n[[CANDC:conclude:invalid]]').continuation).toBe('yield');
});
