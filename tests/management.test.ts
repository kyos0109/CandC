import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiscussionService } from '../src/discussion-service.js';
import { DiscussionController } from '../src/controller.js';
import { RoomController } from '../src/room-controller.js';
import { DiscussionStore, type StorageFault, type StorageStage } from '../src/store.js';
import { FakeAdapter } from '../src/adapters/fake.js';
import { RoomFakeAdapter } from '../src/adapters/room-fake.js';
import { roomStateSchema } from '../src/room-contract.js';
import { indexQuerySchema } from '../src/management.js';
import { createServer } from '../src/server.js';
import { input } from './helpers.js';

async function setup(fault?: StorageFault) {
  const directory = await mkdtemp(path.resolve('.cache/management-test-'));
  const build = () => new DiscussionService(new DiscussionController(new DiscussionStore(directory, fault), { codex: new FakeAdapter('codex', undefined, 100), claude: new FakeAdapter('claude') }),
    new RoomController(new DiscussionStore(directory, fault, roomStateSchema), provider => new RoomFakeAdapter(provider)));
  let service = build(); await service.initialize();
  return { directory, get service() { return service; }, async restart() { await service.close(); service = build(); await service.initialize(); },
    cleanup: async () => { await service.close(); await rm(directory, { recursive: true, force: true }); } };
}
const query = (value: Record<string, unknown> = {}) => indexQuerySchema.parse(value);
async function manage(ctx: Awaited<ReturnType<typeof setup>>, id: string, action: 'archive' | 'unarchive' | 'trash' | 'restore') {
  return ctx.service.manage(id, action, randomUUID(), ctx.service.get(id).sequence);
}

describe('conversation management', () => {
  for (const version of [1, 2, 3] as const) it(`preserves version ${version} content, persists folders, enforces read-only and restores its previous folder`, async () => {
    const ctx = await setup();
    try {
      let id = randomUUID(); await ctx.service.create(id, input({ behaviorVersion: version === 3 ? 1 : version }));
      if (version === 3) { const next = randomUUID(); await ctx.service.upgradeRoom(id, next); id = next; }
      await ctx.service.send(id, randomUUID(), 'PRIVATE-FIXTURE', 'codex');
      const original = ctx.service.get(id), archived = await manage(ctx, id, 'archive');
      expect(archived.messages).toEqual(original.messages); expect(archived.management?.folder).toBe('archived');
      for (const action of [() => ctx.service.start(id, randomUUID()), () => ctx.service.send(id, randomUUID(), 'Forbidden', 'codex'),
        () => ctx.service.rename(id, 'Forbidden', original.displayVersion ?? 0), () => ctx.service.rebuild(id, randomUUID(), 1),
        () => ctx.service.configure(id, { mode: 'auto', expectedVersion: 1 }), () => ctx.service.stop(id), () => ctx.service.pause(id)]) {
        await expect(action()).rejects.toMatchObject({ code: 'DISCUSSION_READ_ONLY' });
      }
      if (version < 3) await expect(ctx.service.upgradeRoom(id, randomUUID())).rejects.toMatchObject({ code: 'DISCUSSION_READ_ONLY' });
      expect((await ctx.service.index(query({ folder: 'archived' }))).items.some(item => item.id === id)).toBe(true);
      await manage(ctx, id, 'trash'); await ctx.restart();
      expect(ctx.service.get(id).management?.previousFolder).toBe('archived');
      await manage(ctx, id, 'restore'); expect(ctx.service.get(id).management?.folder).toBe('archived');
      await manage(ctx, id, 'unarchive'); expect(ctx.service.get(id).messages).toEqual(original.messages);
      expect(ctx.service.get(id).status).toBe(original.status);
      await ctx.service.rename(id, 'Allowed again', original.displayVersion ?? 0);
    } finally { await ctx.cleanup(); }
  });

  it('checks versions, deduplicates retries, rejects conflicting IDs and never manages a running or cleaning-up discussion', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID(); await ctx.service.create(id, input());
      const sequence = ctx.service.get(id).sequence, operationId = randomUUID();
      await expect(ctx.service.manage(id, 'archive', operationId, sequence + 1)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
      const archived = await ctx.service.manage(id, 'archive', operationId, sequence);
      expect(await ctx.service.manage(id, 'archive', operationId, sequence)).toEqual(archived);
      await expect(ctx.service.manage(id, 'trash', operationId, archived.sequence)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      await expect(manage(ctx, id, 'archive')).rejects.toMatchObject({ code: 'INVALID_STATE' });
      await manage(ctx, id, 'unarchive'); await ctx.service.start(id, randomUUID());
      await expect(manage(ctx, id, 'trash')).rejects.toMatchObject({ code: 'BUSY' });
      await ctx.service.stop(id);
      await expect(manage(ctx, id, 'trash')).rejects.toMatchObject({ code: 'BUSY' });
      await ctx.service.wait(id); await manage(ctx, id, 'trash');
      await manage(ctx, id, 'restore'); expect(ctx.service.get(id).management?.folder).toBe('active');
      expect(ctx.service.get(id).status).toBe('stopped');
    } finally { await ctx.cleanup(); }
  });

  for (const stage of ['beforeAppend', 'sync', 'close'] as const) it(`blocks scheduling and further management after an uncertain ${stage}`, async () => {
    let enabled = false;
    const ctx = await setup(async current => { if (enabled && (current === stage || current === 'recoverySync')) throw new Error('Injected storage failure.'); });
    try {
      const id = randomUUID(); await ctx.service.create(id, input()); enabled = true;
      await expect(manage(ctx, id, 'archive')).rejects.toThrow();
      expect(ctx.service.get(id).storage?.status).toBe('unconfirmed');
      await expect(manage(ctx, id, 'trash')).rejects.toMatchObject({ code: 'STORAGE_UNCONFIRMED' });
      await ctx.restart();
      await expect(manage(ctx, id, 'trash')).rejects.toMatchObject({ code: 'STORAGE_UNCONFIRMED' });
      enabled = false; await ctx.service.recover(id); expect(ctx.service.get(id).status).toBe('indeterminate');
    } finally { await ctx.cleanup(); }
  });

  it('deletes only exact journal files and backups, preserves a content-free marker and prevents cross-version ID reuse', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID(); await ctx.service.create(id, input({ topic: 'PRIVATE-DELETE-TOPIC' }));
      await expect(ctx.service.permanentDelete(id, randomUUID(), 1)).rejects.toMatchObject({ code: 'INVALID_STATE' });
      const trashed = await manage(ctx, id, 'trash');
      const remove = [`${id}.jsonl.backup-123.gz`, `${id}.jsonl.recovery-456.gz`, `${id}.jsonl.compacting`];
      const keep = [`${id}.notes.txt`, `${randomUUID()}.jsonl`, `${id}.jsonl.backup-invalid.gz`];
      for (const name of [...remove, ...keep]) await writeFile(path.join(ctx.directory, name), 'Owned fixture.');
      const operationId = randomUUID(); await ctx.service.permanentDelete(id, operationId, trashed.sequence);
      const files = await readdir(ctx.directory); expect(files).toEqual(expect.arrayContaining(keep));
      expect(files).not.toContain(`${id}.jsonl`); for (const name of remove) expect(files).not.toContain(name);
      expect(await readFile(path.join(ctx.directory, `${id}.deleted.json`), 'utf8')).not.toContain('PRIVATE');
      await expect(ctx.service.create(id, input())).rejects.toMatchObject({ code: 'DISCUSSION_DELETED' });
      await expect(ctx.service.rooms.create(id, { behaviorVersion: 3, topic: 'New', participants: [], moderator: null } as never)).rejects.toMatchObject({ code: 'DISCUSSION_DELETED' });
      // Keep an unrelated valid journal for restart; the sentinel above is deliberately not a journal.
      for (const name of keep.filter(name => name.endsWith('.jsonl'))) await rm(path.join(ctx.directory, name));
      await ctx.restart(); expect(() => ctx.service.get(id)).toThrow('permanently deleted');
      expect((await ctx.service.index(query())).items.some(item => item.id === id)).toBe(false);
      await expect(ctx.service.permanentDelete(id, operationId, trashed.sequence)).resolves.toMatchObject({ deleted: true });
      await expect(new DiscussionStore(ctx.directory).records(id)).rejects.toMatchObject({ code: 'DISCUSSION_DELETED' });
    } finally { await ctx.cleanup(); }
  });

  for (const stage of ['deleteMarkerSync', 'deleteMarkerClose', 'deleteFile'] satisfies StorageStage[]) it(`does not resurrect or auto-delete after ${stage} failure; explicit retry finishes`, async () => {
    let enabled = false;
    const ctx = await setup(async current => { if (enabled && current === stage) throw new Error('Injected deletion failure.'); });
    try {
      const id = randomUUID(); await ctx.service.create(id, input()); const state = await manage(ctx, id, 'trash');
      enabled = true; await expect(ctx.service.permanentDelete(id, randomUUID(), state.sequence)).rejects.toThrow();
      expect(await readFile(path.join(ctx.directory, `${id}.jsonl`), 'utf8')).toContain(id);
      await ctx.restart(); expect(() => ctx.service.get(id)).toThrow('permanently deleted');
      const index = await ctx.service.index(query({ folder: 'trash' }));
      expect(index.pendingDeletions).toEqual([expect.objectContaining({ id, expectedSequence: state.sequence })]);
      expect(await readFile(path.join(ctx.directory, `${id}.jsonl`), 'utf8')).toContain(id);
      enabled = false; await ctx.service.permanentDelete(id, randomUUID(), state.sequence);
      expect((await ctx.service.index(query())).pendingDeletions).toEqual([]);
    } finally { await ctx.cleanup(); }
  });

  it('preserves journals when marker writing fails or an existing marker is corrupt', async () => {
    let enabled = false;
    const ctx = await setup(async stage => { if (enabled && stage === 'deleteMarkerWrite') throw new Error('Injected marker failure.'); });
    try {
      const id = randomUUID(); await ctx.service.create(id, input()); const state = await manage(ctx, id, 'trash'); enabled = true;
      await expect(ctx.service.permanentDelete(id, randomUUID(), state.sequence)).rejects.toThrow();
      await ctx.restart(); const issues = (await ctx.service.index(query())).pendingDeletions;
      expect(issues[0]).toMatchObject({ id }); expect(issues[0]?.expectedSequence).toBeUndefined();
      await expect(ctx.service.permanentDelete(id, randomUUID(), state.sequence)).rejects.toMatchObject({ code: 'STORAGE_UNCONFIRMED' });
      expect(await readFile(path.join(ctx.directory, `${id}.jsonl`), 'utf8')).toContain(id);
    } finally { await ctx.cleanup(); }
  });

  it('retries a genuinely partial deletion without touching unrelated files', async () => {
    let deletedFiles = 0, enabled = false;
    const ctx = await setup(async stage => { if (enabled && stage === 'deleteFile' && ++deletedFiles === 2) throw new Error('Second file deletion failed.'); });
    try {
      const id = randomUUID(); await ctx.service.create(id, input()); const state = await manage(ctx, id, 'trash');
      await writeFile(path.join(ctx.directory, `${id}.jsonl.backup-123.gz`), 'Fixture backup');
      await writeFile(path.join(ctx.directory, `${id}.notes.txt`), 'Preserve this'); enabled = true;
      await expect(ctx.service.permanentDelete(id, randomUUID(), state.sequence)).rejects.toThrow('Second file');
      expect((await readdir(ctx.directory)).filter(name => name === `${id}.jsonl` || name === `${id}.jsonl.backup-123.gz`)).toHaveLength(1);
      await ctx.restart(); expect((await ctx.service.index(query())).pendingDeletions).toHaveLength(1);
      await expect(ctx.service.permanentDelete(id, randomUUID(), state.sequence + 1)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
      enabled = false; await ctx.service.permanentDelete(id, randomUUID(), state.sequence);
      expect(await readFile(path.join(ctx.directory, `${id}.notes.txt`), 'utf8')).toBe('Preserve this');
    } finally { await ctx.cleanup(); }
  });

  it('retries deletion of a version 3 room before restart and rejects deleted room routes with 410', async () => {
    let fail = false;
    const ctx = await setup(async stage => { if (fail && stage === 'deleteFile') throw new Error('Room deletion interrupted.'); });
    const server = createServer(ctx.service, { accessToken: 'fixture-token' });
    const headers = { host: '127.0.0.1:4317', authorization: 'Bearer fixture-token' };
    try {
      const originalId = randomUUID(), id = randomUUID(); await ctx.service.create(originalId, input()); await ctx.service.upgradeRoom(originalId, id);
      const state = await manage(ctx, id, 'trash'); fail = true;
      await expect(ctx.service.permanentDelete(id, randomUUID(), state.sequence)).rejects.toThrow('interrupted');
      expect((await server.inject({ method: 'GET', url: `/api/discussions/${id}/events`, headers })).statusCode).toBe(410);
      fail = false; await expect(ctx.service.permanentDelete(id, randomUUID(), state.sequence)).resolves.toMatchObject({ deleted: true });
      await expect(ctx.service.permanentDelete(id, randomUUID(), state.sequence)).resolves.toMatchObject({ deleted: true });
    } finally { await server.close(); await ctx.cleanup(); }
  });

  it('closes an existing SSE subscription when its conversation is permanently deleted', async () => {
    const ctx = await setup(), server = createServer(ctx.service, { accessToken: 'fixture-token', disconnectGraceMs: 5 });
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 4000);
    try {
      const id = randomUUID(); await ctx.service.create(id, input()); const state = await manage(ctx, id, 'trash');
      const address = await server.listen({ host: '127.0.0.1', port: 0 });
      const response = await fetch(`${address}/api/discussions/${id}/events`, { headers: { authorization: 'Bearer fixture-token' }, signal: abort.signal });
      const reader = response.body!.getReader(); await reader.read();
      await ctx.service.permanentDelete(id, randomUUID(), state.sequence);
      let ended = false; while (!ended) ended = (await reader.read()).done;
      expect(ended).toBe(true); await new Promise(resolve => setTimeout(resolve, 20));
      expect(() => ctx.service.get(id)).toThrow('permanently deleted');
    } finally { clearTimeout(timeout); abort.abort(); await server.close(); await ctx.cleanup(); }
  });

  it('returns paged summaries without message/evidence payloads and searches the full topic', async () => {
    const ctx = await setup();
    try {
      const ids = Array.from({ length: 53 }, () => randomUUID());
      for (const id of ids) await ctx.service.create(id, input({ topic: 'x'.repeat(300) + ' SearchAfterPreview' }));
      const first = await ctx.service.index(query({ q: 'searchafterpreview' })); expect(first.items).toHaveLength(50); expect(first.total).toBe(53);
      const second = await ctx.service.index(query({ q: 'searchafterpreview', page: 2 })); expect(second.items).toHaveLength(3);
      expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(53);
      expect(first.items[0]).not.toHaveProperty('messages'); expect(first.items[0]).not.toHaveProperty('evidence'); expect(first.items[0]?.topic.length).toBe(240);
      expect((await ctx.service.index(query({ before: '2000-01-01T00:00:00.000Z' }))).items).toEqual([]);
      expect((await ctx.service.index(query({ page: 999 }))).page).toBe(2);
      await manage(ctx, ids[0]!, 'trash'); expect((await ctx.service.index(query())).counts).toEqual({ active: 52, archived: 0, trash: 1 });
    } finally { await ctx.cleanup(); }
  }, 15_000);

  it('authenticates new routes, validates bodies and exports complete read-only conversations', async () => {
    const ctx = await setup(), server = createServer(ctx.service, { accessToken: 'fixture-token' });
    const headers = { host: '127.0.0.1:4317', authorization: 'Bearer fixture-token' };
    try {
      const id = randomUUID(); await ctx.service.create(id, input()); await ctx.service.send(id, randomUUID(), 'COMPLETE-PRIVATE-EXPORT', 'codex');
      expect((await server.inject({ method: 'GET', url: '/api/discussion-index', headers: { host: headers.host } })).statusCode).toBe(401);
      expect((await server.inject({ method: 'GET', url: '/api/discussion-index?limit=101', headers })).statusCode).toBe(400);
      expect((await server.inject({ method: 'POST', url: `/api/discussions/${id}/management`, headers, payload: { action: 'archive' } })).statusCode).toBe(400);
      let state = ctx.service.get(id);
      const archive = await server.inject({ method: 'POST', url: `/api/discussions/${id}/management`, headers, payload: { action: 'archive', operationId: randomUUID(), expectedSequence: state.sequence } });
      expect(archive.statusCode).toBe(200);
      expect((await server.inject({ method: 'GET', url: `/api/discussions/${id}/export?format=markdown`, headers })).body).toContain('COMPLETE-PRIVATE-EXPORT');
      expect((await server.inject({ method: 'POST', url: `/api/discussions/${id}/messages`, headers, payload: { messageId: randomUUID(), text: 'Forbidden' } })).json()).toMatchObject({ error: 'DISCUSSION_READ_ONLY' });
      state = await manage(ctx, id, 'trash');
      expect((await server.inject({ method: 'DELETE', url: `/api/discussions/${id}`, headers, payload: { operationId: randomUUID(), expectedSequence: state.sequence } })).statusCode).toBe(200);
      expect((await server.inject({ method: 'GET', url: `/api/discussions/${id}/export`, headers })).statusCode).toBe(410);
      expect((await server.inject({ method: 'DELETE', url: '/api/discussions/not-a-uuid', headers, payload: {} })).statusCode).toBe(400);
    } finally { await server.close(); await ctx.cleanup(); }
  });
});
