import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonLineProcess } from '../src/adapters/process.js';

const fixture = path.resolve('tests/fixtures/process.mjs');
const connection = (scenario: string, signal = new AbortController().signal) => new JsonLineProcess({
  executable: process.execPath, args: [fixture, scenario], cwd: process.cwd(),
  signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
});

describe('owned local fixture processes', () => {
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
