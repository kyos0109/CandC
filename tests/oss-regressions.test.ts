import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { DiscussionController } from '../src/controller.js';
import { DiscussionService } from '../src/discussion-service.js';
import { RoomController } from '../src/room-controller.js';
import { DiscussionStore } from '../src/store.js';
import { roomInputSchema, roomStateSchema } from '../src/room-contract.js';
import { FakeAdapter } from '../src/adapters/fake.js';
import { RoomFakeAdapter } from '../src/adapters/room-fake.js';
import { input } from './helpers.js';
import { AppError } from '../src/domain.js';

const roomInput = () => roomInputSchema.parse({ behaviorVersion: 3, topic: 'Synthetic audit fixture', backend: 'fake',
  participants: ['codex', 'claude'].map(provider => ({ id: provider, provider, role: 'speaker', settings: { model: `fixture-${provider}`, effort: 'medium' } })),
  moderator: null, limits: { maxRounds: 5, maxDurationMs: 30_000, turnTimeoutMs: 2_000, maxModeratorCalls: 20 } });

async function setup() {
  const directory = await mkdtemp(path.resolve('.cache/oss-regression-'));
  const legacy = new DiscussionController(new DiscussionStore(directory), { codex: new FakeAdapter('codex'), claude: new FakeAdapter('claude') });
  const store = new DiscussionStore(directory, undefined, roomStateSchema);
  const rooms = new RoomController(store, provider => new RoomFakeAdapter(provider, undefined, 0));
  const service = new DiscussionService(legacy, rooms);
  await service.initialize();
  return { directory, store, service, cleanup: async () => { await service.close(); await rm(directory, { recursive: true, force: true }); } };
}

it.each(['stopped', 'indeterminate'] as const)('pause preserves %s and cannot authorize an old room session', async status => {
  const ctx = await setup();
  try {
    const id = randomUUID();
    await ctx.service.createRoom(id, roomInput());
    await ctx.service.start(id, randomUUID()); await ctx.service.wait(id);
    const original = ctx.service.get(id);
    if (status === 'stopped') await ctx.service.stop(id);
    else {
      await ctx.store.commit({ ...ctx.service.rooms.get(id), status: 'running', activity: 'discussion', sequence: original.sequence + 1 },
        { discussionId: id, sequence: original.sequence + 1, type: 'state', data: {}, at: new Date().toISOString(), commitId: randomUUID() });
      await ctx.service.rooms.initialize();
    }
    const before = ctx.service.get(id);
    await ctx.service.pause(id);
    expect(ctx.service.get(id)).toEqual(before);
    await expect(ctx.service.start(id, randomUUID())).rejects.toMatchObject({ code: status === 'stopped' ? 'STOPPED' : 'RECONCILIATION_REQUIRED' });
  } finally { await ctx.cleanup(); }
});

it.each([1, 2] as const)('serializes concurrent version %s and room creation without duplicate journal sequences', async version => {
  const ctx = await setup();
  try {
    const id = randomUUID();
    const outcomes = await Promise.allSettled([ctx.service.create(id, input({ behaviorVersion: version })), ctx.service.createRoom(id, roomInput())]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'IDEMPOTENCY_CONFLICT' } });
    const records = (await readFile(path.join(ctx.directory, `${id}.jsonl`), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(records.map(record => record.event.sequence)).toEqual([1]);
    await ctx.service.initialize(); expect(ctx.service.list().filter(state => state.id === id)).toHaveLength(1);
    expect(ctx.service.storageIssues()).toEqual([]);
  } finally { await ctx.cleanup(); }
});

it('keeps concurrent identical room creation idempotent and rejects fork/upgrade destinations owned by rooms', async () => {
  const ctx = await setup();
  try {
    const id = randomUUID();
    const results = await Promise.all([ctx.service.createRoom(id, roomInput()), ctx.service.createRoom(id, roomInput())]);
    expect(results[0]).toEqual(results[1]); expect(results[0]!.sequence).toBe(1);
    const original = await readFile(path.join(ctx.directory, `${id}.jsonl`));
    const legacy = randomUUID(); await ctx.service.create(legacy, input({ behaviorVersion: 1 }));
    await expect(ctx.service.fork(legacy, id)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(ctx.service.upgrade(legacy, id)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(await readFile(path.join(ctx.directory, `${id}.jsonl`))).toEqual(original);
  } finally { await ctx.cleanup(); }
});

it('rejects cross-version appends across independent stores before changing durable bytes', async () => {
  const ctx = await setup();
  try {
    const id = randomUUID(); await ctx.service.create(id, input({ behaviorVersion: 2 }));
    const otherId = randomUUID(); await ctx.service.createRoom(otherId, roomInput());
    const room = { ...ctx.service.rooms.get(otherId), id, sequence: 2 };
    const before = await readFile(path.join(ctx.directory, `${id}.jsonl`));
    await expect(ctx.store.commit(room, { discussionId: id, sequence: 2, type: 'state', data: {}, at: new Date().toISOString(), commitId: randomUUID() })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(await readFile(path.join(ctx.directory, `${id}.jsonl`))).toEqual(before);
    expect(ctx.store.isBlocked(id)).toBe(false);
  } finally { await ctx.cleanup(); }
});

it('does not mistake an error code after append for a confirmed pre-write version collision', async () => {
  const ctx = await setup();
  try {
    const id = randomUUID(); await ctx.service.create(id, input({ behaviorVersion: 2 }));
    const writer = new DiscussionStore(ctx.directory, async stage => {
      if (stage === 'afterAppend') throw new AppError('IDEMPOTENCY_CONFLICT', 'Synthetic storage fault with a reused error code.');
    });
    const state = { ...ctx.service.legacy.get(id), sequence: 2 };
    await expect(writer.commit(state, { discussionId: id, sequence: 2, type: 'state', data: {}, at: new Date().toISOString(), commitId: randomUUID() })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(writer.isBlocked(id)).toBe(true);
    await expect(writer.commit({ ...state, sequence: 3 }, { discussionId: id, sequence: 3, type: 'state', data: {}, at: new Date().toISOString(), commitId: randomUUID() })).rejects.toMatchObject({ code: 'STORAGE_UNCONFIRMED' });
  } finally { await ctx.cleanup(); }
});
