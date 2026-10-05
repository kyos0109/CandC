import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { it, expect } from 'vitest';
import { DiscussionService } from '../src/discussion-service.js';
import { DiscussionController } from '../src/controller.js';
import { RoomController } from '../src/room-controller.js';
import { DiscussionStore, type StorageFault } from '../src/store.js';
import { FakeAdapter } from '../src/adapters/fake.js';
import { RoomFakeAdapter } from '../src/adapters/room-fake.js';
import { roomStateSchema } from '../src/room-contract.js';
import { input } from './helpers.js';

it('lists mixed versions, upgrades only by explicit creation, and leaves original journals byte-identical', async () => {
  const directory = await mkdtemp(path.resolve('.cache/service-test-'));
  const build = () => new DiscussionService(new DiscussionController(new DiscussionStore(directory), { codex: new FakeAdapter('codex'), claude: new FakeAdapter('claude') }),
    new RoomController(new DiscussionStore(directory, undefined, roomStateSchema), provider => new RoomFakeAdapter(provider)));
  const service = build();
  try {
    await service.initialize(); const oldId = randomUUID(), focusedId = randomUUID();
    await service.create(oldId, input()); await service.create(focusedId, input({ behaviorVersion: 2 }));
    const privateId = randomUUID(); await service.send(oldId, privateId, 'PRIVATE-CODEX-HISTORY', 'codex');
    const oldBytes = await readFile(path.join(directory, oldId + '.jsonl')), focusedBytes = await readFile(path.join(directory, focusedId + '.jsonl'));
    const newId = randomUUID(); const next = await service.upgradeRoom(oldId, newId);
    expect(next.room.sourceDiscussionId).toBe(oldId); expect(next.room.sessions).toEqual({}); expect(next.moderator).toBeNull();
    expect(next.messages.find(m => m.id === privateId)?.recipient).toBe('codex');
    const firstRecord = (await service.rooms.events(newId))[0]!;
    expect(firstRecord.sequence).toBe(1); expect(next.sequence).toBe(1);
    const roomStore = new DiscussionStore(path.resolve(directory), undefined, roomStateSchema);
    const firstState = (await roomStore.records(newId))[0]!.state;
    expect(firstState.room.sourceDiscussionId).toBe(oldId); expect(firstState.messages).toEqual(next.messages);
    expect(await readFile(path.join(directory, oldId + '.jsonl'))).toEqual(oldBytes); expect(await readFile(path.join(directory, focusedId + '.jsonl'))).toEqual(focusedBytes);
    expect(service.list()).toHaveLength(3); await expect(service.upgradeRoom(oldId, newId)).resolves.toEqual(next);
    const restarted = build(); await restarted.initialize(); expect(restarted.list().map(s => s.behaviorVersion).sort()).toEqual([1, 2, 3]);
    expect(await readFile(path.join(directory, oldId + '.jsonl'))).toEqual(oldBytes); await restarted.close();
  } finally { await service.close(); await rm(directory, { recursive: true, force: true }); }
});

it.each(['afterAppend', 'sync', 'close'] as const)('keeps copied history complete and scheduling blocked until an uncertain upgrade %s is verified', async stage => {
  const directory = await mkdtemp(path.resolve('.cache/service-upgrade-test-')); let armed = true;
  const fault: StorageFault = async current => { if (armed && current === stage) { armed = false; throw new Error('Uncertain room creation.'); } };
  const build = (storageFault?: StorageFault) => new DiscussionService(
    new DiscussionController(new DiscussionStore(directory), { codex: new FakeAdapter('codex'), claude: new FakeAdapter('claude') }),
    new RoomController(new DiscussionStore(directory, storageFault, roomStateSchema), provider => new RoomFakeAdapter(provider)));
  const service = build(fault); let restarted: DiscussionService | undefined;
  try {
    await service.initialize(); const oldId = randomUUID(), newId = randomUUID(), privateId = randomUUID();
    await service.create(oldId, input()); await service.send(oldId, privateId, 'PRIVATE-UPGRADE-HISTORY', 'codex');
    const original = await readFile(path.join(directory, `${oldId}.jsonl`));
    await expect(service.upgradeRoom(oldId, newId)).rejects.toThrow('Uncertain room creation.');
    await expect(service.start(newId, randomUUID())).rejects.toMatchObject({ code: 'STORAGE_UNCONFIRMED' });
    // Startup normally verifies sync and close. Hold that verification unavailable to
    // exercise the durable storage barrier across a fresh controller and explicit recovery.
    let blockRecovery = true;
    restarted = build(async current => { if (blockRecovery && current === 'recoverySync') throw new Error('Recovery sync unavailable.'); });
    await restarted.initialize();
    const reloaded = restarted.rooms.get(newId);
    expect(reloaded.room.sourceDiscussionId).toBe(oldId); expect(reloaded.messages.find(m => m.id === privateId)?.recipient).toBe('codex');
    expect(reloaded.storage?.status).toBe('unconfirmed');
    await expect(restarted.start(newId, randomUUID())).rejects.toMatchObject({ code: 'STORAGE_UNCONFIRMED' });
    await expect(restarted.upgradeRoom(oldId, newId)).resolves.toEqual(reloaded);
    blockRecovery = false; await restarted.recover(newId); const recovered = restarted.rooms.get(newId);
    expect(recovered.room.sourceDiscussionId).toBe(oldId); expect(recovered.messages).toEqual(reloaded.messages);
    expect(recovered.status).toBe('indeterminate');
    expect(await readFile(path.join(directory, `${oldId}.jsonl`))).toEqual(original);
  } finally { await restarted?.close(); await service.close(); await rm(directory, { recursive: true, force: true }); }
});
