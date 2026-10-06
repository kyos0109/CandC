import { encode, decode, recordSchema, JournalCorruptionError, type JournalDiscussion, type StoredRecord } from './journal-codec.js';
import { mkdir, open, readFile, readdir, rename, truncate, writeFile, unlink, type FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AppError, discussionStateSchema, runEventSchema, type Discussion, type RunEvent } from './domain.js';
import { withJournalLock } from './journal-lock.js';

const idSchema = z.uuid();
class JournalVersionConflict extends AppError {
  constructor() { super('IDEMPOTENCY_CONFLICT', 'An existing journal cannot change behavior version.', 409); }
}
export class DiscussionStore<T extends JournalDiscussion = Discussion> {
  private readonly latest = new Map<string, T>();
  private readonly blocked = new Map<string, { reason: string; pending?: PendingCommit }>();
  constructor(private readonly directory: string, private readonly fault?: StorageFault,
    private readonly stateContract: z.ZodType<T> = discussionStateSchema as unknown as z.ZodType<T>) {}
  private typed(state: JournalDiscussion): T { return this.stateContract.parse(state); }
  storageIssues() { return [...this.blocked].map(([id, issue]) => ({ id, reason: issue.reason })); }
  isBlocked(id: string) { return this.blocked.has(id); }
  private file(id: string, extension: string): string {
    return path.join(this.directory, `${idSchema.parse(id)}.${extension}`);
  }
  async commit(state: T, event: RunEvent): Promise<void> {
    return withJournalLock(this.file(state.id, 'jsonl'), () => this.commitLocked(state, event));
  }
  private async commitLocked(state: T, event: RunEvent): Promise<void> {
    if (this.blocked.has(state.id)) throw new AppError('STORAGE_UNCONFIRMED', 'Journal storage is unconfirmed; explicit recovery is required.');
    // Cache and pending digests use the same JSON representation as durable replay (including omission of optional undefined keys).
    const validated = recordSchema.safeParse(JSON.parse(JSON.stringify({ state, event })));
    if (!validated.success) throw new AppError('INVALID_STATE', 'Discussion state does not match the journal contract.');
    const record = validated.data;
    this.typed(record.state);
    const pending: PendingCommit = { sequence: event.sequence, type: event.type, commitId: event.commitId ?? null, digestFormat: 'canonical-v1', digest: digest(record, true) };
    try { await this.append(record); }
    catch (error) {
      // A version collision is detected before opening the append handle.
      if (error instanceof JournalVersionConflict) throw error;
      this.latest.delete(state.id);
      this.blocked.set(state.id, { reason: 'Journal storage is unconfirmed; explicit recovery is required.', pending });
      // Best effort failure metadata is outside the journal. Recovery never assumes it exists after restart.
      try { await writeFile(this.file(state.id, 'unconfirmed.json'), JSON.stringify(pending), 'utf8'); } catch { /* Storage may be unavailable. */ }
      throw error;
    }
  }
  private async append(record: StoredRecord): Promise<void> {
    const { state, event } = record;
    await mkdir(this.directory, { recursive: true });
    const journal = this.file(state.id, 'jsonl');
    let text = '';
    try { text = await readFile(journal, 'utf8'); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    const previous = decode(text, state.id).at(-1)?.state;
    if (previous && previous.behaviorVersion !== state.behaviorVersion) {
      throw new JournalVersionConflict();
    }
    const cached = this.latest.get(state.id);
    if (cached && !isDeepStrictEqual(cached, previous)) throw new JournalCorruptionError('Journal changed outside the current writer; explicit recovery is required.');
    if (event.discussionId !== state.id || state.sequence !== event.sequence || event.sequence !== (previous?.sequence ?? 0) + 1) {
      throw new JournalCorruptionError('Cannot append inconsistent identifiers or sequence numbers.');
    }
    if (text && !text.endsWith('\n')) throw new JournalCorruptionError('Journal tail requires explicit recovery before appending.');
    // The journal remains the sole authoritative record. Cache only after durable append.
    const handle = await open(journal, 'a');
    const payload = encode(record, previous) + '\n';
    try {
      await this.fault?.('beforeAppend', handle, payload);
      await handle.writeFile(payload, 'utf8');
      await this.fault?.('afterAppend', handle, payload);
      await this.fault?.('sync', handle, payload);
      await handle.sync();
    } finally { await handle.close(); await this.fault?.('close', handle, payload); }
    this.latest.set(state.id, this.typed(record.state));
  }
  async records(id: string): Promise<{ event: RunEvent; state: T }[]> {
    return decode(await readFile(this.file(id, 'jsonl'), 'utf8'), id, this.blocked.has(id)).map(r => ({ ...r, state: this.typed(r.state) }));
  }
  async recover(id: string, repairTail = false): Promise<{ state: T | null; outcome: 'adopted' | 'not-committed' | 'verified'; backup: string | null }> {
    return withJournalLock(this.file(id, 'jsonl'), () => this.recoverLocked(id, repairTail));
  }
  private async recoverLocked(id: string, repairTail: boolean): Promise<{ state: T | null; outcome: 'adopted' | 'not-committed' | 'verified'; backup: string | null }> {
    this.latest.delete(id);
    const journal = this.file(id, 'jsonl');
    const text = await readFile(journal, 'utf8');
    let pending = this.blocked.get(id)?.pending;
    if (!pending) {
      try { pending = pendingSchema.parse(JSON.parse(await readFile(this.file(id, 'unconfirmed.json'), 'utf8'))); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        this.blocked.set(id, { reason: 'Recovery metadata is invalid; preserve the files for inspection.' }); throw error;
      } }
    }
    this.blocked.set(id, { reason: 'Journal recovery is not yet confirmed.', ...(pending ? { pending } : {}) });
    let repaired = text, backup: string | null = null;
    const tail = text.slice(text.lastIndexOf('\n') + 1);
    if (tail.trim()) {
      try { JSON.parse(tail); }
      catch {
        if (!repairTail) throw new AppError('TAIL_REPAIR_REQUIRED', 'Incomplete journal tail; explicitly authorize tail repair.');
        // Only an invalid, unterminated final line is repairable. A malformed terminated line or middle record is never discarded.
        repaired = text.slice(0, text.lastIndexOf('\n') + 1);
      }
    }
    const records = decode(repaired, id);
    if (!records.length) throw new JournalCorruptionError('No confirmed public record exists; original journal is preserved.');
    const candidate = pending ? records.find(r => r.event.sequence === pending.sequence) : undefined;
    if (candidate && (candidate.event.commitId !== (pending?.commitId ?? undefined) || candidate.event.type !== pending?.type || digest(candidate, pending?.digestFormat === 'canonical-v1') !== pending?.digest)) {
      throw new JournalCorruptionError('Pending commit conflicts with the journal; no repair was attempted.');
    }
    if (repaired && !repaired.endsWith('\n')) repaired += '\n';
    if (repaired !== text) {
      backup = this.file(id, `jsonl.recovery-${Date.now()}.gz`);
      const saved = await open(backup, 'wx');
      try { await saved.writeFile(gzipSync(text)); await saved.sync(); } finally { await saved.close(); }
      await truncate(journal, Buffer.byteLength(repaired.replace(/\n$/, '')));
      if (repaired.endsWith('\n')) {
        const tailHandle = await open(journal, 'a');
        try { await tailHandle.writeFile('\n'); } finally { await tailHandle.close(); }
      }
    }
    // Reading alone is insufficient. Verify replay again and require sync and close before releasing the barrier.
    const verified = decode(await readFile(journal, 'utf8'), id);
    if (!isDeepStrictEqual(verified, records)) throw new JournalCorruptionError('Recovery replay changed unexpectedly.');
    const handle = await open(journal, 'r+');
    try { await this.fault?.('recoverySync', handle, ''); await handle.sync(); }
    finally { await handle.close(); await this.fault?.('recoveryClose', handle, ''); }
    try { await unlink(this.file(id, 'unconfirmed.json')); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    this.blocked.delete(id);
    const state = this.typed(verified.at(-1)!.state);
    this.latest.set(id, state);
    return { state, outcome: candidate ? 'adopted' : pending ? 'not-committed' : 'verified', backup };
  }
  // Offline only: stop the server before replacing journals. Backups are never removed here.
  async compact(id: string): Promise<{ before: number; after: number; backup: string | null }> {
    return withJournalLock(this.file(id, 'jsonl'), () => this.compactLocked(id));
  }
  private async compactLocked(id: string): Promise<{ before: number; after: number; backup: string | null }> {
    if (this.blocked.has(id)) throw new AppError('STORAGE_UNCONFIRMED', 'Recover storage before offline compaction.');
    const journal = this.file(id, 'jsonl'), original = await readFile(journal, 'utf8');
    const records = decode(original, id);
    const compacted = records.map((record, index) => encode(record, records[index - 1]?.state)).join('\n') + '\n';
    if (!isDeepStrictEqual(decode(compacted, id), records)) throw new Error('Compaction replay did not match the original history.');
    const before = Buffer.byteLength(original), after = Buffer.byteLength(compacted);
    if (after >= before) return { before, after: before, backup: null };
    const backup = this.file(id, `jsonl.backup-${Date.now()}.gz`);
    const backupHandle = await open(backup, 'wx');
    try { await backupHandle.writeFile(gzipSync(original)); await backupHandle.sync(); }
    finally { await backupHandle.close(); }
    const temporary = this.file(id, 'jsonl.compacting');
    const handle = await open(temporary, 'wx');
    try { await handle.writeFile(compacted, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    if (!isDeepStrictEqual(decode(await readFile(temporary, 'utf8'), id), records)) throw new Error('Written compaction verification failed.');
    await rename(temporary, journal);
    this.latest.delete(id);
    return { before, after, backup };
  }
  async list(): Promise<T[]> {
    await mkdir(this.directory, { recursive: true });
    const files = (await readdir(this.directory)).filter(file => file.endsWith('.jsonl') && idSchema.safeParse(file.slice(0, -6)).success);
    const states = await Promise.all(files.map(async file => {
      const id = file.slice(0, -6);
      try {
        const text = await readFile(this.file(id, 'jsonl'), 'utf8');
        // Startup verifies durable readable journals without scheduling or repairing anything.
        const records = decode(text, id, true);
        const last = records.at(-1)?.state;
        if (!last || !this.stateContract.safeParse(last).success) return undefined;
        try { await this.recover(id); }
        catch { return this.typed(last); }
        return this.typed(last);
      }
      catch (error) {
        if (!(error instanceof JournalCorruptionError)) throw error;
        console.warn(`Discussion ${id} was excluded from recovery: ${error.message}`);
        this.blocked.set(id, { reason: error.message });
        return undefined;
      }
    }));
    return states.flatMap(state => state === undefined ? [] : [this.typed(state)]);
  }
}

const pendingSchema = z.object({ sequence: z.number().int().positive(), type: runEventSchema.shape.type, commitId: z.uuid().nullable(), digest: z.string(), digestFormat: z.literal('canonical-v1').optional() }).strict();
type PendingCommit = z.infer<typeof pendingSchema>;
// Compact message references may restore object keys in schema order. Hash JSON values,
// not insertion order; retain legacy digest checks for preexisting failure metadata.
const digest = (record: StoredRecord, canonical = false) => createHash('sha256').update(JSON.stringify(record, canonical ? (_key, value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value : undefined)).digest('hex');
export type StorageStage = 'beforeAppend' | 'afterAppend' | 'sync' | 'close' | 'recoverySync' | 'recoveryClose';
export type StorageFault = (stage: StorageStage, handle: FileHandle, payload: string) => Promise<void>;
