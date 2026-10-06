import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const executable = process.env.CANDC_CODEX_PATH || 'codex';
const cache = path.resolve('.cache/codex-protocol');
const destination = path.resolve('src/generated/codex');
const generated = spawnSync(executable, ['app-server', 'generate-ts', '--out', cache], {
  shell: false, windowsHide: true, encoding: 'utf8', timeout: 30_000,
});
if (generated.status !== 0) throw new Error('Codex protocol generation failed.');
const copied = new Set();
async function copy(relative) {
  if (copied.has(relative)) return;
  copied.add(relative);
  const source = await readFile(path.join(cache, relative), 'utf8');
  for (const match of source.matchAll(/from "([^"]+)"/g)) {
    await copy(path.normalize(path.join(path.dirname(relative), `${match[1]}.ts`)));
  }
  const target = path.join(destination, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source.replace(/from "([^"]+)"/g, 'from "$1.js"'));
}
for (const file of ['InitializeParams.ts', 'v2/ThreadStartParams.ts',
  'v2/ThreadResumeParams.ts', 'v2/TurnStartParams.ts']) {
  await copy(file);
}
const version = spawnSync(executable, ['--version'], {
  windowsHide: true, encoding: 'utf8', timeout: 10_000,
});
await writeFile(path.join(destination, 'VERSION'), version.stdout.trim() + '\n');
console.log(`Generated ${copied.size} protocol files for ${version.stdout.trim()}.`);
