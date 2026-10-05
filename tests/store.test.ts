import { createHash, randomUUID } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DiscussionStore } from '../src/store.js';
import { input, setup } from './helpers.js';

describe('compact discussion journals', () => {
  it('recovers legacy failure metadata without a digest format marker', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID(), initial = await ctx.controller.create(id, input());
      const faulty = new DiscussionStore(ctx.directory, async stage => { if (stage === 'sync') throw new Error('Legacy metadata fixture.'); });
      await expect(faulty.commit({ ...initial, sequence: 2, pauseReason: 'Confirmed legacy content.' },
        { sequence: 2, discussionId: id, type: 'state', at: initial.createdAt, data: {} })).rejects.toThrow();
      const file = path.join(ctx.directory, `${id}.unconfirmed.json`), pending = JSON.parse(await readFile(file, 'utf8'));
      const record = (await faulty.records(id)).at(-1)!;
      delete pending.digestFormat; pending.digest = createHash('sha256').update(JSON.stringify(record)).digest('hex');
      await writeFile(file, JSON.stringify(pending));
      const recovered = await new DiscussionStore(ctx.directory).recover(id);
      expect(recovered.outcome).toBe('adopted'); expect(recovered.state?.pauseReason).toBe('Confirmed legacy content.');
    } finally { await ctx.cleanup(); }
  });
  it('stores long messages once, replays every event and preserves full context after restart', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID();
      await ctx.controller.create(id, input());
      for (let index = 0; index < 12; index++) await ctx.controller.send(id, randomUUID(), `unique-${index}:` + 'x'.repeat(20_000), 'both');
      const file = path.join(ctx.directory, `${id}.jsonl`), text = await readFile(file, 'utf8');
      const records = await new DiscussionStore(ctx.directory).records(id);
      expect(records.at(-1)?.state).toEqual(ctx.controller.get(id));
      expect(records.map(record => record.event.sequence)).toEqual(Array.from({ length: 13 }, (_, index) => index + 1));
      expect(records.at(-1)?.event.data.message).toEqual(records.at(-1)?.state.messages.at(-1));
      expect(text.split('unique-0:')).toHaveLength(2);
      const oldBytes = Buffer.byteLength(records.map(record => JSON.stringify(record)).join('\n'));
      expect(Buffer.byteLength(text)).toBeLessThan(oldBytes / 5);
    } finally { await ctx.cleanup(); }
  });

  it('reads legacy records followed by compact changes and repairs a truncated tail', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID();
      await ctx.controller.create(id, input());
      const file = path.join(ctx.directory, `${id}.jsonl`);
      const initial = (await ctx.store.records(id))[0]!;
      await writeFile(file, JSON.stringify(initial) + '\n' + '{"incomplete":');
      const store = new DiscussionStore(ctx.directory);
      const state = { ...initial.state, sequence: 2, pauseReason: 'Tail repaired' };
      await expect(store.commit(state, { ...initial.event, sequence: 2, type: 'state', data: {} })).rejects.toThrow('invalid record');
      await store.recover(id, true);
      await store.commit(state, { ...initial.event, sequence: 2, type: 'state', data: {} });
      expect((await store.records(id)).at(-1)?.state).toEqual(state);
      expect(await readFile(file, 'utf8')).not.toContain('incomplete');
    } finally { await ctx.cleanup(); }
  });

  it('compacts legacy history with exact replay and a recoverable original backup', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID();
      await ctx.controller.create(id, input());
      for (let index = 0; index < 4; index++) await ctx.controller.send(id, randomUUID(), `Message ${index}:` + 'a'.repeat(10_000), 'both');
      const file = path.join(ctx.directory, `${id}.jsonl`), records = await ctx.store.records(id);
      const original = records.map(record => JSON.stringify(record)).join('\n') + '\n';
      await writeFile(file, original);
      const store = new DiscussionStore(ctx.directory), result = await store.compact(id);
      expect(result.after).toBeLessThan(result.before / 2);
      expect(gunzipSync(await readFile(result.backup!)).toString('utf8')).toBe(original);
      expect(await store.records(id)).toEqual(records);
      expect((await store.compact(id)).backup).toBeNull();
    } finally { await ctx.cleanup(); }
  });

  it('preserves replacement arrays and evidence references', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID(), initial = await ctx.controller.create(id, input());
      const evidence = { source: 'test', text: 'Complete evidence', sha256: 'hash', retrievedAt: new Date().toISOString(), truncated: false };
      const second = { ...initial, sequence: 2, evidence: [evidence] };
      await ctx.store.commit(second, { sequence: 2, discussionId: id, type: 'evidence', at: initial.createdAt, data: { evidence } });
      const third = { ...second, sequence: 3, evidence: [], roots: ['replacement'] };
      await ctx.store.commit(third, { sequence: 3, discussionId: id, type: 'state', at: initial.createdAt, data: {} });
      const records = await new DiscussionStore(ctx.directory).records(id);
      expect(records[1]?.event.data.evidence).toEqual(evidence);
      expect(records[1]?.state.evidence).toEqual([evidence]);
      expect(records[2]?.state).toEqual(third);
    } finally { await ctx.cleanup(); }
  });

  it('rejects broken compact references rather than hiding missing content', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID();
      await ctx.controller.create(id, input());
      await appendFile(path.join(ctx.directory, `${id}.jsonl`), JSON.stringify({ version: 2,
        event: { sequence: 2, discussionId: id, type: 'message', at: new Date().toISOString(), data: {} },
        set: { sequence: 2 }, append: {}, references: { message: { field: 'messages', index: 99 } },
      }) + '\n');
      await expect(new DiscussionStore(ctx.directory).records(id)).rejects.toThrow('invalid event reference');
    } finally { await ctx.cleanup(); }
  });
});
