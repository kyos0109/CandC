// Standalone installer and runtime manager: only Node.js 24 built-ins are required.
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile, rename, rm, lstat, readdir, chmod, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const INSTALL_HELP = `CandC installer (Node.js 24 required)
  node install.mjs --repo OWNER/REPO [--version vX.Y.Z] [--install-dir PATH]
                   [--port PORT] [--no-start] [--no-browser]
  node install.mjs --archive PATH [--install-dir PATH] [--no-start]
Local archives require an adjacent SHA256SUMS file. PATH is never changed.`;
const VERSION = /^v?\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const defaultInstallDir = () => process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local'), 'CandC')
  : path.join(homedir(), '.local', 'share', 'candc');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function checkNode() {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Node.js 24.x is required. Install it from https://nodejs.org/en/download and retry.');
}
export function parseOptions(args) {
  const options = {};
  const flags = new Set(['no-start', 'no-browser', 'help']);
  const values = new Set(['repo', 'version', 'install-dir', 'port', 'archive']);
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    if (args[i] === '-h') { options.help = true; continue; }
    if (!args[i].startsWith('--') || (!flags.has(key) && !values.has(key))) throw new Error(`Unknown option: ${args[i]}. Use --help.`);
    if (flags.has(key)) options[key] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}.`);
      options[key] = value;
    }
  }
  if (options.repo && !REPOSITORY.test(options.repo)) throw new Error('Use --repo OWNER/REPO, not a URL.');
  if (options.version && !VERSION.test(options.version)) throw new Error('Use --version vX.Y.Z (or an explicit prerelease).');
  if (options.port !== undefined) options.port = validPort(options.port);
  return options;
}
export function validPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CANDC_PORT; choose a port from 1 to 65535.');
  return port;
}
async function jsonFile(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw new Error(`Cannot read ${file}. Restore the file before retrying.`); }
}
export async function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
export async function withLock(root, operation) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, '.candc-operation.lock');
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Another CandC operation owns ${file}. Wait for it to finish. If it crashed, verify no installer/launcher is running before removing this lock.`);
    throw error;
  }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid })); return await operation(); }
  finally { await handle.close(); await rm(file); }
}
export async function runCommand(executable, args, { cwd, timeout = 120_000, log, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: log ? ['ignore', log, log] : 'inherit' });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // This child was created by this operation. Never infer ownership from a port.
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } }
    }, timeout);
    child.once('error', () => { clearTimeout(timer); reject(new Error(`Could not run ${path.basename(executable)}. Check that it is installed and available in this terminal.`)); });
    child.once('close', code => { clearTimeout(timer); if (timedOut) reject(new Error(`Command timed out after ${timeout / 1000}s. Retry after checking connectivity and the installation log.`)); else if (code === 0) resolve(); else reject(new Error(`Command failed (exit ${code}). Inspect the installation log and retry.`)); });
  });
}
export function npmCommand(args, options) {
  // Only fixed npm subcommands reach cmd.exe; paths are supplied as cwd, never shell text.
  if (!args.every(arg => /^[A-Za-z0-9:_=-]+$/.test(arg))) throw new Error('Invalid npm command.');
  return process.platform === 'win32'
    ? runCommand('cmd.exe', ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`], options)
    : runCommand('npm', args, options);
}
export async function download(url, limit = 64 * 1024 * 1024) {
  if (!url.startsWith('https://')) throw new Error('Downloads must use HTTPS.');
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { 'User-Agent': 'CandC-installer', Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}). Check the repository/version, network and GitHub rate limits, then retry.`);
  if (!response.url.startsWith('https://')) throw new Error('Download redirected outside HTTPS.');
  let length = 0; const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) throw new Error('Download exceeds the release size limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function verifyChecksum(bytes, sums, name) {
  const entries = sums.toString().split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?([^\s]+)$/.exec(line));
  const matches = entries.filter(entry => entry?.[2] === name);
  if (matches.length !== 1 || matches[0][1] !== sha256(bytes)) throw new Error(`Checksum mismatch for ${name}. Nothing was activated; download the release again.`);
}

// Release format: bounded ustar regular files only. Reject links and escaping paths before writing.
export function archiveEntries(archive) {
  const bytes = gunzipSync(archive, { maxOutputLength: 128 * 1024 * 1024 });
  const entries = [], names = new Set();
  const field = (header, start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (bytes.length - offset < 1024 || !bytes.subarray(offset).every(byte => byte === 0)) throw new Error('Invalid archive terminator.');
      return entries;
    }
    const checksumText = field(header, 148, 8).trim();
    const sum = header.reduce((total, byte, i) => total + (i >= 148 && i < 156 ? 32 : byte), 0);
    if (!/^[0-7]+$/.test(checksumText) || parseInt(checksumText, 8) !== sum || field(header, 257, 5) !== 'ustar') throw new Error('Invalid archive header.');
    const prefix = field(header, 345, 155);
    const name = (prefix ? `${prefix}/` : '') + field(header, 0, 100);
    const parts = name.split('/');
    if (!name || parts.some(part => !part || part === '.' || part === '..' || /[\\:<>"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) || names.has(name.toLowerCase())) throw new Error('Unsafe or duplicate archive path.');
    const allowed = /^(?:dist\/|web-dist\/|scripts\/|licenses\/)|^(?:package\.json|package-lock\.json|LICENSE|THIRD_PARTY_NOTICES\.md|CANDC_RELEASE\.json)$/;
    if (!allowed.test(name)) throw new Error('Unexpected file in runtime release.');
    const type = field(header, 156, 1);
    if (type !== '0' && type !== '') throw new Error('Release archives may contain regular files only; links are forbidden.');
    const sizeText = field(header, 124, 12).trim();
    if (!/^[0-7]+$/.test(sizeText)) throw new Error('Invalid archive size.');
    const size = parseInt(sizeText, 8);
    if (size > 16 * 1024 * 1024 || offset + 512 + size > bytes.length || entries.length >= 10_000) throw new Error('Archive exceeds its size limits.');
    names.add(name.toLowerCase()); entries.push({ name, bytes: bytes.subarray(offset + 512, offset + 512 + size) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('Truncated archive.');
}
export async function extractArchive(bytes, directory) {
  const entries = archiveEntries(bytes);
  for (const entry of entries) {
    const file = path.join(directory, ...entry.name.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, entry.bytes, { flag: 'wx', mode: 0o600 });
  }
}
export async function validateRelease(directory, version) {
  const manifest = await jsonFile(path.join(directory, 'CANDC_RELEASE.json'));
  const pkg = await jsonFile(path.join(directory, 'package.json'));
  if (!manifest || manifest.format !== 1 || manifest.version !== version || pkg?.version !== version.slice(1) || pkg.name !== 'candc') throw new Error('Release metadata/version mismatch.');
  for (const name of ['dist/main.js', 'dist/doctor.js', 'web-dist/index.html', 'scripts/install.mjs', 'package-lock.json']) {
    const stat = await lstat(path.join(directory, name));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Missing runtime file: ${name}.`);
  }
}
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; return true; }
}
export function listener(port) {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => done(true));
    socket.once('error', error => done(error.code !== 'ECONNREFUSED'));
    socket.setTimeout(750, () => done(true)); // Unknown network state must not authorize a replacement.
  });
}
export async function health(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_000), redirect: 'error' });
    if (!response.ok) return undefined;
    const text = await response.text();
    if (text.length > 16_384) return undefined;
    return JSON.parse(text);
  } catch { return undefined; }
}
const compatible = value => value?.application === 'candc' && value.phase === 2;
const runtimeFile = root => path.join(root, '.cache', 'server-runtime.json');
export async function runtimeStatus(root, port = 4317) {
  const running = await jsonFile(runtimeFile(root));
  const actualPort = validPort(running?.port ?? port);
  return { running, port: actualPort, health: await health(actualPort), occupied: await listener(actualPort) };
}
export async function assertStopped(root, port) {
  const status = await runtimeStatus(root, port);
  if (status.occupied || alive(status.running?.pid) || (port !== status.port && await listener(validPort(port)))) throw new Error(`CandC is running or the port is occupied. Run the Stop-CandC entry in ${root} first; wait for confirmed shutdown, then retry.`);
}
export async function openBrowser(url) {
  try {
    if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) throw new Error();
    if (process.platform === 'win32') await runCommand('rundll32.exe', ['url.dll,FileProtocolHandler', url], { timeout: 5_000 });
    else await runCommand(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { timeout: 5_000 });
  } catch { console.log(`Browser could not be opened. CandC is ready; open ${url} manually.`); }
}
export async function startServer(root, appRoot, { port = 4317, noBrowser = false, source = false, prepare } = {}) {
  const status = await runtimeStatus(root, port);
  const url = `http://127.0.0.1:${status.port}`;
  if (compatible(status.health)) {
    if (!source && status.health.instanceId !== status.running?.instanceId) throw new Error('The port belongs to another CandC installation. Stop that instance or choose another port.');
    console.log(`CandC is already running: ${url}`);
    if (!noBrowser) await openBrowser(url);
    return;
  }
  if (status.health) throw new Error('The port is used by another application or an older CandC. Close the old server first, or set CANDC_PORT.');
  if (status.occupied) throw new Error('The port is occupied, but its health check failed. Close the existing server first, or set CANDC_PORT.');
  if (alive(status.running?.pid)) throw new Error('The previous owned server has not exited. Confirm shutdown before starting another server.');
  if (prepare) await prepare();
  port = validPort(port);
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const out = await open(path.join(root, '.cache/server.log'), 'a', 0o600);
  const err = await open(path.join(root, '.cache/server-error.log'), 'a', 0o600);
  const instanceId = randomUUID();
  let child;
  try {
    child = spawn(process.execPath, [path.join(appRoot, 'dist/main.js')], { cwd: root, detached: true, windowsHide: true,
      stdio: ['ignore', out.fd, err.fd], env: { ...process.env, CANDC_PORT: String(port), CANDC_INSTANCE_ID: instanceId } });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new Error('Could not start Node.js. Check installation permissions.'))); });
    await atomicJson(runtimeFile(root), { pid: child.pid, port, instanceId });
    child.unref();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`CandC could not start. Inspect ${path.join(root, '.cache/server-error.log')}.`);
      const value = await health(port);
      if (value) {
        if (!compatible(value) || (!source && value.instanceId !== instanceId)) throw new Error('The port is not serving a compatible CandC instance. Inspect .cache/server-error.log.');
        console.log(`CandC ready: http://127.0.0.1:${port}`);
        if (!noBrowser) await openBrowser(`http://127.0.0.1:${port}`);
        return;
      }
      await sleep(200);
    }
    throw new Error(`CandC startup timed out. Inspect ${path.join(root, '.cache/server-error.log')}; run status before retrying.`);
  } catch (error) {
    // Only this newly-created child may be terminated on a failed start.
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    throw error;
  } finally { await out.close(); await err.close(); }
}
export async function stopServer(root, { port = 4317, source = false } = {}) {
  const status = await runtimeStatus(root, port);
  const url = `http://127.0.0.1:${status.port}`;
  if (!status.health) {
    if (status.occupied || alive(status.running?.pid)) throw new Error('The port is still occupied or the server is still alive, but its health check failed. CandC shutdown was not confirmed. No process was killed.');
    await rm(runtimeFile(root), { force: true });
    console.log(`CandC is already stopped: ${url}`); return;
  }
  if (!compatible(status.health) || (!source && status.health.instanceId !== status.running?.instanceId)) throw new Error('This port is not a compatible CandC instance owned by this installation.');
  const session = await fetch(`${url}/api/session`, { signal: AbortSignal.timeout(2_000), redirect: 'error' });
  const cookie = session.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  if (!session.ok || !cookie) throw new Error('Could not obtain a shutdown session. Run status and retry.');
  const response = await fetch(`${url}/api/shutdown`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}', redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('Shutdown was rejected. Run status and retry.');
  const deadline = Date.now() + 12_000;
  do {
    if (!await listener(status.port) && !alive(status.running?.pid)) {
      await rm(runtimeFile(root), { force: true });
      console.log('CandC stopped. Active AI turns are cancelled; history is preserved.'); return;
    }
    await sleep(200);
  } while (Date.now() < deadline);
  throw new Error('CandC did not stop within the expected timeout. No other process was killed. Run status and inspect the server log.');
}

async function loadConfig(root) {
  const config = await jsonFile(path.join(root, 'installation.json'));
  if (!config || config.format !== 1 || !VERSION.test(config.version) || !/^v/.test(config.version) || !/^v[0-9A-Za-z.-]+-[0-9a-f-]{36}$/.test(config.release)) throw new Error('Invalid installation record. Re-run the installer with the same --install-dir.');
  validPort(config.port);
  if (config.repo !== null && !REPOSITORY.test(config.repo)) throw new Error('Invalid installation repository.');
  return config;
}
export async function writeEntrypoints(root) {
  const bin = path.join(root, 'bin'); await mkdir(bin, { recursive: true });
  const stub = `import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const config = JSON.parse(await readFile(path.join(root, 'installation.json'), 'utf8'));
  if (!/^v[0-9A-Za-z.-]+-[0-9a-f-]{36}$/.test(config.release)) throw new Error('Invalid installation record.');
  const { manage } = await import(pathToFileURL(path.join(root, 'releases', config.release, 'scripts/install.mjs')).href);
  await manage(root, process.argv.slice(2));
} catch (error) { console.error('CandC: ' + error.message); process.exitCode = 1; }
`;
  await writeFile(path.join(bin, 'candc.mjs'), stub);
  if (process.platform === 'win32') {
    await writeFile(path.join(bin, 'candc.cmd'), '@echo off\r\nnode "%~dp0candc.mjs" %*\r\nexit /b %errorlevel%\r\n');
    for (const action of ['Start', 'Stop']) await writeFile(path.join(root, `${action}-CandC.cmd`), `@echo off\r\ncall "%~dp0bin\\candc.cmd" ${action.toLowerCase()} %*\r\nif errorlevel 1 pause\r\n`);
  } else {
    await writeFile(path.join(bin, 'candc'), '#!/bin/sh\nset -eu\nexec node "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/candc.mjs" "$@"\n');
    await chmod(path.join(bin, 'candc'), 0o700);
    for (const action of ['Start', 'Stop']) {
      const file = path.join(root, `${action}-CandC.${process.platform === 'darwin' ? 'command' : 'sh'}`);
      await writeFile(file, `#!/bin/sh\nset -eu\nexec "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/bin/candc" ${action.toLowerCase()} "$@"\n`);
      await chmod(file, 0o700);
    }
  }
}
export function printCommands(root) {
  const command = path.join(root, 'bin', process.platform === 'win32' ? 'candc.cmd' : 'candc');
  const quoted = process.platform === 'win32' ? `& '${command.replaceAll("'", "''")}'` : `'${command.replaceAll("'", "'\\''")}'`;
  console.log(`Installation: ${root}\nHistory: ${path.resolve(root, process.env.CANDC_DATA_DIR ?? 'data')}\nPATH was not changed.`);
  for (const action of ['start', 'stop', 'status', 'update', 'doctor']) console.log(`  ${quoted} ${action}`);
}
export async function install(options, dependencies = {}) {
  checkNode();
  const root = path.resolve(options['install-dir'] ?? defaultInstallDir());
  if (root === path.parse(root).root) throw new Error('Choose a user-owned installation directory, not a filesystem root.');
  const fetchBytes = dependencies.download ?? download;
  const installDependencies = dependencies.installDependencies ?? (async directory => {
    const logPath = path.join(root, '.cache/install.log');
    const log = await open(logPath, 'a', 0o600);
    try { await npmCommand(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory, timeout: 180_000, log: log.fd,
      env: { ...process.env, npm_config_cache: path.join(root, '.cache/npm') } }); }
    catch { throw new Error(`Dependency installation failed or timed out. Check npm/network access; inspect ${logPath}, then retry the same installer command.`); }
    finally { await log.close(); }
  });
  await withLock(root, async () => {
    const previous = await jsonFile(path.join(root, 'installation.json'));
    if (previous) await loadConfig(root);
    else {
      const marker = await jsonFile(path.join(root, '.candc-managed.json'));
      if (marker?.format !== 1 && (await readdir(root)).some(name => name !== '.candc-operation.lock')) throw new Error('Installation directory is not empty and is not a managed CandC installation. Choose another --install-dir.');
      if (!marker) await atomicJson(path.join(root, '.candc-managed.json'), { format: 1 });
    }
    const port = validPort(options.port ?? process.env.CANDC_PORT ?? previous?.port ?? 4317);
    console.log('[1/5] Checking environment and stopped state...');
    await assertStopped(root, previous?.port ?? port);
    if (previous?.port !== port) await assertStopped(root, port);
    await mkdir(path.join(root, '.cache'), { recursive: true });
    const stage = await mkdtemp(path.join(root, '.cache', 'install-'));
    let activated = false, destination;
    try {
      const repo = options.repo ?? previous?.repo ?? null;
      if (repo !== null && !REPOSITORY.test(repo)) throw new Error('Use --repo OWNER/REPO.');
      let version = options.version;
      if (version) { if (!VERSION.test(version)) throw new Error('Invalid release version.'); version = version.startsWith('v') ? version : `v${version}`; }
      let archive, sums, name;
      console.log('[2/5] Downloading a fixed release...');
      if (options.archive) {
        name = path.basename(options.archive);
        const match = /^candc-(v[0-9A-Za-z.-]+)\.tar\.gz$/.exec(name);
        if (!match || !VERSION.test(match[1]) || version && version !== match[1]) throw new Error('Local archive name/version mismatch; use candc-vX.Y.Z.tar.gz.');
        version = match[1];
        archive = await readFile(options.archive); sums = await readFile(path.join(path.dirname(options.archive), 'SHA256SUMS'));
      } else {
        if (!repo) throw new Error('Supply --repo OWNER/REPO. The project has no hard-coded publishing repository.');
        if (!version) {
          const release = JSON.parse((await fetchBytes(`https://api.github.com/repos/${repo}/releases/latest`, 1024 * 1024)).toString());
          if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw new Error('No supported stable GitHub Release was found. Specify --version for a prerelease.');
          version = release.tag_name;
        }
        name = `candc-${version}.tar.gz`;
        const base = `https://github.com/${repo}/releases/download/${version}`;
        [archive, sums] = await Promise.all([fetchBytes(`${base}/${name}`), fetchBytes(`${base}/SHA256SUMS`, 1024 * 1024)]);
      }
      console.log('[3/5] Verifying and extracting release...');
      verifyChecksum(archive, sums, name);
      const app = path.join(stage, 'app'); await mkdir(app);
      await extractArchive(archive, app); await validateRelease(app, version);
      console.log('[4/5] Installing locked runtime dependencies (up to 180s)...');
      await installDependencies(app);
      await validateRelease(app, version);
      // Unique immutable directories also make re-installing the same version safe.
      const release = `${version}-${randomUUID()}`;
      await mkdir(path.join(root, 'releases'), { recursive: true });
      destination = path.join(root, 'releases', release); await rename(app, destination);
      await writeEntrypoints(root);
      await atomicJson(path.join(root, 'installation.json'), { format: 1, repo, version, release, port, previousRelease: previous?.release ?? null });
      activated = true;
      console.log(`[5/5] Installed ${version}.`);
      printCommands(root);
      if (!options['no-start']) await startServer(root, destination, { port, noBrowser: Boolean(options['no-browser']) });
    } finally {
      await rm(stage, { recursive: true, force: true, maxRetries: 3 });
      if (!activated && destination) await rm(destination, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}
export async function manage(root, args) {
  if (!args.length || ['--help', '-h', 'help'].includes(args[0])) {
    console.log('CandC: start [--no-browser] [--port PORT] | stop | status | update [--version vX.Y.Z] [--no-start] [--no-browser] | doctor'); return;
  }
  checkNode();
  const [command, ...rest] = args;
  const options = parseOptions(rest);
  if (options.help) { console.log('Use start, stop, status, update or doctor. Update requires a stopped server; --no-start and --no-browser are supported.'); return; }
  const config = await loadConfig(root);
  const app = path.join(root, 'releases', config.release);
  const port = validPort(options.port ?? process.env.CANDC_PORT ?? config.port);
  if (command === 'update') return install({ ...options, 'install-dir': root });
  if (command === 'status') {
    const status = await runtimeStatus(root, port);
    const owned = compatible(status.health) && status.health.instanceId === status.running?.instanceId;
    console.log(`Version: ${config.version}\nState: ${owned ? 'running' : status.occupied || alive(status.running?.pid) ? 'occupied or unconfirmed' : 'stopped'}\nURL: http://127.0.0.1:${status.port}`);
    printCommands(root); if (!owned && (status.occupied || alive(status.running?.pid))) process.exitCode = 1;
    return;
  }
  if (command === 'doctor') {
    await validateRelease(app, config.version);
    console.log('Runtime files: complete. Demo needs no AI CLI/login. Checking optional provider readiness (no inference)...');
    return runCommand(process.execPath, [path.join(app, 'dist/doctor.js')], { cwd: root, timeout: 30_000 });
  }
  if (command === 'start') return withLock(root, () => startServer(root, app, { port, noBrowser: Boolean(options['no-browser']) }));
  if (command === 'stop') return withLock(root, () => stopServer(root, { port }));
  throw new Error('Unknown command. Use --help.');
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { const options = parseOptions(process.argv.slice(2)); if (options.help) console.log(INSTALL_HELP); else await install(options); }
  catch (error) { console.error(`CandC: ${error.message}`); process.exitCode = 1; }
}
