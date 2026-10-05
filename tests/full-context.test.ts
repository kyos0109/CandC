import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { AgentAdapter, TurnRequest } from '../src/adapters/types.js';
import { buildPrompt } from '../src/adapters/types.js';
import { input, setup } from './helpers.js';

it('sends all completed public messages past the previous 80000-character boundary to both providers', async () => {
  const calls: TurnRequest[] = [];
  const adapter = (id: 'codex' | 'claude'): AgentAdapter => ({ id, backend: 'fake', async *run(request) {
    calls.push(request);
    yield { type: 'completed', text: `${id} opening\n${'Complete paragraph.\n'.repeat(2500)}END-${id}`, model: request.settings.model };
  } });
  const context = await setup({ codex: adapter('codex'), claude: adapter('claude') });
  try {
    const id = randomUUID(); await context.controller.create(id, input());
    await context.controller.start(id, randomUUID()); await context.controller.wait(id);
    const history = context.controller.get(id).messages;
    expect(history.reduce((sum, m) => sum + m.text.length, 0)).toBeGreaterThan(80000);
    await context.controller.send(id, randomUUID(), 'Shared intervention.', 'both');
    await context.controller.start(id, randomUUID()); await context.controller.wait(id);
    for (const call of calls.slice(2)) {
      for (const message of history) expect(call.context.find(m => m.id === message.id)?.text).toBe(message.text);
      const prompt = JSON.parse(buildPrompt(call));
      expect(prompt.messages.some((m: { text: string }) => m.text.endsWith('END-codex'))).toBe(true);
      expect(prompt.messages.some((m: { text: string }) => m.text.endsWith('END-claude'))).toBe(true);
      expect(prompt.messages.some((m: { text: string }) => m.text === 'Shared intervention.')).toBe(true);
    }
  } finally { await context.cleanup(); }
});

it('pauses explicitly before any provider call if full input exceeds the transport budget', async () => {
  let calls = 0;
  const adapter: AgentAdapter = { id: 'codex', backend: 'fake', async *run(request) { calls++; yield { type: 'completed', text: 'Answer', model: request.settings.model }; } };
  const context = await setup({ codex: adapter, claude: { ...adapter, id: 'claude' } });
  try {
    const id = randomUUID(); await context.controller.create(id, input());
    for (let index = 0; index < 32; index++) await context.controller.send(id, randomUUID(), 'x'.repeat(32000), 'both');
    await context.controller.start(id, randomUUID()); await context.controller.wait(id);
    expect(calls).toBe(0);
    expect(context.controller.get(id).status).toBe('paused');
    expect(context.controller.get(id).pauseReason).toContain('no history was omitted');
    expect(context.controller.get(id).messages).toHaveLength(33);
  } finally { await context.cleanup(); }
});
