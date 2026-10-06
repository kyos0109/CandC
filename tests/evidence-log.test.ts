import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { appendEvidence, readEvidence, MAX_EVIDENCE_BYTES, MAX_EVIDENCE_RECORDS } from '../src/evidence-log.js';

const directories: string[] = [];
const evidence = { source: 'fixture.txt', text: 'fixture', sha256: 'fixture-hash', retrievedAt: '2026-10-05T00:00:00Z', truncated: false };
async function file() { const dir = await mkdtemp(path.resolve('.cache/evidence-')); directories.push(dir); return path.join(dir, 'evidence.jsonl'); }
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

it('preserves concurrent tools and refuses the 101st record without changing the file', async () => {
  const target = await file();
  await Promise.all(Array.from({ length: MAX_EVIDENCE_RECORDS }, (_, index) => appendEvidence(target, { ...evidence, text: String(index) })));
  const records = await readEvidence(target);
  expect(new Set(records.map(record => record.text)).size).toBe(MAX_EVIDENCE_RECORDS);
  const before = await readFile(target);
  await expect(appendEvidence(target, evidence)).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
  expect(await readFile(target)).toEqual(before);
});

it('bounds reads and writes by bytes, even below the record count limit', async () => {
  const target = await file();
  await expect(appendEvidence(target, { ...evidence, text: 'x'.repeat(MAX_EVIDENCE_BYTES) })).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
  expect(await readEvidence(target)).toEqual([]);
  await writeFile(target, 'x'.repeat(MAX_EVIDENCE_BYTES + 1));
  await expect(readEvidence(target)).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
});

it('refuses an append that would exceed an existing valid file budget', async () => {
  const target = await file();
  const old = JSON.stringify({ ...evidence, text: 'x'.repeat(8 * 1024 * 1024) }) + '\n';
  await writeFile(target, old);
  await expect(appendEvidence(target, { ...evidence, text: 'x'.repeat(8 * 1024 * 1024) })).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
  expect(await readFile(target, 'utf8')).toBe(old);
});

it('fails closed on corrupt metadata and excessive records instead of dropping evidence', async () => {
  const target = await file();
  await writeFile(target, '{"source":"missing-fields"}\n');
  await expect(readEvidence(target)).rejects.toThrow();
  await expect(appendEvidence(target, evidence)).rejects.toThrow();
  await writeFile(target, (JSON.stringify(evidence) + '\n').repeat(MAX_EVIDENCE_RECORDS + 1));
  await expect(readEvidence(target)).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
});

it('treats only absent files as empty evidence and propagates other I/O errors', async () => {
  expect(await readEvidence(undefined)).toEqual([]);
  const target = await file();
  expect(await readEvidence(target)).toEqual([]);
  await expect(readEvidence(path.dirname(target))).rejects.toThrow();
});
