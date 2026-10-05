import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { DiscussionController } from '../src/controller.js';
import { DiscussionStore } from '../src/store.js';
import { FakeAdapter } from '../src/adapters/fake.js';
import { discussionName } from '../web/api.js';
import { input, setup } from './helpers.js';
const headers = { host: '127.0.0.1:4497', authorization: 'Bearer fixture-token' };

describe('independent discussion display metadata', () => {
  it('renames without changing task state, snapshots, confirmations or receipts and survives replay', async () => {
    const ctx = await setup(), server = createServer(ctx.controller, { accessToken: 'fixture-token' });
    try {
      const id = randomUUID();
      await ctx.controller.create(id, input({ behaviorVersion: 2 }));
      await ctx.controller.start(id, randomUUID()); await ctx.controller.wait(id);
      const before = ctx.controller.get(id);
      const rename = (payload: object, auth = headers) => server.inject({ method: 'PATCH', url: `/api/discussions/${id}/display-name`, headers: auth, payload });
      expect((await rename({ displayName: '  Recovery decision  ', expectedVersion: 0 })).statusCode).toBe(200);
      const renamed = ctx.controller.get(id);
      expect(renamed).toEqual({ ...before, displayName: 'Recovery decision', displayVersion: 1, sequence: before.sequence + 1 });
      expect((await rename({ displayName: 'Recovery decision', expectedVersion: 1 })).json()).toEqual(renamed);
      expect((await rename({ displayName: 'Stale', expectedVersion: 0 })).statusCode).toBe(409);
      expect((await rename({ displayName: 'x'.repeat(121), expectedVersion: 1 })).statusCode).toBe(400);
      expect((await rename({ displayName: 'Bad', expectedVersion: 1, goal: 'Changed task' })).statusCode).toBe(400);
      expect((await rename({ displayName: 'Bad', expectedVersion: 1 }, { host: headers.host, authorization: '' })).statusCode).toBe(401);
      expect((await new DiscussionStore(ctx.directory).records(id)).at(-1)!.state).toEqual(renamed);
      const restarted = new DiscussionController(new DiscussionStore(ctx.directory), { codex: new FakeAdapter('codex'), claude: new FakeAdapter('claude') });
      await restarted.initialize(); expect(restarted.get(id)).toEqual(renamed); await restarted.close();
      expect((await rename({ displayName: '', expectedVersion: 1 })).json().v2).toEqual(before.v2);
      expect(discussionName(ctx.controller.get(id))).toBe(before.topic);
    } finally { await server.close(); await ctx.cleanup(); }
  });
  it('reads legacy histories without writes and carries explicit names into reconstruction and upgrade', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID(), named = randomUUID();
      await ctx.controller.create(id, input({ topic: 'First line\nOriginal complete topic' }));
      const file = path.join(ctx.directory, `${id}.jsonl`), bytes = await readFile(file);
      expect((await new DiscussionStore(ctx.directory).records(id)).at(-1)!.state.displayName).toBeUndefined();
      expect(await readFile(file)).toEqual(bytes); expect(discussionName(ctx.controller.get(id))).toBe('First line');
      await ctx.controller.create(named, input({ displayName: 'Readable name' }));
      expect((await ctx.controller.fork(named, randomUUID())).displayName).toBe('Readable name');
      expect((await ctx.controller.upgrade(named, randomUUID())).displayName).toBe('Readable name');
    } finally { await ctx.cleanup(); }
  });
  it('blocks rename during execution and after uncertain storage without new calls or task changes', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID(); await ctx.controller.create(id, input({ behaviorVersion: 2 }));
      await ctx.controller.start(id, randomUUID());
      await expect(ctx.controller.rename(id, 'Blocked', 0)).rejects.toMatchObject({ code: 'BUSY' });
      await ctx.controller.stop(id); await ctx.controller.wait(id);
    } finally { await ctx.cleanup(); }
    let fail = false;
    const broken = await setup(undefined, async stage => { if (fail && stage === 'sync') throw new Error('Fixture sync failure'); });
    try {
      const id = randomUUID(); await broken.controller.create(id, input({ behaviorVersion: 2 })); fail = true;
      await expect(broken.controller.rename(id, 'Unconfirmed', 0)).rejects.toThrow();
      expect(broken.controller.get(id).storage?.status).toBe('unconfirmed');
      await expect(broken.controller.rename(id, 'Must not write', 0)).rejects.toMatchObject({ code: 'STORAGE_UNCONFIRMED' });
      expect(broken.controller.get(id).v2!.calls).toHaveLength(0);
    } finally { await broken.cleanup(); }
  });
});
