import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-expect-error Standalone installation helpers ship without TS declarations.
import { install, sha256, archiveEntries, extractArchive, parseOptions, withLock, runtimeStatus, startServer, stopServer, manage, atomicJson } from '../scripts/install.mjs';
// @ts-expect-error Release helpers are standalone Node modules.
import { makeArchive, packageRelease } from '../scripts/package-release.mjs';
import { gzipSync, gunzipSync } from 'node:zlib';

const roots: string[] = [];
async function workspace() {
  const root = await mkdtemp(path.resolve('.cache/install-test-'));
  roots.push(root); return root;
}
async function freePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port.');
  await new Promise<void>(resolve => server.close(() => resolve())); return address.port;
}
const main = `import http from 'node:http';
const server = http.createServer((request, response) => {
 response.setHeader('Content-Type', 'application/json');
 if(request.url==='/health') response.end(JSON.stringify({application:'candc',phase:2,instanceId:process.env.CANDC_INSTANCE_ID}));
 else if(request.url==='/api/session') { response.setHeader('Set-Cookie','fixture=session; Path=/'); response.end('{}'); }
 else if(request.url==='/api/shutdown' && request.method==='POST' && request.headers.cookie==='fixture=session') { response.end('{}'); server.close(); }
 else response.writeHead(403).end('{}');
}); server.listen(Number(process.env.CANDC_PORT), '127.0.0.1');`;
async function release(version = 'v0.1.0') {
  return makeArchive([
    { name: 'package.json', bytes: Buffer.from(JSON.stringify({ name: 'candc', version: version.slice(1), type: 'module' })) },
    { name: 'package-lock.json', bytes: Buffer.from('{}') },
    { name: 'CANDC_RELEASE.json', bytes: Buffer.from(JSON.stringify({ format: 1, version })) },
    { name: 'dist/main.js', bytes: Buffer.from(main) },
    { name: 'dist/doctor.js', bytes: Buffer.from('console.log("fixture diagnostic: no authentication")') },
    { name: 'web-dist/index.html', bytes: Buffer.from('<html>fixture</html>') },
    { name: 'scripts/install.mjs', bytes: await readFile('scripts/install.mjs') },
  ]);
}
function transport(archive: Buffer, version = 'v0.1.0', corrupt = false) {
  const name = `candc-${version}.tar.gz`;
  const download = vi.fn(async (url: string) => {
    if (url.endsWith('/latest')) return Buffer.from(JSON.stringify({ tag_name: version, draft: false, prerelease: false }));
    if (url.endsWith('/SHA256SUMS')) return Buffer.from(`${corrupt ? '0'.repeat(64) : sha256(archive)}  ${name}\n`);
    if (url.endsWith(`/${name}`)) return archive;
    throw new Error('Unexpected download.');
  });
  return { download, installDependencies: vi.fn(async () => {}) };
}
async function record(root: string) { return JSON.parse(await readFile(path.join(root, 'installation.json'), 'utf8')); }
async function invoke(root: string, args: string[], cwd: string) {
  return new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'bin/candc.mjs'), ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Entry timed out.')); }, 30_000);
    child.once('error', reject); child.once('close', code => { clearTimeout(timer); resolve({ code: code ?? 1, output }); });
  });
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    // Stop only HTTP fixtures whose nonces were created in these owned temporary roots.
    for (const directory of [root, path.join(root, '安裝 with spaces')]) {
      try { const state = await runtimeStatus(directory); if (state.running && state.health?.instanceId === state.running.instanceId) await stopServer(directory); } catch { /* No fixture server. */ }
    }
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  vi.restoreAllMocks();
});

describe('managed installation, without source or PATH changes', () => {
  it('pins latest downloads, supports outside-cwd commands, preserves data across updates, and never rebuilds on start', async () => {
    const parent = await workspace(), root = path.join(parent, '安裝 with spaces'), port = await freePort();
    const dependencies = transport(await release());
    const originalPath = process.env.PATH;
    await install({ repo: 'fixture/candc', 'install-dir': root, port, 'no-start': true }, dependencies);
    expect(dependencies.download.mock.calls.map(([url]: [string]) => url)).toEqual([
      'https://api.github.com/repos/fixture/candc/releases/latest',
      'https://github.com/fixture/candc/releases/download/v0.1.0/candc-v0.1.0.tar.gz',
      'https://github.com/fixture/candc/releases/download/v0.1.0/SHA256SUMS',
    ]);
    expect(process.env.PATH).toBe(originalPath);
    await mkdir(path.join(root, 'data')); await writeFile(path.join(root, 'data/history.jsonl'), 'saved fixture');
    await mkdir(path.join(root, '.cache/agents/rooms'), { recursive: true }); await writeFile(path.join(root, '.cache/agents/rooms/session.txt'), 'owned fixture');
    const first = await record(root);
    expect((await invoke(root, ['start', '--no-browser'], parent)).code).toBe(0);
    expect((await invoke(root, ['start', '--no-browser'], parent)).output).toContain('already running');
    const next = transport(await release('v0.1.1'), 'v0.1.1');
    await expect(install({ 'install-dir': root, 'no-start': true }, next)).rejects.toThrow('Stop-CandC');
    expect(next.download).not.toHaveBeenCalled();
    expect((await invoke(root, ['stop'], parent)).code).toBe(0);
    expect((await invoke(root, ['stop'], parent)).output).toContain('already stopped');
    await install({ 'install-dir': root, 'no-start': true }, next);
    expect((await record(root)).previousRelease).toBe(first.release);
    expect(await readFile(path.join(root, 'data/history.jsonl'), 'utf8')).toBe('saved fixture');
    expect(await readFile(path.join(root, '.cache/agents/rooms/session.txt'), 'utf8')).toBe('owned fixture');
    await access(path.join(root, 'releases', first.release));
    expect((await invoke(root, ['doctor'], parent)).output).toContain('no authentication');
    expect((await invoke(root, ['start', '--no-browser'], parent)).code).toBe(0);
    expect((await invoke(root, ['stop'], parent)).code).toBe(0);
    expect(dependencies.installDependencies).toHaveBeenCalledTimes(1);
  }, 30_000);
  it('keeps the current version on checksum/download/dependency failure and can retry a failed first installation', async () => {
    const root = await workspace(), port = await freePort(), archive = await release();
    const options = { repo: 'fixture/candc', 'install-dir': root, port, 'no-start': true };
    await expect(install(options, transport(archive, 'v0.1.0', true))).rejects.toThrow('Checksum');
    await expect(access(path.join(root, 'installation.json'))).rejects.toThrow();
    await install(options, transport(archive));
    const before = await record(root);
    const failing = transport(await release('v0.1.1'), 'v0.1.1');
    failing.installDependencies.mockRejectedValueOnce(new Error('Dependency fixture failure.'));
    await expect(install(options, failing)).rejects.toThrow('Dependency fixture');
    expect(await record(root)).toEqual(before);
    failing.download.mockRejectedValueOnce(new Error('Download fixture failure.'));
    await expect(install(options, failing)).rejects.toThrow('Download fixture');
    expect(await record(root)).toEqual(before);
  });
  it('rejects nonempty unmanaged targets and concurrent operations', async () => {
    const root = await workspace();
    await writeFile(path.join(root, 'existing.txt'), 'preserve me');
    await expect(install({ repo: 'fixture/candc', 'install-dir': root, 'no-start': true }, transport(await release()))).rejects.toThrow('not empty');
    expect(await readFile(path.join(root, 'existing.txt'), 'utf8')).toBe('preserve me');
    await withLock(root, async () => { await expect(withLock(root, async () => {})).rejects.toThrow('Another CandC operation'); });
  });
  it('uses the saved running port when the environment changes and refuses another installation on the port', async () => {
    const root = await workspace(), port = await freePort();
    await install({ repo: 'fixture/candc', 'install-dir': root, port, 'no-start': true }, transport(await release()));
    const config = await record(root), app = path.join(root, 'releases', config.release);
    await startServer(root, app, { port, noBrowser: true });
    const running = (await runtimeStatus(root)).running;
    await atomicJson(path.join(root, '.cache/server-runtime.json'), { ...running, instanceId: 'another-instance' });
    await expect(stopServer(root, { port })).rejects.toThrow('owned by this installation');
    await expect(startServer(root, app, { port, noBrowser: true })).rejects.toThrow('another CandC');
    await atomicJson(path.join(root, '.cache/server-runtime.json'), running);
    await stopServer(root, { port: await freePort() });
  }, 15_000);
  it('supports verified local packages and refuses malformed command values', async () => {
    const parent = await workspace(), root = path.join(parent, '安裝 with spaces'), archive = await release();
    const file = path.join(parent, 'candc-v0.1.0.tar.gz');
    await writeFile(file, archive); await writeFile(path.join(parent, 'SHA256SUMS'), `${sha256(archive)}  candc-v0.1.0.tar.gz\n`);
    await install({ archive: file, 'install-dir': root, port: await freePort(), 'no-start': true }, { installDependencies: async () => {} });
    expect((await record(root)).version).toBe('v0.1.0');
    expect(() => parseOptions(['--version', '../escape'])).toThrow();
    expect(() => parseOptions(['--repo', 'https://example.com'])).toThrow();
    expect(() => parseOptions(['--port', '0'])).toThrow();
    expect(() => parseOptions(['--install-dir'])).toThrow();
    expect(() => parseOptions(['--unknown'])).toThrow();
    expect(() => parseOptions(['--port', '4317.1'])).toThrow();
    await expect(manage(root, ['update', '--no-start'])).rejects.toThrow('Supply --repo');
  });
});

describe('release extraction boundaries', () => {
  it.each(['history.jsonl', '.env'])('refuses stale private build output: %s', async file => {
    const root = await workspace();
    await mkdir(path.join(root, 'dist')); await mkdir(path.join(root, 'web-dist'));
    await writeFile(path.join(root, 'dist/main.js'), 'export {};');
    await writeFile(path.join(root, 'web-dist', file), 'private fixture');
    await expect(packageRelease({ build: root, output: path.join(root, 'output') })).rejects.toThrow('Unexpected/private build artifact');
    await expect(access(path.join(root, 'output'))).rejects.toThrow();
  });
  it.each(['../escape', '/absolute', 'dist/../escape', 'dist/back\\slash', 'dist/C:stream', 'dist/CON', 'dist/name.', 'dist/name ', 'data/private.json'])('rejects escaping or private archive entry %s before writing', async name => {
    const root = await workspace();
    const archive = makeArchive([{ name, bytes: Buffer.from('fixture') }]);
    await expect(extractArchive(archive, root)).rejects.toThrow();
  });
  it('rejects duplicate paths, links, corrupted headers and truncated data', async () => {
    const entry = { name: 'dist/main.js', bytes: Buffer.from('fixture') };
    expect(() => archiveEntries(makeArchive([entry, entry]))).toThrow('duplicate');
    const raw = gunzipSync(makeArchive([entry]));
    raw[156] = '2'.charCodeAt(0); raw.fill(32, 148, 156);
    raw.write(raw.subarray(0, 512).reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8);
    expect(() => archiveEntries(gzipSync(raw))).toThrow('links');
    raw[0] = 0;
    expect(() => archiveEntries(gzipSync(raw))).toThrow('header');
    expect(() => archiveEntries(gzipSync(Buffer.alloc(300)))).toThrow('Truncated');
  });
});

describe('one-line release entrypoints', () => {
  async function candidate(corrupt = false) {
    const root = await workspace();
    await mkdir(path.join(root, 'dist')); await mkdir(path.join(root, 'web-dist'));
    await writeFile(path.join(root, 'dist/main.js'), 'export {};');
    await writeFile(path.join(root, 'web-dist/index.html'), '<html>fixture</html>');
    const output = await packageRelease({ build: root, output: path.join(root, 'release'), repo: 'fixture/candc' });
    const loader = path.join(root, 'fetch-fixture.mjs');
    // Only the standalone entrypoint executes: no network, npm, providers or real app.
    await writeFile(loader, `import { createHash } from 'node:crypto';
const script = Buffer.from('console.log("CANDC_ARGS:" + Buffer.from(JSON.stringify(process.argv.slice(2))).toString("base64"))');
globalThis.fetch = async url => {
 console.log('CANDC_FETCH:' + url);
 const bytes = url.endsWith('/latest') ? Buffer.from(JSON.stringify({tag_name:'v0.1.0',draft:false,prerelease:false}))
 : url.endsWith('/install.mjs') ? script
 : url.endsWith('/SHA256SUMS') ? Buffer.from('${corrupt ? '0'.repeat(64) : ''}' || createHash('sha256').update(script).digest('hex'))
 : null;
 if (!bytes) throw new Error('Unexpected fixture URL');
 const body = url.endsWith('/SHA256SUMS') ? Buffer.from(bytes.toString() + '  install.mjs\\n') : bytes;
 return {ok:true,url,status:200,body:(async function*(){yield body;})()};
};`);
    return { root, output, loader };
  }
  async function runInput(command: string, args: string[], source: string, fixture: Awaited<ReturnType<typeof candidate>>) {
    return new Promise<{ code: number; output: string }>((resolve, reject) => {
      const child = spawn(command, args, { cwd: fixture.root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_OPTIONS: `--import="${pathToFileURL(fixture.loader).href}"` } });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Piped installer timed out.')); }, 15_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); resolve({ code: code ?? 1, output }); });
      child.stdin.end(source);
    });
  }
  function expectDownload(result: { code: number; output: string }, extra: string[] = []) {
    expect(result.code).toBe(0);
    expect(result.output).toContain('CANDC_FETCH:https://api.github.com/repos/fixture/candc/releases/latest');
    expect(result.output).toContain('CANDC_FETCH:https://github.com/fixture/candc/releases/download/v0.1.0/install.mjs');
    const encoded = result.output.match(/CANDC_ARGS:([A-Za-z0-9+/=]+)/)?.[1];
    expect(encoded).toBeDefined();
    expect(JSON.parse(Buffer.from(encoded!, 'base64').toString())).toEqual([...extra, '--repo', 'fixture/candc', '--version', 'v0.1.0']);
  }
  it.skipIf(process.platform === 'win32')('runs a downloaded shell script from stdin and forwards quoted options', async () => {
    const fixture = await candidate();
    const source = await readFile(path.join(fixture.output, 'install.sh'), 'utf8');
    expect(source).not.toContain('\r'); expect(source).not.toContain('__CANDC_BOOTSTRAP__');
    expectDownload(await runInput('sh', ['-s', '--'], source, fixture));
    const extra = ['--install-dir', path.join(fixture.root, '安裝 with spaces'), '--no-start'];
    expectDownload(await runInput('sh', ['-s', '--', ...extra], source, fixture), extra);
  }, 30_000);
  it.skipIf(process.platform !== 'win32')('pipes a downloaded script to iex and returns to the caller without changing its error preference', async () => {
    const fixture = await candidate();
    const source = await readFile(path.join(fixture.output, 'install.ps1'), 'utf8');
    const command = "$candcSource = [Console]::In.ReadToEnd(); $ErrorActionPreference = 'Continue'; $candcSource | iex; if ($ErrorActionPreference -ne 'Continue') { throw 'Caller preference changed' }; Write-Output 'CANDC_RETURNED'";
    const result = await runInput('powershell.exe', ['-NoProfile', '-Command', command], source, fixture);
    expectDownload(result); expect(result.output).toContain('CANDC_RETURNED');
  }, 30_000);
  it.skipIf(process.platform !== 'win32')('forwards PowerShell options including a Unicode path with spaces', async () => {
    const fixture = await candidate();
    const source = await readFile(path.join(fixture.output, 'install.ps1'), 'utf8');
    const directory = path.join(fixture.root, '安裝 with spaces');
    const command = `$candcSource = [Console]::In.ReadToEnd(); & ([scriptblock]::Create($candcSource)) -NoStart -InstallDir '${directory.replaceAll("'", "''")}'`;
    expectDownload(await runInput('powershell.exe', ['-NoProfile', '-Command', command], source, fixture), ['--install-dir', directory, '--no-start']);
  }, 30_000);
  it('rejects a corrupted downloaded installer before executing it', async () => {
    const fixture = await candidate(true);
    const windows = process.platform === 'win32';
    const source = await readFile(path.join(fixture.output, windows ? 'install.ps1' : 'install.sh'), 'utf8');
    const result = await runInput(windows ? 'powershell.exe' : 'sh', windows
      ? ['-NoProfile', '-Command', "$candcSource = [Console]::In.ReadToEnd(); try { $candcSource | iex; Write-Output 'CANDC_UNEXPECTED_SUCCESS' } catch { Write-Output 'CANDC_FAILED'; exit 1 }"] : ['-s', '--'], source, fixture);
    expect(result.code).not.toBe(0);
    expect(result.output).not.toContain('CANDC_ARGS:');
    expect(result.output).not.toContain('CANDC_UNEXPECTED_SUCCESS');
    expect(result.output).toContain('checksum mismatch');
  }, 30_000);
});
