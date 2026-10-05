import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { input, setup } from './helpers.js';
const headers = { host: '127.0.0.1:4317', authorization: 'Bearer fixture-token' };
describe('focused HTTP contracts', () => {
  it('enforces expected versions, validates reply routing, and deduplicates user operations without extra calls', async () => {
    const ctx = await setup(), server = createServer(ctx.controller, { accessToken: 'fixture-token' });
    try {
      const id = randomUUID();
      const create = await server.inject({ method: 'POST', url: '/api/discussions', headers, payload: { id, input: input({ behaviorVersion: 2 }) } });
      expect(create.statusCode).toBe(201); const original = ctx.controller.get(id);
      const topic = original.messages[0]!.id;
      expect((await server.inject({ method: 'PATCH', url: `/api/discussions/${id}`, headers, payload: { goal: 'Changed goal' } })).statusCode).toBe(409);
      const update = await server.inject({ method: 'PATCH', url: `/api/discussions/${id}`, headers, payload: { expectedVersion: 1, goal: 'Changed goal' } });
      expect(update.statusCode).toBe(200); expect(update.json().v2.configurationVersion).toBe(2);
      const operationId = randomUUID(), issueId = randomUUID();
      const body = { operationId, issueId, expectedVersion: 2, action: 'add', title: 'Follow-up issue' };
      const add = await server.inject({ method: 'POST', url: `/api/discussions/${id}/issues`, headers, payload: body });
      expect(add.statusCode).toBe(200);
      const repeated = await server.inject({ method: 'POST', url: `/api/discussions/${id}/issues`, headers, payload: body });
      expect(repeated.json()).toEqual(add.json()); expect(ctx.controller.get(id).v2!.issues).toHaveLength(2);
      const conflict = await server.inject({ method: 'POST', url: `/api/discussions/${id}/issues`, headers, payload: { ...body, title: 'Different issue' } });
      expect(conflict.statusCode).toBe(409); expect(conflict.json().error).toBe('IDEMPOTENCY_CONFLICT');
      const messageId = randomUUID(), message = { messageId, text: 'Follow up on the topic', recipient: 'codex', inReplyTo: topic };
      const sent = await server.inject({ method: 'POST', url: `/api/discussions/${id}/messages`, headers, payload: message });
      expect(sent.statusCode).toBe(200);
      expect((await server.inject({ method: 'POST', url: `/api/discussions/${id}/messages`, headers, payload: message })).json()).toEqual(sent.json());
      const hidden = await server.inject({ method: 'POST', url: `/api/discussions/${id}/messages`, headers,
        payload: { messageId: randomUUID(), text: 'Cannot quote directed input to another recipient', recipient: 'claude', inReplyTo: messageId } });
      expect(hidden.statusCode).toBe(409); expect(hidden.json().error).toBe('INVALID_REFERENCE');
      expect(ctx.controller.get(id).v2!.calls).toHaveLength(0);
      const json = await server.inject({ url: `/api/discussions/${id}/export?format=json`, headers });
      expect(json.json()).toEqual(ctx.controller.get(id));
      const markdown = await server.inject({ url: `/api/discussions/${id}/export?format=markdown`, headers });
      expect(markdown.body).toContain('Follow up on the topic'); expect(markdown.body).toContain('Issues and result limits');
      expect((await server.inject({ method: 'POST', url: '/__fixture/storage-fault', headers, payload: { stage: 'sync' } })).statusCode).toBe(404);
    } finally { await server.close(); await ctx.cleanup(); }
  });
  it('exports full new and legacy histories independently of browser reading mode', async () => {
    const ctx = await setup(), server = createServer(ctx.controller, { accessToken: 'fixture-token' });
    try {
      for (const behaviorVersion of [1, 2] as const) {
        const id = randomUUID(); await ctx.controller.create(id, input({ behaviorVersion }));
        await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
        const state = ctx.controller.get(id);
        expect((await server.inject({ url: `/api/discussions/${id}/export?format=json`, headers })).json()).toEqual(state);
        const markdown = (await server.inject({ url: `/api/discussions/${id}/export`, headers })).body;
        for (const message of state.messages) expect(markdown).toContain(message.text);
      }
    } finally { await server.close(); await ctx.cleanup(); }
  });
});
