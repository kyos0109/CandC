import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const cache = path.resolve('.cache');
const root = path.resolve(process.env.CANDC_VERIFY_DIR ?? '.cache/verification');
if (!root.startsWith(cache + path.sep)) throw new Error('Verification output must be an isolated child of the workspace cache.');
await mkdir(root, { recursive: true });
for (const args of [
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json', '--outDir', path.join(root, 'dist')],
  ['node_modules/vite/bin/vite.js', 'build', '--outDir', path.join(root, 'web-dist')],
]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true, timeout: 60_000 });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
console.log(`Isolated build: ${root}`);
