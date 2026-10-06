import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { publicSourceFiles } from './public-source.mjs';

const root = process.cwd(), cache = path.resolve('.cache');
const destination = path.join(cache, `public-source-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
if (!destination.startsWith(cache + path.sep)) throw new Error('Export must stay in workspace cache.');
const files = await publicSourceFiles(root);
await mkdir(cache, { recursive: true });
await mkdir(destination, { recursive: false });
const entries = [];
for (const file of files) {
  const bytes = await readFile(path.join(root, file)), target = path.join(destination, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });
  entries.push({ path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const scan = spawnSync(process.execPath, [path.join(root, 'scripts/scan-secrets.mjs'), destination], { stdio: 'inherit', windowsHide: true, timeout: 180_000 });
if (scan.error || scan.status !== 0) throw new Error('Public candidate secret scan failed; this directory is not an approved source baseline.');
await writeFile(path.join(destination, 'PUBLIC_SOURCE_MANIFEST.json'), JSON.stringify({ format: 1, createdAt: new Date().toISOString(),
  files: entries, excludes: ['Git history', 'conversations', 'research inputs', 'credentials', 'caches', 'dependencies', 'build outputs'], secretScan: 'gitleaks 8.30.1, redacted, passed' }, null, 2) + '\n');
console.log(`Public source baseline: ${destination}`);
console.log('No Git history was changed and nothing was published.');
