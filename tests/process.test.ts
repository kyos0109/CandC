import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { JsonLineProcess, RpcConnection, RpcRejectionError, type JsonConnection } from '../src/adapters/process.js';

const fixture = path.resolve('tests/fixtures/process.mjs');
const connection = (scenario: string, signal = new AbortController().signal) => new JsonLineProcess({
  executable: process.execPath, args: [fixture, scenario], cwd: process.cwd(),
  signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
});

describe('owned local fixture processes', () => {
  it.skipIf(process.platform === 'win32').each(['tree', 'orphan'])('cleans the POSIX group including descendants: %s', async scenario => {
    const abort = new AbortController();
    const child = new JsonLineProcess({ executable: process.execPath, args: [fixture, scenario], cwd: process.cwd(), signal: abort.signal });
    let pid: number | undefined;
    try {
      const ready = await child.next() as { ready: boolean; descendant: number }; pid = ready.descendant;
      expect(ready.ready).toBe(true);
      if (scenario === 'orphan') await new Promise(resolve => setTimeout(resolve, 100)); else abort.abort();
      await child.close();
      let running = true;
      const deadline = Date.now() + 2_000;
      do {
        try {
          process.kill(pid, 0);
          // Linux can retain a dead orphan as a zombie until its reaper runs.
          if (process.platform === 'linux') running = !/\) Z /.test(await readFile(`/proc/${pid}/stat`, 'utf8'));
        } catch (error) { if (['ESRCH', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) running = false; else throw error; }
        if (running) await new Promise(resolve => setTimeout(resolve, 25));
      } while (running && Date.now() < deadline);
      expect(running).toBe(false);
    } finally {
      if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already exited. */ } }
      await child.close();
    }
  }, 8_000);
  it.each([
    { code: 'private-code', message: 'private provider prompt', data: { token: 'private-token' } },
    { code: 1.5, message: 'thread 00000000-0000-4000-8000-000000000001 already has an active writer secret=private-token' },
    { code: Number.MAX_SAFE_INTEGER + 1, message: 'private provider prompt' },
    'private-provider-text',
  ])('does not persist unrecognized RPC error contents: %#', async error => {
    const transport: JsonConnection = { send() {}, endInput() {}, async finish() {}, async close() {},
      async next() { return { id: 1, error }; } };
    const rejected = await new RpcConnection(transport).request('private-method', {}).catch(error => error);
    expect(rejected).toBeInstanceOf(RpcRejectionError);
    if (!(rejected instanceof RpcRejectionError)) throw new Error('Expected an RPC rejection.');
    expect(rejected.diagnostic).toEqual({ provider: 'codex', method: 'other', reason: 'rejected' });
    expect(rejected.message).toBe('App-server rejected other.');
    expect(JSON.stringify(rejected)).not.toContain('private');
  });
  it('bounds queued bytes independently of the record count and settles the owned process', async () => {
    const process = connection('flood');
    try {
      expect(await process.next()).toEqual({ ready: true });
      process.endInput('go');
      await expect(process.finish()).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
      await expect(process.next()).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
    } finally { await process.close(); }
  });
  it('bounds RPC notifications while awaiting a response', async () => {
    let count = 0;
    const transport: JsonConnection = {
      send() {}, endInput() {}, async finish() {}, async close() {},
      async next() { count++; return { method: 'fixture/update', params: 'x'.repeat(1024 * 1024) }; },
    };
    const rpc = new RpcConnection(transport);
    await expect(rpc.request('fixture', {})).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
    expect(count).toBeLessThan(20);
  });
  it('parses fragmented lines, drains buffered records, and observes clean exit', async () => {
    const process = connection('fragmented');
    try {
      expect(await process.next()).toEqual({ text: 'first' });
      expect(await process.next()).toEqual({ text: 'second' });
      await process.finish();
    } finally { await process.close(); }
  });
  it('passes shell metacharacters verbatim through stdin', async () => {
    const process = connection('echo');
    try {
      process.endInput('$(not-a-command) `literal` "quotes"\nsecond line');
      expect(await process.next()).toEqual({ input: '$(not-a-command) `literal` "quotes"\nsecond line' });
      await process.finish();
    } finally { await process.close(); }
  });
  it.each(['invalid', 'partial'])('rejects malformed output: %s', async (scenario) => {
    const process = connection(scenario);
    try { await expect(process.next()).rejects.toMatchObject({ code: 'INVALID_JSON' }); }
    finally { await process.close(); }
  });
  it('rejects a nonzero exit even after a success-looking JSON record', async () => {
    const process = connection('failed');
    try {
      expect(await process.next()).toEqual({ result: 'looks successful' });
      await expect(process.finish()).rejects.toMatchObject({ code: 'PROCESS_EXIT' });
    } finally { await process.close(); }
  });
  it('cancels the owned child and settles its pending reader', async () => {
    const abort = new AbortController();
    const process = connection('wait', abort.signal);
    try {
      expect(await process.next()).toEqual({ ready: true });
      const read = process.next();
      abort.abort();
      await expect(read).rejects.toMatchObject({ code: 'CANCELLED' });
    } finally { await process.close(); }
  });
});
