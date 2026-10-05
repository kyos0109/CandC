import { randomUUID } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeAdapter } from '../src/adapters/fake.js';
import type { TurnRequest } from '../src/adapters/types.js';
import { DiscussionController } from '../src/controller.js';
import { input, setup, waitUntil } from './helpers.js';

describe('discussion scheduling and state', () => {
  it('keeps opening answers independent, then shares answers and reuses each agent session', async () => {
    const calls: Array<{ agent: string; request: TurnRequest }> = [];
    const context = await setup({
      codex: new FakeAdapter('codex', (request) => { calls.push({ agent: 'codex', request }); return 'Codex opening'; }),
      claude: new FakeAdapter('claude', (request) => { calls.push({ agent: 'claude', request }); return 'Claude opening'; }),
    });
    try {
      const id = randomUUID();
      await context.controller.create(id, input());
      const operationId = randomUUID();
      await context.controller.start(id, operationId);
      await context.controller.start(id, operationId);
      await context.controller.wait(id);
      expect(calls).toHaveLength(2);
      expect(calls[1]?.request.context.map((message) => message.sender)).toEqual(['user']);
      const first = context.controller.get(id);
      expect(first.status).toBe('paused');
      expect(first.messages.filter((message) => message.sender !== 'user')).toHaveLength(2);
      await context.controller.start(id, randomUUID());
      await context.controller.wait(id);
      expect(calls.map((call) => call.agent)).toEqual(['codex', 'claude', 'claude', 'codex']);
      expect(calls[2]?.request.context.map((message) => message.sender)).toEqual(['user', 'codex', 'claude']);
      expect(context.controller.get(id).sessions).toEqual(first.sessions);
    } finally { await context.cleanup(); }
  });

  it('routes an intervention to its target and rejects conflicting message ID reuse', async () => {
    const calls: Array<{ agent: string; request: TurnRequest }> = [];
    const context = await setup({
      codex: new FakeAdapter('codex', (request) => { calls.push({ agent: 'codex', request }); return 'Answer'; }, 20),
      claude: new FakeAdapter('claude', (request) => { calls.push({ agent: 'claude', request }); return 'Answer'; }),
    });
    try {
      const id = randomUUID();
      const messageId = randomUUID();
      await context.controller.create(id, input());
      await context.controller.start(id, randomUUID());
      await waitUntil(() => calls.length === 1);
      await context.controller.send(id, messageId, 'Focus on the supplied numbers.', 'claude');
      await context.controller.send(id, messageId, 'Focus on the supplied numbers.', 'claude');
      await expect(context.controller.send(id, messageId, 'Changed content', 'claude')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      await context.controller.wait(id);
      expect(calls[0]?.request.context.some((message) => message.id === messageId)).toBe(false);
      expect(calls[1]?.request.context.some((message) => message.id === messageId)).toBe(true);
      expect(context.controller.get(id).messages.filter((message) => message.id === messageId)).toHaveLength(1);
    } finally { await context.cleanup(); }
  });

  it('stops immediately and never starts the second agent or an automatic summary', async () => {
    let claudeCalls = 0;
    const context = await setup({ codex: new FakeAdapter('codex', () => 'A long answer with several chunks '.repeat(10), 50),
      claude: new FakeAdapter('claude', () => { claudeCalls++; return 'Should not execute'; }) });
    try {
      const id = randomUUID();
      await context.controller.create(id, input({ mode: 'auto' }));
      await context.controller.start(id, randomUUID());
      await waitUntil(() => Boolean(context.controller.get(id).sessions.codex));
      await context.controller.stop(id);
      await context.controller.wait(id);
      expect(context.controller.get(id).status).toBe('stopped');
      expect(context.controller.get(id).messages.at(-1)?.status).toBe('cancelled');
      expect(claudeCalls).toBe(0);
      await expect(context.controller.start(id, randomUUID())).rejects.toMatchObject({ code: 'STOPPED' });
    } finally { await context.cleanup(); }
  });

  it('finishes the current answer before pausing and resumes with the other agent', async () => {
    const context = await setup({ codex: new FakeAdapter('codex', () => 'Complete answer', 20), claude: new FakeAdapter('claude') });
    try {
      const id = randomUUID();
      await context.controller.create(id, input());
      await context.controller.start(id, randomUUID());
      await waitUntil(() => Boolean(context.controller.get(id).sessions.codex));
      await context.controller.pause(id);
      await context.controller.wait(id);
      expect(context.controller.get(id).completedInRound).toEqual(['codex']);
      await context.controller.start(id, randomUUID());
      await context.controller.wait(id);
      expect(context.controller.get(id).completedInRound).toEqual(['codex', 'claude']);
    } finally { await context.cleanup(); }
  });

  it('enforces a global single-run limit and stops auto progression at its round limit', async () => {
    const context = await setup({ codex: new FakeAdapter('codex', () => 'Answer', 15), claude: new FakeAdapter('claude') });
    try {
      const id = randomUUID(), secondId = randomUUID();
      await context.controller.create(id, input({ mode: 'auto', limits: { maxRounds: 2, maxDurationMs: 30_000, turnTimeoutMs: 2_000 } }));
      await context.controller.create(secondId, input());
      await context.controller.start(id, randomUUID());
      await expect(context.controller.start(secondId, randomUUID())).rejects.toMatchObject({ code: 'BUSY' });
      await context.controller.wait(id);
      const state = context.controller.get(id);
      expect(state.status).toBe('paused');
      expect(state.round).toBe(2);
      expect(state.messages.filter((message) => message.sender !== 'user')).toHaveLength(4);
      await expect(context.controller.start(id, randomUUID())).rejects.toMatchObject({ code: 'ROUND_LIMIT' });
    } finally { await context.cleanup(); }
  });

  it('marks a timeout uncertain without retrying or passing partial text to the next agent', async () => {
    let calls = 0;
    const context = await setup({ codex: new FakeAdapter('codex', () => { calls++; return 'slow'; }, 200), claude: new FakeAdapter('claude') });
    try {
      const id = randomUUID();
      await context.controller.create(id, input({ limits: { maxRounds: 3, maxDurationMs: 30_000, turnTimeoutMs: 50 } }));
      await context.controller.start(id, randomUUID());
      await context.controller.wait(id);
      expect(context.controller.get(id).status).toBe('indeterminate');
      expect(context.controller.get(id).sessions.claude).toBeUndefined();
      await expect(context.controller.start(id, randomUUID())).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
      expect(calls).toBe(1);
    } finally { await context.cleanup(); }
  });
});

describe('durable records', () => {
  it('recovers a paused discussion and never automatically starts it', async () => {
    const context = await setup();
    try {
      const id = randomUUID();
      await context.controller.create(id, input());
      await context.controller.start(id, randomUUID());
      await context.controller.wait(id);
      const recovered = new DiscussionController(context.store, { codex: new FakeAdapter('codex'), claude: new FakeAdapter('claude') });
      await recovered.initialize();
      expect(recovered.get(id)).toEqual(context.controller.get(id));
      expect((await recovered.events(id, 2)).every((event) => event.sequence > 2)).toBe(true);
      await recovered.close();
    } finally { await context.cleanup(); }
  });

  it('recovers a crashed run from the journal even with a stale snapshot and truncated tail', async () => {
    const context = await setup();
    try {
      const id = randomUUID();
      const state = await context.controller.create(id, input());
      await context.store.commit({ ...state, status: 'running', sequence: 2 }, {
        sequence: 2, discussionId: id, type: 'state', at: new Date().toISOString(), data: { status: 'running' },
      });
      await writeFile(path.join(context.directory, `${id}.json`), '{}');
      await appendFile(path.join(context.directory, `${id}.jsonl`), '{"incomplete":');
      const recovered = new DiscussionController(context.store, { codex: new FakeAdapter('codex'), claude: new FakeAdapter('claude') });
      await recovered.initialize();
      expect(recovered.get(id).status).toBe('indeterminate');
      expect(recovered.get(id).storage?.status).toBe('unconfirmed');
      await expect(recovered.start(id, randomUUID())).rejects.toMatchObject({ code: 'STORAGE_UNCONFIRMED' });
      await recovered.recover(id, true);
      expect((await context.store.records(id)).at(-1)?.event.type).toBe('recovered');
      await expect(recovered.start(id, randomUUID())).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
      await recovered.close();
    } finally { await context.cleanup(); }
  });

  it('redacts complete secrets, including a token split across streamed chunks', async () => {
    const secret = 'sk-examplesecret1234567890';
    const context = await setup({ codex: new FakeAdapter('codex', () => `Answer ${' '.repeat(18)}${secret}`), claude: new FakeAdapter('claude') });
    try {
      const id = randomUUID();
      await context.controller.create(id, input({ topic: 'api_key=supersecretvalue; compare options' }));
      await context.controller.start(id, randomUUID());
      await context.controller.wait(id);
      const records = await readFile(path.join(context.directory, `${id}.jsonl`), 'utf8');
      expect(records).not.toContain(secret);
      expect(records).not.toContain('supersecretvalue');
      expect(records).toContain('[REDACTED');
    } finally { await context.cleanup(); }
  });
});
