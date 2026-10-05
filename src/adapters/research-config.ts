import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Evidence } from '../domain.js';
import type { TurnRequest } from './types.js';

export async function researchConfig(request: TurnRequest, cwd: string) {
  if (!request.research) return undefined;
  const configFile = path.join(cwd, `${request.messageId}.research.json`);
  const evidenceFile = path.join(cwd, `${request.messageId}.evidence.jsonl`);
  await mkdir(cwd, { recursive: true });
  await writeFile(configFile, JSON.stringify({ roots: request.roots ?? [], evidenceFile }));
  const script = fileURLToPath(new URL('../mcp.js', import.meta.url));
  return { command: process.execPath, args: [script, configFile], evidenceFile };
}
export async function readEvidence(file: string | undefined): Promise<Evidence[]> {
  if (!file) return [];
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch { return []; }
  const schema = z.object({ source: z.string(), text: z.string(), sha256: z.string(), retrievedAt: z.string(), truncated: z.boolean() });
  return text.split('\n').filter(Boolean).map((line) => schema.parse(JSON.parse(line))).slice(0, 100);
}
