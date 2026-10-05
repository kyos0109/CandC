import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AppError } from '../domain.js';
import { JsonLineProcess, type ProcessFactory } from './process.js';
import { assertLiveAuthorized, buildPrompt, type AgentAdapter, type AgentEvent, type LiveAuthorization, type TurnRequest } from './types.js';
import { subscriptionEnvironment } from './gemini.js';
import { providerUsage } from '../performance.js';

export function grokArguments(request: TurnRequest, promptFile: string, newSessionId: string): string[] {
  return ['--no-auto-update', '--prompt-file', promptFile, '--output-format', 'streaming-json', '--model', request.settings.model,
    '--tools', '', '--disallowed-tools', 'Agent',
    ...['Bash', 'Edit', 'Write', 'Read', 'Grep', 'MCPTool', 'WebFetch', 'WebSearch'].flatMap(tool => ['--deny', tool]),
    ...(request.session ? ['--resume', request.session.id] : ['--session-id', newSessionId])];
}
export class GrokAdapter implements AgentAdapter {
  readonly id = 'grok' as const; readonly backend = 'live' as const;
  constructor(private readonly executable: string, private readonly cwd: string,
    private readonly authorization: LiveAuthorization = { messagesAuthorized: false, toolPolicyVerified: false },
    private readonly launch: ProcessFactory = spec => new JsonLineProcess(spec)) {}
  async *run(request: TurnRequest): AsyncGenerator<AgentEvent> {
    assertLiveAuthorized(this.authorization); request.signal.throwIfAborted();
    if (request.research) throw new AppError('RESEARCH_UNVERIFIED', 'Grok research isolation has not been validated.');
    const cwd = request.workspace ?? this.cwd, expectedSession = request.session?.id ?? randomUUID();
    const promptFile = path.join(cwd, `${request.messageId}.prompt.json`);
    // The prompt file avoids command line limits and process-list disclosure. It stays inside the owned generation workspace.
    await writeFile(promptFile, buildPrompt(request), { encoding: 'utf8', flag: 'wx' });
    let text = '';
    let child: ReturnType<ProcessFactory> | undefined;
    try {
      child = this.launch({ executable: this.executable, args: grokArguments(request, promptFile, expectedSession), cwd,
        env: subscriptionEnvironment(), signal: request.signal, observePerformance: request.observePerformance });
      child.endInput();
      while (true) {
        request.signal.throwIfAborted();
        const event = z.object({ type: z.string() }).passthrough().parse(await child.next());
        if (event.type === 'text') { const chunk = z.string().parse(event.data); text += chunk; yield { type: 'delta', text: chunk }; }
        else if (event.type === 'thought') { /* Private reasoning is never exposed or recorded. */ }
        else if (event.type === 'tool_call' || event.type === 'tool_call_update') throw new AppError('UNEXPECTED_TOOLS', 'Grok attempted a tool outside the no-tool policy.');
        else if (event.type === 'available_commands') {
          if (z.array(z.unknown()).parse(event.tools).length) throw new AppError('UNEXPECTED_TOOLS', 'Grok advertised unexpected tools.');
        } else if (event.type === 'usage' || event.type === 'plan' || event.type.startsWith('auto_compact_')) { /* Non-public diagnostics. */ }
        else if (event.type === 'error' || event.type === 'max_turns_reached') throw new AppError('PROVIDER_ERROR', 'Grok reported a failure.');
        else if (event.type === 'end') {
          const result = z.object({ stopReason: z.literal('end_turn'), sessionId: z.string(), modelUsage: z.record(z.string(), z.unknown()), usage: z.unknown().optional() }).parse(event);
          if (result.sessionId !== expectedSession) throw new AppError('SESSION_MISMATCH', 'Grok returned another session.');
          if (Object.keys(result.modelUsage).length !== 1 || !(request.settings.model in result.modelUsage)) throw new AppError('MODEL_MISMATCH', 'Grok resolved model was not independently confirmed.');
          await child.finish(); const usage = providerUsage(result.usage);
          yield { type: 'session', session: { id: expectedSession, model: request.settings.model, backend: 'live' } };
          yield { type: 'completed', text, model: request.settings.model, ...(usage ? { performanceUsage: usage,
            usage: Object.fromEntries(Object.entries(usage as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) } : {}) }; return;
        } else throw new AppError('INVALID_PROTOCOL', 'Unknown Grok protocol event; revalidate the pinned CLI.');
      }
    } finally { try { await child?.close(); } finally { await unlink(promptFile); } }
  }
}
