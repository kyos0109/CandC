import { open } from 'node:fs/promises';
import { z } from 'zod';
import { AppError, type Evidence } from './domain.js';
import { withJournalLock } from './journal-lock.js';

export const MAX_EVIDENCE_RECORDS = 100;
export const MAX_EVIDENCE_BYTES = 16 * 1024 * 1024;
const evidenceSchema = z.object({ source: z.string(), text: z.string(), sha256: z.string(), retrievedAt: z.string(), truncated: z.boolean() }).strict();
const limit = () => new AppError('OUTPUT_LIMIT', 'Research evidence exceeds the per-turn storage limit.');

/** A bounded read also detects a file that grows after stat; only a missing file means no evidence. */
export async function readEvidence(file: string | undefined): Promise<Evidence[]> {
  if (!file) return [];
  let handle;
  try { handle = await open(file, 'r'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  try {
    if ((await handle.stat()).size > MAX_EVIDENCE_BYTES) throw limit();
    const chunks: Buffer[] = [];
    let bytes = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_EVIDENCE_BYTES + 1 - bytes));
      const read = await handle.read(chunk, 0, chunk.length, null);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
      if (bytes > MAX_EVIDENCE_BYTES) throw limit();
      chunks.push(chunk.subarray(0, read.bytesRead));
    }
    const lines = Buffer.concat(chunks).toString('utf8').split('\n').filter(line => line.trim());
    if (lines.length > MAX_EVIDENCE_RECORDS) throw limit();
    return lines.map(line => evidenceSchema.parse(JSON.parse(line)));
  } finally { await handle.close(); }
}

/** Serializes concurrent tools in this gateway before checking and appending their evidence. */
export async function appendEvidence(file: string, value: Evidence): Promise<void> {
  const record = evidenceSchema.parse(value), line = JSON.stringify(record) + '\n';
  if (Buffer.byteLength(line) > MAX_EVIDENCE_BYTES) throw limit();
  await withJournalLock(file, async () => {
    const existing = await readEvidence(file);
    if (existing.length >= MAX_EVIDENCE_RECORDS) throw limit();
    const handle = await open(file, 'a');
    try {
      if ((await handle.stat()).size + Buffer.byteLength(line) > MAX_EVIDENCE_BYTES) throw limit();
      await handle.writeFile(line);
    } finally { await handle.close(); }
  });
}
