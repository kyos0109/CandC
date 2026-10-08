import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, lstat, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { AppError } from './domain.js';
import { redact } from './redaction.js';
import { attachmentAccept, attachmentLimits, attachmentSchema, type Attachment, type ReadableAttachment } from './attachment-contract.js';

export type UploadedFile = { name: string; path: string; bytes: number; sha256: string };
export type PreparedAttachment = { metadata: Attachment; source: string; text: string };
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function attachmentFormat(name: string): Attachment['format'] {
  const extension = path.extname(name).toLowerCase();
  if (!attachmentAccept.split(',').includes(extension)) throw new AppError('ATTACHMENT_FORMAT', 'Unsupported attachment format.', 415);
  return extension === '.pdf' ? 'pdf' : extension === '.docx' ? 'docx' : extension === '.xlsx' ? 'xlsx' : 'text';
}
export async function extractAttachment(file: UploadedFile, timeoutMs: number = attachmentLimits.timeoutMs): Promise<PreparedAttachment> {
  if (!file.name || file.name.length > 240 || /[\x00-\x1f\x7f/\\]/.test(file.name)) throw new AppError('ATTACHMENT_NAME', 'Invalid attachment name.', 400);
  if (file.bytes <= 0 || file.bytes > attachmentLimits.fileBytes) throw new AppError('ATTACHMENT_SIZE', 'Attachment size limit exceeded.', 413);
  const format = attachmentFormat(file.name), compiled = new URL('./attachment-worker.js', import.meta.url);
  const entry = existsSync(compiled) ? compiled : new URL('./attachment-worker.ts', import.meta.url);
  const text = await new Promise<string>((resolve, reject) => {
    const worker = new Worker(entry, { workerData: { path: file.path, format }, execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 256 }, stdout: true, stderr: true });
    // Document/parser diagnostics must not escape into application logs.
    worker.stdout.resume(); worker.stderr.resume();
    const timer = setTimeout(() => { void worker.terminate(); reject(new AppError('ATTACHMENT_TIMEOUT', 'Attachment parsing timed out.', 422)); }, timeoutMs);
    worker.once('message', (result: { text?: string; error?: string }) => {
      clearTimeout(timer); void worker.terminate();
      if (typeof result.text === 'string') resolve(result.text);
      else reject(new AppError(result.error ?? 'ATTACHMENT_INVALID', 'Attachment cannot be parsed.', 422));
    });
    worker.once('error', () => { clearTimeout(timer); reject(new AppError('ATTACHMENT_INVALID', 'Attachment cannot be parsed.', 422)); });
    worker.once('exit', () => { clearTimeout(timer); reject(new AppError('ATTACHMENT_INVALID', 'Attachment parser stopped.', 422)); });
  });
  if (!text.trim() || text.length > attachmentLimits.fileCharacters) throw new AppError('ATTACHMENT_TEXT_LIMIT', 'Attachment text limit exceeded.', 413);
  const safe = redact(text, true);
  return { source: file.path, text: safe, metadata: attachmentSchema.parse({ id: randomUUID(), name: redact(file.name), format,
    bytes: file.bytes, sha256: file.sha256, textSha256: hash(safe), characters: safe.length, parserVersion: 1,
    warnings: [...(format === 'text' ? [] : ['text-only']), ...(safe === text ? [] : ['redacted'])] }) };
}
export function attachmentFingerprint(files: PreparedAttachment[] | Attachment[]) {
  return files.map(file => { const a = 'metadata' in file ? file.metadata : file; return { name: a.name, sha256: a.sha256, bytes: a.bytes }; });
}

export class AttachmentStore {
  private readonly directory: string;
  constructor(historyDirectory: string) { this.directory = path.resolve(historyDirectory, 'attachments'); }
  private async directoryExists(create = false) {
    if (create) await mkdir(this.directory, { recursive: true });
    try { const info = await lstat(this.directory); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid attachment directory'); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }
  private file(id: string, attachmentId: string, kind: 'original' | 'text') {
    return path.join(this.directory, `${z.uuid().parse(id)}.${z.uuid().parse(attachmentId)}.${kind}`);
  }
  private async syncDirectory() {
    if (process.platform === 'win32') return; // Windows does not support opening a directory for fsync.
    for (const directory of [this.directory, path.dirname(this.directory)]) {
      const handle = await open(directory, 'r'); try { await handle.sync(); } finally { await handle.close(); }
    }
  }
  async save(id: string, files: PreparedAttachment[]): Promise<Attachment[]> {
    if (!files.length) return [];
    await this.directoryExists(true);
    const written: string[] = [];
    try {
      for (const file of files) {
        const raw = await readFile(file.source);
        if (raw.length !== file.metadata.bytes || hash(raw) !== file.metadata.sha256 || hash(file.text) !== file.metadata.textSha256) throw new Error('Attachment changed before saving');
        for (const [kind, bytes] of [['original', raw], ['text', Buffer.from(file.text)]] as const) {
          const target = this.file(id, file.metadata.id, kind), handle = await open(target, 'wx', 0o600); written.push(target);
          try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        }
      }
      await this.syncDirectory(); return files.map(file => file.metadata);
    } catch (error) { for (const file of written) await unlink(file).catch(() => undefined); throw error; }
  }
  async read(id: string, attachment: Attachment, kind: 'original' | 'text'): Promise<Buffer> {
    try {
      if (!await this.directoryExists()) throw new Error('Missing attachment directory');
      const file = this.file(id, attachment.id, kind), info = await lstat(file);
      const max = kind === 'original' ? attachmentLimits.fileBytes : attachmentLimits.fileCharacters * 4;
      if (!info.isFile() || info.isSymbolicLink() || info.size > max) throw new Error('Invalid attachment file');
      const bytes = await readFile(file);
      if (hash(bytes) !== (kind === 'original' ? attachment.sha256 : attachment.textSha256)) throw new Error('Attachment hash mismatch');
      return bytes;
    } catch { throw new AppError('ATTACHMENT_UNAVAILABLE', 'Attachment is missing or damaged; inference was not started.', 409); }
  }
  async hydrate(id: string, attachments: Attachment[]): Promise<ReadableAttachment[]> {
    const result: ReadableAttachment[] = [];
    for (const a of attachments) {
      await this.read(id, a, 'original');
      result.push({ ...a, text: (await this.read(id, a, 'text')).toString('utf8') });
    }
    return result;
  }
  async remove(id: string, attachments?: Attachment[]) {
    if (!await this.directoryExists()) return;
    const names = attachments ? attachments.flatMap(a => [this.file(id, a.id, 'original'), this.file(id, a.id, 'text')])
      : (await this.names(id)).map(name => path.join(this.directory, name));
    for (const file of names) {
      try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Invalid attachment file'); await unlink(file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    await this.syncDirectory();
  }
  async names(id: string): Promise<string[]> {
    z.uuid().parse(id); if (!await this.directoryExists()) return [];
    return (await readdir(this.directory)).filter(name => name.startsWith(`${id}.`));
  }
}
