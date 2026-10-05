import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { GeminiAdapter, geminiArguments } from '../src/adapters/gemini.js';
import { GrokAdapter, grokArguments } from '../src/adapters/grok.js';
import type { JsonConnection, ProcessSpec } from '../src/adapters/process.js';
import { request } from './helpers.js';
import { parseRoomAnswer, ROOM_CONTROL_START, ROOM_CONTROL_END } from '../src/room-contract.js';

class Stream implements JsonConnection {
  closed = false; input = '';
  constructor(private events: unknown[], private exitError?: Error) {}
  send() {}
  endInput(text = '') { this.input = text; }
  async next() { if (!this.events.length) throw new Error('Fixture exhausted.'); return this.events.shift(); }
  async finish() { if (this.exitError) throw this.exitError; }
  async close() { this.closed = true; }
}
const consent = { messagesAuthorized: true, toolPolicyVerified: true };
async function collect<T>(events: AsyncIterable<T>) { const result: T[] = []; for await (const event of events) result.push(event); return result; }
const gemini = (): Record<string, unknown>[] => [{ type: 'init', session_id: 'gemini-fixture', model: 'fixture-model' }, { type: 'message', role: 'assistant', content: 'Public answer', delta: true }, { type: 'result', status: 'success', stats: { tool_calls: 0, models: { 'fixture-model': {} }, input_tokens: 12, output_tokens: 4 } }];

describe('additional official CLI protocol fixtures (not live validation)', () => {
  it.each([GeminiAdapter, GrokAdapter])('locks inference before authorization and tool isolation verification', async Adapter => {
    const launch = vi.fn();
    await expect(collect(new Adapter('unused', '.', undefined, launch).run(request()))).rejects.toMatchObject({ code: 'LIVE_LOCKED' });
    await expect(collect(new Adapter('unused', '.', { messagesAuthorized: true, toolPolicyVerified: false }, launch).run(request()))).rejects.toMatchObject({ code: 'LIVE_LOCKED' });
    expect(launch).not.toHaveBeenCalled();
  });
  it('Gemini recognizes init, public delta and successful zero-tool result; excludes private fields', async () => {
    const stream = new Stream(gemini());
    const events = await collect(new GeminiAdapter('fixture', '.', consent, () => stream).run(request()));
    expect(events.at(-1)).toMatchObject({ type: 'completed', text: 'Public answer', usage: { input_tokens: 12, output_tokens: 4 } });
    expect(stream.closed).toBe(true); expect(stream.input).toContain(request().topic);
    expect(geminiArguments(request()).join(' ')).not.toContain('Fixture topic.');
  });
  it.each(['model', 'session', 'tool', 'exit'])('Gemini fails closed on %s mismatch and always closes the owned process', async failure => {
    const events = gemini();
    if (failure === 'model') events[0] = { ...events[0], model: 'wrong' };
    if (failure === 'session') events[0] = { ...events[0], session_id: 'wrong' };
    if (failure === 'tool') events.splice(1, 0, { type: 'tool_use' });
    const stream = new Stream(events, failure === 'exit' ? new Error('Exit failure') : undefined);
    await expect(collect(new GeminiAdapter('fixture', '.', consent, () => stream).run(request({ ...(failure === 'session' ? { session: { id: 'gemini-fixture', model: 'fixture-model', backend: 'live' } } : {}) })))).rejects.toThrow();
    expect(stream.closed).toBe(true);
  });
  it('Grok names a fresh session, uses a private prompt file, omits thought and removes input after cleanup', async () => {
    const directory = await mkdtemp(path.resolve('.cache/grok-fixture-')); let stream: Stream | undefined, spec: ProcessSpec | undefined;
    try {
      const adapter = new GrokAdapter('fixture', directory, consent, s => { spec = s; const sessionId = s.args[s.args.indexOf('--session-id') + 1]; stream = new Stream([{ type: 'available_commands', tools: [], commands: [] }, { type: 'thought', data: 'private-reasoning' }, { type: 'text', data: 'Public answer' }, { type: 'end', stopReason: 'end_turn', sessionId, modelUsage: { 'fixture-model': {} }, usage: { input_tokens: 3, output_tokens: 2 } }]); return stream; });
      const events = await collect(adapter.run(request({ messageId: randomUUID() })));
      expect(events.at(-1)).toMatchObject({ type: 'completed', text: 'Public answer' });
      expect(JSON.stringify(events)).not.toContain('private-reasoning'); expect(stream!.closed).toBe(true);
      expect(spec!.args).not.toContain('--resume'); expect(spec!.args.join(' ')).not.toContain('Fixture topic.'); expect(await readdir(directory)).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it.each(['model', 'session', 'tool', 'exit', 'launch'])('Grok fails on %s and removes its owned prompt', async failure => {
    const directory = await mkdtemp(path.resolve('.cache/grok-fault-')); let stream: Stream | undefined;
    try {
      const adapter = new GrokAdapter('fixture', directory, consent, () => {
        if (failure === 'launch') throw new Error('Launch failed');
        stream = new Stream(failure === 'tool' ? [{ type: 'tool_call', data: {} }] : [{ type: 'end', stopReason: 'end_turn', sessionId: failure === 'session' ? 'wrong' : 'owned', modelUsage: { [failure === 'model' ? 'wrong' : 'fixture-model']: {} } }], failure === 'exit' ? new Error('Exit failure') : undefined); return stream;
      });
      await expect(collect(adapter.run(request({ messageId: randomUUID(), session: { id: 'owned', model: 'fixture-model', backend: 'live' } })))).rejects.toThrow();
      if (stream) expect(stream.closed).toBe(true); expect(await readdir(directory)).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('never resumes latest or forks another session in the new CLI arguments', () => {
    const resumed = request({ session: { id: 'owned', backend: 'live', model: 'fixture-model' } });
    expect(geminiArguments(resumed).slice(-2)).toEqual(['--resume', 'owned']);
    expect(grokArguments(resumed, 'owned-prompt', 'unused').slice(-2)).toEqual(['--resume', 'owned']);
    expect(grokArguments(request(), 'owned-prompt', 'fresh').slice(-2)).toEqual(['--session-id', 'fresh']);
  });
});
describe('room control envelope boundaries', () => {
  const envelope = `${ROOM_CONTROL_START}\n${JSON.stringify({ version: 3, taskVersion: 1, grantId: null, continuation: 'yield', action: { type: 'observe' } })}\n${ROOM_CONTROL_END}`;
  it('accepts only final standalone control outside Markdown fences', () => {
    expect(parseRoomAnswer('Public\n' + envelope).control?.action.type).toBe('observe');
    for (const text of ['```json\n' + envelope, '~~~\n' + envelope, envelope.split('\n').map(line => '> ' + line).join('\n'), envelope + '\nMore answer', envelope + '\n' + envelope]) expect(parseRoomAnswer(text).control).toBeNull();
    expect(parseRoomAnswer('```\nexample\n```\n' + envelope).control).not.toBeNull();
  });
});
