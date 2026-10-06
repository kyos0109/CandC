import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
export { readEvidence } from '../evidence-log.js';
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
