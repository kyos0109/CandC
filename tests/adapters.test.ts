import { describe, expect, it, vi } from 'vitest';
import { ClaudeAdapter, claudeArguments } from '../src/adapters/claude.js';
import { CodexAdapter, codexArguments, disabledFeatures, inheritedMcpNames } from '../src/adapters/codex.js';
import type { JsonConnection } from '../src/adapters/process.js';
import { request } from './helpers.js';

class ScriptedConnection implements JsonConnection {
  sent: unknown[] = [];
  input = '';
  closed = false;
  constructor(private messages: unknown[], private exitError?: Error) {}
  send(value: unknown): void { this.sent.push(value); }
  endInput(text = ''): void { this.input = text; }
  async next(): Promise<unknown> {
    if (!this.messages.length) throw new Error('Fixture stream exhausted.');
    return this.messages.shift();
  }
  async finish(): Promise<void> { if (this.exitError) throw this.exitError; }
  async close(): Promise<void> { this.closed = true; }
}
const consent = { messagesAuthorized: true, toolPolicyVerified: true };
const policyResponse = { id: 2, result: { config: { approval_policy: 'never', sandbox_mode: 'read-only', web_search: 'disabled', features: Object.fromEntries(disabledFeatures.map((name) => [name, false])), mcp_servers: {} } } };
const collect = async <T>(events: AsyncIterable<T>): Promise<T[]> => {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
};
const claudeInit = { type: 'system', subtype: 'init', session_id: 'claude-fixture', model: 'fixture-model', tools: [] };
const claudeResult = { type: 'result', subtype: 'success', is_error: false, result: 'Public answer', session_id: 'claude-fixture' };
const codexMessages = () => [
  { id: 1, result: { userAgent: 'fixture' } },
  policyResponse,
  { id: 3, result: { thread: { id: 'codex-fixture' }, model: 'fixture-model' } },
  // Notifications may arrive before the response to turn/start.
  { method: 'item/agentMessage/delta', params: { threadId: 'codex-fixture', turnId: 'turn-fixture', itemId: 'answer', delta: 'Public answer' } },
  { id: 4, result: { turn: { id: 'turn-fixture' } } },
  { method: 'turn/completed', params: { threadId: 'codex-fixture', turn: { id: 'turn-fixture', status: 'completed', items: [
    { type: 'reasoning', id: 'hidden', content: ['Private reasoning'] },
    { type: 'agentMessage', id: 'comment', text: 'Commentary', phase: 'commentary' },
    { type: 'agentMessage', id: 'answer', text: 'Public answer', phase: 'final_answer' },
  ] } } },
];

describe('performance protocol observations without live executables', () => {
  it.each([false, true])('counts independent Codex processes and %s resumed session without changing RPC payloads', async resumed => {
    const phases: string[] = [], connections: ScriptedConnection[] = [];
    const inference = new ScriptedConnection(codexMessages());
    const inspect = async (executable: string, cwd: string, signal: AbortSignal, observer?: import('../src/performance.js').PerformanceObserver) => inheritedMcpNames(executable, cwd, signal, observer, spec => {
      const connection = new ScriptedConnection([{ id: 1, result: {} }, { id: 2, result: { config: { mcp_servers: {} } } }]);
      connections.push(connection); spec.observePerformance?.('inspectStarted'); return connection;
    });
    const adapter = new CodexAdapter('fixture', '.', consent, spec => { connections.push(inference); spec.observePerformance?.('inferenceStarted'); return inference; }, inspect);
    const req = request({ observePerformance: phase => phases.push(phase), ...(resumed ? { session: { id: 'codex-fixture', model: 'fixture-model', backend: 'live' } } : {}) });
    await collect(adapter.run(req));
    expect(connections).toHaveLength(2); expect(connections.every(c => c.closed)).toBe(true);
    expect(phases.filter(p => p === 'inspectStarted')).toHaveLength(1); expect(phases.filter(p => p === 'inferenceStarted')).toHaveLength(1);
    expect(phases.indexOf('inspectCleanupEnd')).toBeLessThan(phases.indexOf('inferenceSpawn'));
    expect(phases.indexOf('rpcEnd')).toBeLessThan(phases.indexOf('sessionEnd'));
    expect(phases.indexOf('requestSent')).toBeLessThan(phases.indexOf('protocolComplete'));
    expect(phases.at(-1)).toBe('cleanupEnd');
    expect(inference.sent).toEqual(expect.arrayContaining([expect.objectContaining({ method: resumed ? 'thread/resume' : 'thread/start' })]));
  });
  it('Claude init is separate from local request send and throwing observers cannot affect protocol', async () => {
    const phases: string[] = [], connection = new ScriptedConnection([claudeInit, claudeResult]);
    await collect(new ClaudeAdapter('fixture', '.', consent, () => connection).run(request({ observePerformance: p => phases.push(p) })));
    expect(phases.indexOf('requestSent')).toBeLessThan(phases.indexOf('sessionEnd'));
    expect(phases).not.toContain('rpcEnd');
    const throwing = new ScriptedConnection([claudeInit, claudeResult]);
    await expect(collect(new ClaudeAdapter('fixture', '.', consent, () => throwing).run(request({ observePerformance: () => { throw new Error('diagnostics only'); } })))).resolves.toBeDefined();
    expect(throwing.input).toBe(connection.input); expect(throwing.closed).toBe(true);
  });
});

describe('live gate and no-tool arguments', () => {
  it('does not even launch an executable before authorization and policy verification', async () => {
    const launch = vi.fn();
    for (const Adapter of [CodexAdapter, ClaudeAdapter]) {
      await expect(collect(new Adapter('unused', '.', undefined, launch).run(request()))).rejects.toMatchObject({ code: 'LIVE_LOCKED' });
      await expect(collect(new Adapter('unused', '.', { messagesAuthorized: true, toolPolicyVerified: false }, launch).run(request()))).rejects.toMatchObject({ code: 'LIVE_LOCKED' });
    }
    expect(launch).not.toHaveBeenCalled();
  });
  it('keeps prompt text out of command arguments and resumes only a named session', () => {
    const args = claudeArguments(request({ topic: '$(dangerous command)', session: { id: 'specific-id', model: 'fixture-model', backend: 'live' } }));
    expect(args).not.toContain('--continue');
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).toContain('--safe-mode');
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual(['--tools', '']);
    expect(args.slice(-2)).toEqual(['--resume', 'specific-id']);
    expect(args.join(' ')).not.toContain('dangerous command');
    expect(codexArguments()).toContain('web_search="disabled"');
  });
});

describe('Claude stream handling', () => {
  it('records only provider-returned token fields and leaves missing usage unknown', async () => {
    const connection = new ScriptedConnection([claudeInit, { ...claudeResult, usage: { input_tokens: 12, output_tokens: 7, cache_read_input_tokens: 4, private_field: 'hidden' } }]);
    const events = await collect(new ClaudeAdapter('fixture', '.', consent, () => connection).run(request()));
    expect(events.find(e => e.type === 'completed')).toMatchObject({ usage: { input_tokens: 12, output_tokens: 7, cache_read_input_tokens: 4 } });
    expect(JSON.stringify(events)).not.toContain('private_field');
  });
  it('ignores thinking, checks session identity, and accepts only a successful process result', async () => {
    const connection = new ScriptedConnection([claudeInit,
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Private reasoning' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Public answer' } } }, claudeResult]);
    const events = await collect(new ClaudeAdapter('fixture', '.', consent, () => connection).run(request()));
    expect(JSON.stringify(events)).not.toContain('Private reasoning');
    expect(events.find(event => event.type === 'completed')).toEqual({ type: 'completed', text: 'Public answer', model: 'fixture-model' });
    expect(events.at(-1)).toEqual({ type: 'stage', phase: 'cleanup' });
    expect(connection.input).toContain('Harmless fixture question.');
    expect(connection.closed).toBe(true);
  });
  it.each([
    [[{ ...claudeInit, tools: ['Bash'] }], 'UNEXPECTED_TOOLS'],
    [[claudeInit, { ...claudeResult, session_id: 'other' }], 'AGENT_FAILURE'],
    [[claudeInit, { type: 'result', subtype: 'error_max_turns', session_id: 'claude-fixture' }], 'AGENT_FAILURE'],
    [[claudeInit, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }], 'UNEXPECTED_ACTION'],
  ])('rejects unsafe or incomplete result %s', async (messages, code) => {
    const connection = new ScriptedConnection(messages as unknown[]);
    await expect(collect(new ClaudeAdapter('fixture', '.', consent, () => connection).run(request()))).rejects.toMatchObject({ code });
    expect(connection.closed).toBe(true);
  });
  it('does not treat a result followed by a failed exit as success', async () => {
    const connection = new ScriptedConnection([claudeInit, claudeResult], new Error('Fixture nonzero exit'));
    await expect(collect(new ClaudeAdapter('fixture', '.', consent, () => connection).run(request()))).rejects.toThrow('Fixture nonzero exit');
  });
});

describe('Codex RPC handling', () => {
  it('records the matching turn usage only, without estimating token or billing values', async () => {
    const messages: unknown[] = codexMessages();
    const last = { totalTokens: 21, inputTokens: 12, cachedInputTokens: 3, cacheWriteInputTokens: 2, outputTokens: 9, reasoningOutputTokens: 4 };
    messages.splice(5, 0, { method: 'thread/tokenUsage/updated', params: { threadId: 'codex-fixture', turnId: 'other-turn', tokenUsage: { last: { ...last, totalTokens: 1000 } } } },
      { method: 'thread/tokenUsage/updated', params: { threadId: 'codex-fixture', turnId: 'turn-fixture', tokenUsage: { last } } });
    const connection = new ScriptedConnection(messages);
    const events = await collect(new CodexAdapter('fixture', '.', consent, () => connection, async () => []).run(request()));
    expect(events.find(e => e.type === 'completed')).toMatchObject({ usage: last });
  });
  it('handles early notifications and excludes commentary and hidden reasoning', async () => {
    const connection = new ScriptedConnection(codexMessages());
    const events = await collect(new CodexAdapter('fixture', '.', consent, () => connection, async () => []).run(request()));
    expect(events.find(event => event.type === 'completed')).toEqual({ type: 'completed', text: 'Public answer', model: 'fixture-model' });
    expect(events.at(-1)).toEqual({ type: 'stage', phase: 'cleanup' });
    expect(JSON.stringify(events)).not.toContain('Private reasoning');
    expect(JSON.stringify(connection.sent)).toContain('clientUserMessageId');
    expect(connection.closed).toBe(true);
  });
  it('does not silently fall back to a different model', async () => {
    const connection = new ScriptedConnection([{ id: 1, result: {} }, policyResponse, { id: 3, result: { thread: { id: 'codex-fixture' }, model: 'other-model' } }]);
    await expect(collect(new CodexAdapter('fixture', '.', consent, () => connection, async () => []).run(request()))).rejects.toMatchObject({ code: 'MODEL_MISMATCH' });
  });
  it('rejects agent-initiated tool approvals rather than granting new authorization', async () => {
    const connection = new ScriptedConnection([{ id: 1, method: 'item/commandExecution/requestApproval', params: { command: 'dangerous' } }]);
    await expect(collect(new CodexAdapter('fixture', '.', consent, () => connection, async () => []).run(request()))).rejects.toMatchObject({ code: 'UNEXPECTED_ACTION' });
    expect(connection.sent.at(-1)).toMatchObject({ id: 1, error: { code: -32601 } });
  });
});
