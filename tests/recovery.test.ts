import { randomUUID } from 'node:crypto';
import { mkdir, appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { DiscussionController } from '../src/controller.js';
import { FakeAdapter } from '../src/adapters/fake.js';
import type { AgentAdapter } from '../src/adapters/types.js';
import { input, setup, waitUntil } from './helpers.js';

const adapters = () => ({ codex: new FakeAdapter('codex'), claude: new FakeAdapter('claude') });
describe('review regressions', () => {
  it('commits and restarts even when the old snapshot path is a directory', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID();
      await mkdir(path.join(ctx.directory, `${id}.json`));
      await ctx.controller.create(id, input());
      await ctx.controller.send(id, randomUUID(), 'First', 'both');
      await ctx.controller.send(id, randomUUID(), 'Second', 'both');
      const recovered = new DiscussionController(ctx.store, adapters());
      await recovered.initialize();
      expect(recovered.get(id)).toEqual(ctx.controller.get(id));
      expect((await ctx.store.records(id)).map(r => r.event.sequence)).toEqual([1, 2, 3]);
    } finally { await ctx.cleanup(); }
  });

  it('excludes a corrupt journal with a warning while preserving healthy records and the damaged file', async () => {
    const ctx = await setup();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const bad = randomUUID(), good = randomUUID();
      await ctx.controller.create(bad, input());
      await ctx.controller.create(good, input());
      const file = path.join(ctx.directory, `${bad}.jsonl`);
      await appendFile(file, await readFile(file));
      const before = await readFile(file, 'utf8');
      const recovered = new DiscussionController(ctx.store, adapters());
      await recovered.initialize();
      expect(recovered.list().map(s => s.id)).toEqual([good]);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining(bad));
      expect(await readFile(file, 'utf8')).toBe(before);
    } finally { warning.mockRestore(); await ctx.cleanup(); }
  });

  it.each(['running', 'stopped'] as const)('clears stale activity after %s and permits reconstruction without executing AI', async status => {
    const ctx = await setup();
    try {
      const id = randomUUID();
      const state = await ctx.controller.create(id, input());
      await ctx.store.commit({ ...state, status, activity: 'discussion', sequence: 2 }, {
        sequence: 2, discussionId: id, type: 'state', at: new Date().toISOString(), data: {},
      });
      const fake = adapters();
      const run = vi.spyOn(fake.codex, 'run');
      const recovered = new DiscussionController(ctx.store, fake);
      await recovered.initialize();
      expect(recovered.get(id)).toMatchObject({ activity: null, status: status === 'running' ? 'indeterminate' : 'stopped' });
      const fork = await recovered.fork(id, randomUUID());
      expect(fork).toMatchObject({ status: 'ready', activity: null, sessions: {} });
      expect(run).not.toHaveBeenCalled();
    } finally { await ctx.cleanup(); }
  });

  for (const purpose of ['roles', 'summary'] as const) {
    it(`${purpose} timeout restores the original state`, async () => {
      const ctx = await setup({ codex: new FakeAdapter('codex', undefined, 100), claude: new FakeAdapter('claude') });
      try {
        const id = randomUUID();
        await ctx.controller.create(id, input({ kind: 'debate', limits: { maxRounds: 3, maxDurationMs: 30_000, turnTimeoutMs: 50 } }));
        await ctx.controller.start(id, randomUUID(), purpose);
        await ctx.controller.wait(id);
        expect(ctx.controller.get(id)).toMatchObject({ status: 'ready', activity: null });
        expect((await ctx.controller.events(id)).find(event => event.type === 'error')?.data.code).toBe('TIMEOUT');
      } finally { await ctx.cleanup(); }
    });

    it(`${purpose} storage failure is not treated as a recoverable provider failure`, async () => {
      let failed = false;
      const ctx = await setup(undefined, async (stage, _handle, payload) => {
        if (!failed && stage === 'beforeAppend' && payload.includes('"type":"session"')) { failed = true; throw new Error('Fixture disk failure'); }
      });
      try {
        const id = randomUUID();
        await ctx.controller.create(id, input({ kind: 'debate' }));
        await ctx.controller.start(id, randomUUID(), purpose);
        await ctx.controller.wait(id);
        expect(failed).toBe(true);
        expect(ctx.controller.get(id)).toMatchObject({ status: 'indeterminate', activity: null });
      } finally { await ctx.cleanup(); }
    });

    it.each(['ready', 'paused', 'stopped', 'indeterminate'] as const)(`${purpose} failure and retry preserve restrictions from %s`, async originalStatus => {
      let fail = true;
      const fake = adapters();
      const codex: AgentAdapter = { backend: 'fake', id: 'codex', async *run(request) {
        if (fail) throw new Error('Fixture provider failure');
        yield* fake.codex.run(request);
      } };
      const ctx = await setup({ ...fake, codex });
      try {
        const id = randomUUID();
        const initial = await ctx.controller.create(id, input({ kind: 'debate' }));
        await ctx.store.commit({ ...initial, status: originalStatus, sequence: 2 }, {
          sequence: 2, discussionId: id, type: 'state', at: new Date().toISOString(), data: {},
        });
        await ctx.controller.initialize();
        await ctx.controller.start(id, randomUUID(), purpose);
        await ctx.controller.wait(id);
        expect(ctx.controller.get(id)).toMatchObject({ status: originalStatus, activity: null, sessions: {} });
        expect(ctx.controller.get(id).messages.at(-1)?.purpose).toBe(purpose);
        fail = false;
        await ctx.controller.start(id, randomUUID(), purpose);
        await ctx.controller.wait(id);
        expect(ctx.controller.get(id).status).toBe(['stopped', 'indeterminate'].includes(originalStatus) ? originalStatus : 'paused');
        if (originalStatus === 'ready' || originalStatus === 'paused') {
          await ctx.controller.configure(id, { roles: { codex: 'Reliability', claude: 'Cost' } });
          await ctx.controller.start(id, randomUUID());
          await ctx.controller.wait(id);
          expect(ctx.controller.get(id).status).toBe('paused');
        }
      } finally { await ctx.cleanup(); }
    });

    it(`${purpose} cancellation remains stopped`, async () => {
      const ctx = await setup({ codex: new FakeAdapter('codex', undefined, 100), claude: new FakeAdapter('claude') });
      try {
        const id = randomUUID();
        await ctx.controller.create(id, input({ kind: 'debate' }));
        await ctx.controller.start(id, randomUUID(), purpose);
        await waitUntil(() => ctx.controller.get(id).sequence >= 3);
        await ctx.controller.stop(id);
        await ctx.controller.wait(id);
        expect(ctx.controller.get(id)).toMatchObject({ status: 'stopped', activity: null });
      } finally { await ctx.cleanup(); }
    });
  }
});
