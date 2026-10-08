import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractAttachment, AttachmentStore, type UploadedFile } from '../src/attachments.js';
import { prepareAttachments } from '../src/attachment-upload.js';
import { RoomController } from '../src/room-controller.js';
import { DiscussionStore, type StorageFault } from '../src/store.js';
import { roomInputSchema, roomStateSchema, type RoomDiscussion } from '../src/room-contract.js';
import { RoomFakeAdapter, fakeRoomResponse } from '../src/adapters/room-fake.js';
import type { TurnRequest } from '../src/adapters/types.js';
import { buildPrompt } from '../src/adapters/types.js';
import { docx, pdf, xlsx, zip } from './fixtures/attachments.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function directory() { const dir = await mkdtemp(path.resolve('.cache/attachment-test-')); cleanups.push(() => rm(dir, { recursive: true, force: true })); return dir; }
async function upload(dir: string, name: string, contents: string | Buffer): Promise<UploadedFile> {
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents), file = path.join(dir, randomUUID()); await writeFile(file, bytes);
  return { name, path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const roomInput = () => roomInputSchema.parse({ behaviorVersion: 3, topic: 'Attachment fixture', backend: 'fake', mode: 'manual', flow: 'alternating',
  participants: ['codex', 'codex-2'].map(id => ({ id, provider: 'codex', role: 'speaker', settings: { model: 'fixture', effort: 'medium' } })),
  moderator: { id: 'moderator', provider: 'codex', role: 'moderator', settings: { model: 'fixture', effort: 'medium' } },
  limits: { maxRounds: 20, maxDurationMs: 60_000, turnTimeoutMs: 5_000, maxModeratorCalls: 100 } });
async function room(fault?: StorageFault) {
  const dir = await directory(), requests: TurnRequest[] = [], outgoing: TurnRequest[] = [], store = new DiscussionStore<RoomDiscussion>(dir, fault, roomStateSchema);
  const adapters = new Map<string, RoomFakeAdapter>();
  const controller = new RoomController(store, (provider, workspace) => {
    let adapter = adapters.get(workspace);
    if (!adapter) { adapter = new RoomFakeAdapter(provider, request => { requests.push(request); return fakeRoomResponse(request); }, 0); adapters.set(workspace, adapter); }
    return { id: provider, backend: 'fake', run: request => { outgoing.push(request); return adapter.run(request); } };
  });
  cleanups.push(() => controller.close()); await controller.initialize();
  return { dir, store, controller, requests, outgoing };
}

describe('attachment extraction and storage', () => {
  it('extracts supported files into the actual AI prompt, preserving PDF and worksheet locations', async () => {
    const { dir, controller, requests } = await room();
    const fixtures: [string, string | Buffer, string][] = [['notes.txt', '文字 fixture', '文字 fixture'], ['code.ts', 'const amount = 42;', 'const amount = 42;'],
      ['data.csv', 'name,value\nfixture,42', 'fixture,42'], ['data.json', '{"fixture":42}', '"fixture":42'], ['doc.pdf', pdf(), '[Page 1]'], ['doc.docx', docx(), 'DOCX fixture body'], ['book.xlsx', await xlsx(), 'C1: formula=B1*2; cached=84']];
    for (const [name, content, expected] of fixtures) {
      const id = randomUUID(), prepared = await extractAttachment(await upload(dir, name, content));
      await controller.create(id, roomInput(), undefined, [prepared]); await controller.start(id, randomUUID()); await controller.wait(id);
      const current = requests.filter(r => r.room?.messages.some(m => m.attachments?.some(a => a.id === prepared.metadata.id)));
      expect(new Set(current.map(r => r.room!.actor))).toEqual(new Set(['codex', 'codex-2', 'moderator']));
      for (const request of current) { expect(JSON.parse(buildPrompt(request)).messages.flatMap((m: { attachments?: { text: string }[] }) => m.attachments?.map(a => a.text) ?? []).join('\n')).toContain(expected); expect(buildPrompt(request)).not.toContain(prepared.source); }
      const saved = controller.get(id); expect(saved.messages[0]!.attachments![0]).toEqual(prepared.metadata);
      expect(JSON.stringify(saved)).not.toContain('DOCX fixture body');
      expect(saved.room.calls[0]!.attachments).toEqual([{ id: prepared.metadata.id, textSha256: prepared.metadata.textSha256 }]);
    }
  }, 25_000);
  it('supports BOM UTF-16, rejects invalid encoding, redacts only AI text and verifies stored hashes', async () => {
    const dir = await directory(), id = randomUUID(), store = new AttachmentStore(dir);
    const source = Buffer.concat([Buffer.from([255, 254]), Buffer.from('中文\npassword=fixture-secret', 'utf16le')]);
    const file = await extractAttachment(await upload(dir, 'notes.txt', source));
    expect(file.text).toContain('中文'); expect(file.text).not.toContain('fixture-secret'); expect(file.metadata.warnings).toContain('redacted');
    await store.save(id, [file]); expect(await store.read(id, file.metadata, 'original')).toEqual(source);
    expect((await store.hydrate(id, [file.metadata]))[0]!.text).toBe(file.text);
    await expect(extractAttachment(await upload(dir, 'notes.txt', Buffer.from([0xff, 0xff])))).rejects.toMatchObject({ code: 'ATTACHMENT_ENCODING' });
    const bigEndian = Buffer.from('中文', 'utf16le').swap16();
    expect((await extractAttachment(await upload(dir, 'be.txt', Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndian])))).text).toBe('中文');
    await writeFile(path.join(dir, 'attachments', `${id}.${file.metadata.id}.text`), 'tampered');
    await expect(store.hydrate(id, [file.metadata])).rejects.toMatchObject({ code: 'ATTACHMENT_UNAVAILABLE' });
    await store.remove(id); expect(await store.names(id)).toEqual([]);
  });
  it('rejects empty, malformed, oversized, unsupported and unsafe files without truncating', async () => {
    const dir = await directory();
    for (const [name, data, code] of [['empty.txt', ' ', 'ATTACHMENT_EMPTY'], ['bad.pdf', 'garbage', 'ATTACHMENT_INVALID'], ['bad.docx', 'garbage', 'ATTACHMENT_INVALID'],
      ['image.png', 'binary', 'ATTACHMENT_FORMAT'], ['../file.txt', 'text', 'ATTACHMENT_NAME'], ['large.txt', 'x'.repeat(100_001), 'ATTACHMENT_TEXT_LIMIT']] as const) {
      await expect(extractAttachment(await upload(dir, name, data))).rejects.toMatchObject({ code });
    }
    const large = await upload(dir, 'large.txt', 'x'); large.bytes = 10 * 1024 * 1024 + 1;
    await expect(extractAttachment(large)).rejects.toMatchObject({ code: 'ATTACHMENT_SIZE' });
    await expect(extractAttachment(await upload(dir, 'timed.txt', 'text'), 1)).rejects.toMatchObject({ code: 'ATTACHMENT_TIMEOUT' });
    const hugeZip = zip({ 'large.xml': Buffer.alloc(101 * 1024 * 1024, 65) });
    await expect(extractAttachment(await upload(dir, 'bomb.docx', hugeZip))).rejects.toMatchObject({ code: 'ATTACHMENT_ARCHIVE_LIMIT' });
    const encrypted = docx(); encrypted.writeUInt16LE(1, 6); encrypted.writeUInt16LE(1, encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 8);
    await expect(extractAttachment(await upload(dir, 'encrypted.docx', encrypted))).rejects.toMatchObject({ code: 'ATTACHMENT_ARCHIVE_LIMIT' });
    const three = await Promise.all([1, 2, 3].map(i => upload(dir, `${i}.txt`, 'x'.repeat(80_000))));
    await expect(prepareAttachments(three)).rejects.toMatchObject({ code: 'ATTACHMENT_TEXT_LIMIT', fileName: '3.txt' });
  }, 15_000);
});

describe('attachment lifecycle and privacy', () => {
  it('isolates same-provider seats and moderator, rehydrates after rebuild, and deduplicates retries', async () => {
    const { dir, controller, store, requests, outgoing } = await room(), id = randomUUID(), messageId = randomUUID();
    await controller.create(id, roomInput());
    const file = await upload(dir, 'private.txt', 'PRIVATE_ATTACHMENT_FIXTURE'), prepared = await extractAttachment(file);
    await controller.send(id, messageId, '', 'codex-2', null, [prepared]);
    const before = controller.get(id).sequence;
    await controller.send(id, messageId, '', 'codex-2', null, [await extractAttachment(file)]);
    expect(controller.get(id).sequence).toBe(before); expect(await store.attachments.names(id)).toHaveLength(2);
    await expect(controller.send(id, messageId, 'different', 'codex-2', null, [prepared])).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await controller.start(id, randomUUID()); await controller.wait(id);
    for (const request of requests) expect(buildPrompt(request).includes('PRIVATE_ATTACHMENT_FIXTURE')).toBe(request.room!.actor === 'codex-2');
    const sentCount = outgoing.length; await controller.start(id, randomUUID()); await controller.wait(id);
    expect(outgoing.slice(sentCount).flatMap(r => r.room!.messages.flatMap(m => m.attachments ?? []))).toHaveLength(0);
    const count = requests.length; await controller.rebuild(id, randomUUID(), controller.get(id).room.taskVersion);
    await controller.start(id, randomUUID()); await controller.wait(id);
    expect(requests.slice(count).find(r => r.room!.actor === 'codex-2')?.room?.messages.flatMap(m => m.attachments ?? [])[0]?.text).toBe('PRIVATE_ATTACHMENT_FIXTURE');
    const saved = (await store.list()).find(s => s.id === id); expect(saved!.messages.find(m => m.id === messageId)?.attachments).toEqual([prepared.metadata]);
    expect((await controller.attachmentExport(id))[0]!.text).toBe('PRIVATE_ATTACHMENT_FIXTURE');
    await expect(controller.attachment(randomUUID(), prepared.metadata.id, 'text')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const damaged = path.join(dir, 'attachments', `${id}.${prepared.metadata.id}.original`); await unlink(damaged);
    await controller.rebuild(id, randomUUID(), controller.get(id).room.taskVersion);
    const length = requests.length; await controller.start(id, randomUUID()); await controller.wait(id);
    expect(requests.slice(length).filter(r => r.room!.actor === 'codex-2')).toHaveLength(0);
    expect(controller.get(id).pauseReason).toContain('Attachment');
  }, 15_000);
  it('retains attachments on uncertain commits, blocks inference, and recovers without retry', async () => {
    let fail = false; const { dir, controller, store, requests } = await room(async stage => { if (fail && stage === 'afterAppend') throw new Error('Injected failure'); });
    const id = randomUUID(); await controller.create(id, roomInput()); fail = true;
    const file = await extractAttachment(await upload(dir, 'saved.txt', 'Durable fixture'));
    await expect(controller.send(id, randomUUID(), '', 'all', null, [file])).rejects.toThrow();
    expect(store.isBlocked(id)).toBe(true); expect(await store.attachments.names(id)).toHaveLength(2);
    await expect(controller.start(id, randomUUID())).rejects.toThrow(); expect(requests).toHaveLength(0);
    fail = false; await controller.recover(id, false);
    expect((await controller.attachment(id, file.metadata.id, 'text')).bytes.toString()).toBe('Durable fixture');
    expect(requests).toHaveLength(0);
  });
  it('rejects oversized attachment history before loading files or invoking a provider', async () => {
    const { dir, controller, store, outgoing } = await room(), id = randomUUID();
    await controller.create(id, roomInput());
    const file = await upload(dir, 'large.txt', 'A'.repeat(100_000));
    for (let n = 0; n < 11; n++) await controller.send(id, randomUUID(), '', 'all', null, [await extractAttachment(file)]);
    const hydrate = vi.spyOn(store.attachments, 'hydrate');
    await controller.start(id, randomUUID()); await controller.wait(id);
    expect(hydrate).not.toHaveBeenCalled(); expect(outgoing).toHaveLength(0);
    expect(controller.get(id).pauseReason).toContain('no history was truncated');
  }, 15_000);
  it('cleans definitively failed saves, and includes attachments in retryable permanent deletion', async () => {
    const { dir, controller, store } = await room(), id = randomUUID(), input = roomInput();
    const file = await extractAttachment(await upload(dir, 'saved.txt', 'Permanent deletion fixture'));
    await controller.create(id, input, undefined, [file]);
    await controller.create(id, input, undefined, [await extractAttachment({ name: file.metadata.name, path: file.source, bytes: file.metadata.bytes, sha256: file.metadata.sha256 })]);
    expect(await store.attachments.names(id)).toHaveLength(2);
    await controller.manage(id, 'trash', randomUUID(), controller.get(id).sequence);
    const sequence = controller.get(id).sequence, operation = randomUUID();
    const remove = vi.spyOn(store.attachments, 'remove').mockRejectedValueOnce(new Error('Injected delete failure'));
    await expect(controller.permanentDelete(id, operation, sequence)).rejects.toThrow(); expect(await store.deletionIssues()).toHaveLength(1);
    remove.mockRestore(); await controller.permanentDelete(id, operation, sequence);
    expect(await store.attachments.names(id)).toHaveLength(0); expect(await store.deletionIssues()).toHaveLength(0);
    const bad = await extractAttachment(await upload(dir, 'bad.txt', 'before'));
    await writeFile(bad.source, 'after'); await expect(store.attachments.save(randomUUID(), [bad])).rejects.toThrow('changed');
  });
});
