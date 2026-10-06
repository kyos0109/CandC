import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { publicSourceFiles } from './public-source.mjs';

const version = '8.30.1';
const checksum = 'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e';
if (process.platform !== 'win32') throw new Error('This pinned scanner installer targets Windows x64.');
const root = process.cwd(), cache = path.resolve('.cache'), tools = path.join(cache, 'tools', `gitleaks-${version}`);
await mkdir(tools, { recursive: true });
const archive = path.join(tools, 'gitleaks.zip');
let bytes;
try { bytes = await readFile(archive); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!bytes) {
  const response = await fetch(`https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_windows_x64.zip`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Gitleaks download failed: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(bytes).digest('hex') !== checksum) throw new Error('Gitleaks archive integrity mismatch.');
await writeFile(archive, bytes);
const psQuote = value => `'${value.replaceAll("'", "''")}'`;
function run(executable, args) {
  const result = spawnSync(executable, args, { stdio: 'inherit', shell: false, windowsHide: true, timeout: 120_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Secret scan command failed (exit ${result.status}).`);
}
run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${psQuote(archive)} -DestinationPath ${psQuote(tools)} -Force`]);
const executable = path.join(tools, 'gitleaks.exe');
const report = await mkdtemp(path.join(cache, 'secret-scan-'));
const supplied = process.argv[2];
let source = supplied ? path.resolve(supplied) : path.join(report, 'source');
if (!supplied) {
  for (const file of await publicSourceFiles(root)) {
    const target = path.join(source, file);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(root, file), target);
  }
}
const flags = ['--redact', '--no-banner', '--config', path.join(root, '.gitleaks.toml')];
run(executable, ['dir', source, ...flags, '--report-format', 'json', '--report-path', path.join(report, 'source.json')]);
if (!supplied) run(executable, ['git', root, ...flags, '--log-opts=--all', '--report-format', 'json', '--report-path', path.join(report, 'history.json')]);
console.log(`Redacted secret scan reports: ${path.relative(root, report)}`);
