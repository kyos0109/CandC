import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiscussionStore, type StorageFault, type StorageStage } from '../src/store.js';
import { DiscussionController } from '../src/controller.js';
import { FakeAdapter } from '../src/adapters/fake.js';
import { input } from './helpers.js';
const adapters = () => ({ codex: new FakeAdapter('codex', undefined, 0), claude: new FakeAdapter('claude', undefined, 0) });

describe('durable journal barriers and explicit recovery', () => {
  it.each(['beforeAppend', 'partial', 'afterAppend', 'sync', 'close'] as const)('blocks every later write after %s, verifies or repairs explicitly without duplicate sequence', async stage => {
    const directory = await mkdtemp(path.resolve('.cache/storage-'));
    let armed = false, attempts = 0;
    const fault: StorageFault = async (observed, handle, payload) => {
      if (!armed) return;
      if (observed === 'beforeAppend') attempts++;
      if (stage === 'partial' && observed === 'beforeAppend') { await handle.writeFile(payload.slice(0, 80)); throw new Error('partial append'); }
      if (stage === observed) throw new Error(`injected ${stage}`);
    };
    const store = new DiscussionStore(directory, fault), controller = new DiscussionController(store, adapters());
    try {
      const id = randomUUID(); await controller.initialize(); await controller.create(id, input({ behaviorVersion: 2 }));
      armed = true;
      await expect(controller.send(id, randomUUID(), 'Injected failure message', 'both')).rejects.toThrow();
      const failed = controller.get(id);
      expect(failed.storage?.status).toBe('unconfirmed');
      const before = await readFile(path.join(directory, `${id}.jsonl`), 'utf8');
      await expect(controller.start(id, randomUUID())).rejects.toMatchObject({ code: 'STORAGE_UNCONFIRMED' });
      await expect(controller.configure(id, { goal: 'Cannot write', expectedVersion: failed.v2!.configurationVersion })).rejects.toThrow();
      await expect(controller.stop(id)).rejects.toThrow();
      expect(attempts).toBe(1);
      expect(await readFile(path.join(directory, `${id}.jsonl`), 'utf8')).toBe(before);
      armed = false;
      if (stage === 'partial') await expect(controller.recover(id)).rejects.toMatchObject({ code: 'TAIL_REPAIR_REQUIRED' });
      const recovered = await controller.recover(id, true);
      expect(recovered.storage).toBeUndefined(); expect(recovered.status).toBe('indeterminate');
      expect(recovered.messages.filter(m => m.text === 'Injected failure message')).toHaveLength(['afterAppend', 'sync', 'close'].includes(stage) ? 1 : 0);
      const records = await store.records(id);
      expect(records.map(r => r.event.sequence)).toEqual(records.map((_, i) => i + 1));
      expect(new Set(records.map(r => r.event.commitId)).size).toBe(records.length);
      const callsBefore = recovered.v2!.calls.length;
      await expect(controller.start(id, randomUUID())).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
      expect(controller.get(id).v2!.calls).toHaveLength(callsBefore);
      if (stage === 'partial') expect((await store.recover(id)).backup).toBeNull();
    } finally { armed = false; await controller.close(); await rm(directory, { recursive: true, force: true }); }
  });
  it.each(['recoverySync', 'recoveryClose'] as StorageStage[])('keeps the barrier after %s fails again', async failure => {
    const directory = await mkdtemp(path.resolve('.cache/storage-'));
    let mode: StorageStage | null = null;
    const store = new DiscussionStore(directory, async stage => { if (mode === stage) throw new Error('storage unavailable'); });
    const controller = new DiscussionController(store, adapters());
    try {
      const id = randomUUID(); await controller.create(id, input()); mode = 'sync';
      await expect(controller.send(id, randomUUID(), 'Maybe persisted', 'both')).rejects.toThrow();
      mode = failure; await expect(controller.recover(id)).rejects.toThrow();
      expect(store.isBlocked(id)).toBe(true); expect(controller.get(id).storage?.status).toBe('unconfirmed');
      await expect(controller.start(id, randomUUID())).rejects.toMatchObject({ code: 'STORAGE_UNCONFIRMED' });
      mode = null; await controller.recover(id);
    } finally { mode = null; await controller.close(); await rm(directory, { recursive: true, force: true }); }
  });
  it('does not retry from catch, evidence or finally after a running call loses durable storage', async () => {
    const directory = await mkdtemp(path.resolve('.cache/storage-'));
    let armed = false, writes = 0;
    const store = new DiscussionStore(directory, async (stage, _handle, payload) => {
      if (!armed || stage !== 'beforeAppend') return;
      writes++;
      if (payload.includes('"type":"message"')) throw new Error('final commit failed');
    });
    const controller = new DiscussionController(store, adapters());
    try {
      const id = randomUUID(); await controller.create(id, input({ behaviorVersion: 2 })); armed = true;
      await controller.start(id, randomUUID()); await controller.wait(id);
      expect(controller.get(id).storage?.status).toBe('unconfirmed');
      expect(controller.get(id).v2!.calls[0]!.status).toBe('prepared');
      expect(controller.get(id).v2!.receipts[0]!.status).toBe('provisional');
      expect(writes).toBe(4); // running, prepared, provisional event, rejected final commit
      const sequence = controller.get(id).sequence;
      armed = false; await controller.recover(id);
      expect(controller.get(id).sequence).toBe(sequence + 1);
      await controller.rebuild(id, randomUUID(), controller.get(id).v2!.taskVersion);
      expect(controller.get(id).v2!.receipts[0]!.status).toBe('retired');
      expect(controller.get(id).v2!.calls[0]!.status).toBe('failed');
    } finally { armed = false; await controller.close(); await rm(directory, { recursive: true, force: true }); }
  });
  it('validates a complete append after restart without memory metadata and never automatically sends another turn', async () => {
    const directory = await mkdtemp(path.resolve('.cache/storage-'));
    const store = new DiscussionStore(directory), controller = new DiscussionController(store, adapters());
    try {
      const id = randomUUID(); await controller.create(id, input({ behaviorVersion: 2 }));
      await controller.start(id, randomUUID()); await controller.wait(id);
      const records = await store.records(id), before = controller.get(id);
      await writeFile(path.join(directory, `${id}.jsonl`), records.map(r => JSON.stringify(r)).join('\n') + '\n');
      const restarted = new DiscussionController(new DiscussionStore(directory), adapters());
      await restarted.initialize();
      expect(restarted.get(id)).toEqual(before);
      expect(restarted.get(id).v2!.calls).toHaveLength(2);
      await restarted.close();
    } finally { await controller.close(); await rm(directory, { recursive: true, force: true }); }
  });
  it('preserves middle corruption and rejects content conflicts even when messageId matches', async () => {
    const directory = await mkdtemp(path.resolve('.cache/storage-'));
    let armed = false;
    const store = new DiscussionStore(directory, async stage => { if (armed && stage === 'sync') throw new Error('sync failed'); });
    const controller = new DiscussionController(store, adapters());
    try {
      const id = randomUUID(); await controller.create(id, input()); armed = true;
      await expect(controller.send(id, randomUUID(), 'Original', 'both')).rejects.toThrow(); armed = false;
      const file = path.join(directory, `${id}.jsonl`), original = await readFile(file, 'utf8');
      await writeFile(file, original.replace('Original', 'Conflict'));
      await expect(controller.recover(id, true)).rejects.toThrow('conflicts');
      const conflict = await readFile(file, 'utf8');
      expect(conflict).toContain('Conflict'); expect(store.isBlocked(id)).toBe(true);
      await appendFile(file, 'broken record\n' + original.split('\n')[0] + '\n');
      const corrupted = await readFile(file, 'utf8');
      await expect(controller.recover(id, true)).rejects.toThrow('invalid record');
      expect(await readFile(file, 'utf8')).toBe(corrupted);
    } finally { armed = false; await controller.close(); await rm(directory, { recursive: true, force: true }); }
  });
  it('preserves a truncated tail across restart without remembered metadata until an explicit backed-up repair', async () => {
    const directory = await mkdtemp(path.resolve('.cache/storage-'));
    const controller = new DiscussionController(new DiscussionStore(directory), adapters());
    let restarted: DiscussionController | undefined;
    try {
      const id = randomUUID(); await controller.create(id, input({ behaviorVersion: 2 }));
      await controller.start(id, randomUUID()); await controller.wait(id);
      const state = controller.get(id), file = path.join(directory, `${id}.jsonl`);
      await appendFile(file, '{"version":3,"event":');
      const original = await readFile(file, 'utf8');
      const store = new DiscussionStore(directory);
      restarted = new DiscussionController(store, adapters()); await restarted.initialize();
      expect(restarted.get(id).storage?.status).toBe('unconfirmed');
      expect(restarted.get(id).sequence).toBe(state.sequence);
      expect(await readFile(file, 'utf8')).toBe(original);
      await expect(restarted.recover(id)).rejects.toMatchObject({ code: 'TAIL_REPAIR_REQUIRED' });
      const recovered = await restarted.recover(id, true);
      expect(recovered.v2!.calls).toHaveLength(2);
      const recoveryEvent = (await store.records(id)).at(-1)!.event;
      expect(gunzipSync(await readFile(recoveryEvent.data.backup as string)).toString('utf8')).toBe(original);
      await expect(restarted.start(id, randomUUID())).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
      expect(restarted.get(id).v2!.calls).toHaveLength(2);
    } finally { await restarted?.close(); await controller.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
