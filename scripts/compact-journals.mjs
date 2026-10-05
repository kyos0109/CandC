import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { DiscussionStore } from '../dist/store.js';

// Maintenance is offline so no concurrent server can append during replacement.
const port = Number(process.env.CANDC_PORT ?? 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CANDC_PORT.');
try {
  await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
  throw new Error('Stop CandC before compacting journals.');
} catch (error) {
  if (error.cause?.code !== 'ECONNREFUSED') throw error;
}
const directory = path.resolve(process.env.CANDC_DATA_DIR ?? 'data');
const store = new DiscussionStore(directory);
let before = 0, after = 0, changed = 0;
for (const file of await readdir(directory)) {
  if (!/^[0-9a-f-]{36}\.jsonl$/i.test(file)) continue;
  const result = await store.compact(file.slice(0, -6));
  before += result.before; after += result.after;
  if (result.backup) changed++;
  console.log(JSON.stringify({ id: file.slice(0, -6), ...result }));
}
console.log(JSON.stringify({ changed, before, after, saved: before - after }));
