import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/server.js';
import { FakeAdapter } from '../src/adapters/fake.js';
import { input, setup, waitUntil } from './helpers.js';

const token = 'fixture-access-token';
const headers = { host: '127.0.0.1:4317', authorization: `Bearer ${token}` };

describe('phase-one HTTP contract', () => {
  it('drains more than 1 MiB of replay and delivers concurrent updates once in order', async () => {
    const context = await setup();
    const server = createServer(context.controller, { accessToken: token });
    const abort = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const timer = setTimeout(() => abort.abort(), 8000);
    try {
      const id = randomUUID(); await context.controller.create(id, input());
      for (let i = 0; i < 40; i++) await context.controller.send(id, randomUUID(), 'x'.repeat(32_000), 'both');
      const original = context.controller.events.bind(context.controller);
      vi.spyOn(context.controller, 'events').mockImplementationOnce(async (...args) => {
        const replay = await original(...args);
        await context.controller.send(id, randomUUID(), 'Arrived during replay', 'both');
        return replay;
      });
      const address = await server.listen({ host: '127.0.0.1', port: 0 });
      const response = await fetch(`${address}/api/discussions/${id}/events`, { headers: { authorization: `Bearer ${token}` }, signal: abort.signal });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      reader = response.body!.getReader();
      const decoder = new TextDecoder(); let text = '';
      while (!text.includes('id: 42\n')) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Replay closed before completing');
        text += decoder.decode(chunk.value, { stream: true });
      }
      expect(Buffer.byteLength(text)).toBeGreaterThan(1024 * 1024);
      expect([...text.matchAll(/^id: (\d+)$/gm)].map(match => Number(match[1]))).toEqual(Array.from({ length: 42 }, (_, i) => i + 1));
      expect(text).toContain('Arrived during replay');
    } finally { clearTimeout(timer); abort.abort(); await reader?.cancel().catch(() => undefined); await server.close(); await context.cleanup(); }
  }, 10_000);
  it('requires local authorization, blocks other origins, and does not expose arbitrary provider operations', async () => {
    const context = await setup();
    const server = createServer(context.controller, { accessToken: token });
    try {
      expect((await server.inject({ url: '/api/discussions', headers: { host: headers.host } })).statusCode).toBe(401);
      expect((await server.inject({ url: '/api/discussions', headers: { ...headers, origin: 'https://other.example' } })).statusCode).toBe(403);
      expect((await server.inject({ url: '/api/discussions', headers: { ...headers, host: 'attacker.example' } })).statusCode).toBe(403);
      const bootstrap = await server.inject({ url: '/api/session', headers: { host: headers.host } });
      expect(bootstrap.json()).toMatchObject({ backend: 'selectable', liveMessagesEnabled: true });
      expect(bootstrap.headers['set-cookie']).toContain('HttpOnly; SameSite=Strict');
      expect((await server.inject({ method: 'POST', url: '/api/provider/rpc', headers, payload: { method: 'turn/start' } })).statusCode).toBe(404);
    } finally { await server.close(); await context.cleanup(); }
  });

  it('runs a full round over the API and rejects extra tool or credential settings', async () => {
    const context = await setup();
    const server = createServer(context.controller, { accessToken: token });
    try {
      const id = randomUUID();
      const bad = await server.inject({ method: 'POST', url: '/api/discussions', headers,
        payload: { id, input: { ...input(), tools: ['Bash'] } } });
      expect(bad.statusCode).toBe(400);
      expect((await server.inject({ method: 'POST', url: '/api/discussions', headers, payload: { id, input: input() } })).statusCode).toBe(201);
      expect((await server.inject({ method: 'POST', url: `/api/discussions/${id}/start`, headers, payload: { operationId: randomUUID() } })).statusCode).toBe(202);
      await context.controller.wait(id);
      const result = await server.inject({ url: `/api/discussions/${id}`, headers });
      expect(result.json()).toMatchObject({ status: 'paused', backend: 'fake', round: 1 });
      expect(result.json().messages).toHaveLength(3);
    } finally { await server.close(); await context.cleanup(); }
  });

  it('preserves custom limits when changing mode or confirming roles', async () => {
    const context = await setup(); const server = createServer(context.controller, { accessToken: token });
    try {
      const id = randomUUID(); await context.controller.create(id, input());
      const limits = { maxRounds: 7, maxDurationMs: 120000, turnTimeoutMs: 5000 };
      await server.inject({ method: 'PATCH', url: `/api/discussions/${id}`, headers, payload: { limits } });
      await server.inject({ method: 'PATCH', url: `/api/discussions/${id}`, headers, payload: { mode: 'auto' } });
      await server.inject({ method: 'PATCH', url: `/api/discussions/${id}`, headers, payload: { roles: { codex: 'Reliability', claude: 'Cost' } } });
      expect(context.controller.get(id).limits).toEqual(limits);
    } finally { await server.close(); await context.cleanup(); }
  });

  it('replays SSE events without duplicates and pauses after the last client disconnects', async () => {
    const context = await setup({ codex: new FakeAdapter('codex', () => 'Current answer', 80), claude: new FakeAdapter('claude') });
    const server = createServer(context.controller, { accessToken: token, disconnectGraceMs: 5 });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const abort = new AbortController();
    try {
      const address = await server.listen({ host: '127.0.0.1', port: 0 });
      const id = randomUUID();
      await context.controller.create(id, input({ mode: 'auto' }));
      await context.controller.send(id, randomUUID(), 'Extra context', 'both');
      const response = await fetch(`${address}/api/discussions/${id}/events`, {
        headers: { authorization: `Bearer ${token}`, 'Last-Event-ID': '1' }, signal: abort.signal,
      });
      expect(response.status).toBe(200);
      reader = response.body!.getReader();
      const event = new TextDecoder().decode((await reader.read()).value);
      expect(event).toContain('id: 2\n');
      expect(event).not.toContain('id: 1\n');
      await context.controller.start(id, randomUUID());
      await waitUntil(() => Boolean(context.controller.get(id).sessions.codex));
      abort.abort();
      await reader.cancel().catch(() => undefined);
      await context.controller.wait(id);
      expect(context.controller.get(id).status).toBe('paused');
      expect(context.controller.get(id).completedInRound).toEqual(['codex']);
      expect(context.controller.get(id).sessions.claude).toBeUndefined();
    } finally { abort.abort(); await reader?.cancel().catch(() => undefined); await server.close(); await context.cleanup(); }
  });
});
