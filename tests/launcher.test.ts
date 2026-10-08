import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const scripts = path.resolve('scripts');
const healthy = { application: 'candc', phase: 2 };

async function fixture(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port.');
  return {
    server, port: address.port,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

async function run(script: 'start' | 'stop', port: number, root?: string): Promise<{ code: number; output: string }> {
  if (!root) {
    await mkdir('.cache', { recursive: true });
    const isolatedRoot = await mkdtemp(path.resolve('.cache/launcher-test-'));
    try {
      await mkdir(path.join(isolatedRoot, 'scripts'));
      for (const file of ['start.ps1', 'stop.ps1', 'launcher.mjs', 'install.mjs'])
        await copyFile(path.join(scripts, file), path.join(isolatedRoot, 'scripts', file));
      return await run(script, port, isolatedRoot);
    } finally { await rm(isolatedRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  }
  return new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(root ? path.join(root, 'scripts') : scripts, `${script}.ps1`),
      ...(script === 'start' ? ['-NoBrowser'] : [])], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CANDC_PORT: String(port), ...(root ? { PATH: `${root};${process.env.PATH}` } : {}) },
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    const deadline = setTimeout(() => { child.kill(); reject(new Error(`Launcher timed out: ${output}`)); }, 30_000);
    child.on('error', error => { clearTimeout(deadline); reject(error); });
    child.on('exit', code => {
      clearTimeout(deadline);
      child.stdout.destroy(); child.stderr.destroy();
      resolve({ code: code ?? 1, output });
    });
  });
}

describe.skipIf(process.platform !== 'win32')('Windows start/stop launchers with disposable HTTP fixtures', () => {
  it('repeated stop succeeds when no listener exists', async () => {
    const app = await fixture((_request, response) => response.end());
    await app.close();
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await run('stop', app.port);
      expect(result.code).toBe(0);
      expect(result.output).toContain('CandC is already stopped:');
    }
  }, 15_000);

  it.each(['start', 'stop'] as const)('%s refuses an incompatible application without sending shutdown', async script => {
    const requests: string[] = [];
    const app = await fixture((request, response) => {
      requests.push(request.url ?? '');
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ application: 'other', phase: 2 }));
    });
    try {
      expect((await run(script, app.port)).code).not.toBe(0);
      expect(requests).toEqual(['/health']);
    } finally { await app.close(); }
  }, 10_000);

  it.each(['start', 'stop'] as const)('%s reports an occupied unresponsive port as an error', async script => {
    const requests: string[] = [];
    const app = await fixture(request => { requests.push(request.url ?? ''); });
    try {
      const result = await run(script, app.port);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('health check failed');
      expect(result.output).not.toContain('CandC is already stopped:');
      expect(requests).toEqual(['/health']);
    } finally { await app.close(); }
  }, 10_000);

  it('repeated start reuses a compatible running instance', async () => {
    const app = await fixture((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(healthy));
    });
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await run('start', app.port);
        expect(result.code).toBe(0);
        expect(result.output).toContain('CandC is already running:');
      }
    } finally { await app.close(); }
  }, 10_000);

  it('does not confirm shutdown when health stops responding but the listener remains', async () => {
    let stopping = false;
    const app = await fixture((request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/health') {
        if (!stopping) response.end(JSON.stringify(healthy));
      } else if (request.url === '/api/session') {
        response.setHeader('Set-Cookie', 'fixture=session; Path=/'); response.end('{}');
      } else if (request.url === '/api/shutdown') {
        stopping = true; response.end('{}');
      } else { response.writeHead(404).end(); }
    });
    try {
      const result = await run('stop', app.port);
      expect(stopping).toBe(true);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('CandC did not stop within the expected timeout');
      expect(result.output).not.toContain('CandC stopped.');
    } finally { await app.close(); }
  }, 25_000);

  it.each([2, 1])('validates phase %s on a newly launched fixture and supports stop/start cycles', async phase => {
    const reservation = await fixture((_request, response) => response.end());
    const port = reservation.port;
    await reservation.close();
    await mkdir('.cache', { recursive: true });
    const root = await mkdtemp(path.resolve('.cache/launcher-test-'));
    try {
      await mkdir(path.join(root, 'scripts'));
      await mkdir(path.join(root, 'node_modules'));
      await mkdir(path.join(root, 'dist'));
      for (const file of ['start.ps1', 'stop.ps1', 'launcher-common.ps1', 'launcher.mjs', 'install.mjs']) {
        await copyFile(path.join(scripts, file), path.join(root, 'scripts', file));
      }
      // Stub only the build; the launcher owns a real disposable Node HTTP process.
      await writeFile(path.join(root, 'npm.cmd'), '@echo off\r\nexit /b 0\r\n');
      await writeFile(path.join(root, 'dist/main.js'), `
        import http from 'node:http';
        import { writeFileSync } from 'node:fs';
        writeFileSync('fixture.pid', String(process.pid));
        const server = http.createServer((request, response) => {
          response.setHeader('Content-Type', 'application/json');
          if (request.url === '/health') response.end(JSON.stringify({ application: 'candc', phase: ${phase} }));
          else if (request.url === '/api/session') {
            response.setHeader('Set-Cookie', 'fixture=session; Path=/'); response.end('{}');
          } else if (request.url === '/api/shutdown' && request.method === 'POST' && request.headers.cookie === 'fixture=session') {
            response.end('{}'); server.close();
          } else response.writeHead(403).end('{}');
        });
        server.listen(Number(process.env.CANDC_PORT), '127.0.0.1');
      `);
      const started = await run('start', port, root);
      if (phase !== 2) {
        expect(started.code).not.toBe(0);
        expect(started.output).toContain('not serving a compatible CandC instance');
        expect(started.output).not.toContain('CandC ready:');
      } else {
        expect(started.code, started.output).toBe(0);
        expect(started.output).toContain('CandC ready:');
        expect((await run('stop', port, root)).output).toContain('CandC stopped.');
        expect((await run('stop', port, root)).code).toBe(0);
        expect((await run('start', port, root)).code).toBe(0);
        expect((await run('stop', port, root)).code).toBe(0);
      }
    } finally {
      // This PID comes exclusively from the child created in this test directory.
      try { process.kill(Number(await readFile(path.join(root, 'fixture.pid'), 'utf8'))); }
      catch (error) { if (!['ESRCH', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 40_000);
});
