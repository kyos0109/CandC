import { observe, providerUsage } from '../performance.js';
import { z } from 'zod';
import { AppError } from '../domain.js';
import { JsonLineProcess, type ProcessFactory, type JsonConnection } from './process.js';
import { assertLiveAuthorized, buildPrompt, type AgentAdapter, type AgentEvent, type LiveAuthorization, type TurnRequest } from './types.js';
import { researchConfig, readEvidence } from './research-config.js';

const envelopeSchema = z.object({ type: z.string(), subtype: z.string().optional() }).passthrough();
const initSchema = z.object({ session_id: z.string().min(1), model: z.string(), tools: z.array(z.string()) });
const resultSchema = z.object({
  subtype: z.literal('success'), is_error: z.boolean().optional(),
  result: z.string(), session_id: z.string().min(1),
  usage: z.record(z.string(), z.unknown()).optional(),
});
const textDeltaSchema = z.object({ event: z.object({
  type: z.literal('content_block_delta'),
  delta: z.object({ type: z.literal('text_delta'), text: z.string() }),
}) });

export function claudeArguments(request: TurnRequest, mcp?: { command: string; args: string[] }): string[] {
  return ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    ...(request.research ? ['--restricted', '--settings', '{"disableAllHooks":true,"enabledPlugins":{}}'] : ['--safe-mode']),
    '--tools', request.research ? 'WebSearch' : '', '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: mcp ? { candc: { command: mcp.command, args: mcp.args } } : {} }),
    ...(request.research ? ['--allowedTools', 'WebSearch,mcp__candc__list_files,mcp__candc__read_text,mcp__candc__search_text,mcp__candc__fetch_public_page'] : []),
    '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--no-chrome',
    '--disable-slash-commands', '--model', request.settings.model, '--effort', request.settings.effort,
    ...(request.session ? ['--resume', request.session.id] : [])];
}

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude' as const;
  readonly backend = 'live' as const;
  constructor(private readonly executable: string, private readonly cwd: string,
    private readonly authorization: LiveAuthorization = { messagesAuthorized: false, toolPolicyVerified: false },
    private readonly launch: ProcessFactory = (spec) => new JsonLineProcess(spec)) {}

  async *run(request: TurnRequest): AsyncGenerator<AgentEvent> {
    assertLiveAuthorized(this.authorization);
    request.signal.throwIfAborted();
    observe(request.observePerformance, 'researchStart');
    const cwd = request.workspace ?? this.cwd;
    const mcp = await researchConfig(request, cwd);
    observe(request.observePerformance, 'researchEnd');
    yield { type: 'stage', phase: 'processPreparation' };
    observe(request.observePerformance, 'inferenceSpawn');
    const process = this.launch({ executable: this.executable, args: claudeArguments(request, mcp), cwd, signal: request.signal, observePerformance: request.observePerformance });
    try { yield* this.executeTurn(process, request, mcp); } catch (error) { observe(request.observePerformance, 'failureObserved'); throw error; } finally { observe(request.observePerformance, 'cleanupStart'); await process.close(); observe(request.observePerformance, 'cleanupEnd'); yield { type: 'stage', phase: 'cleanup' }; }
  }

  private async *executeTurn(process: JsonConnection, request: TurnRequest, mcp: Awaited<ReturnType<typeof researchConfig>>): AsyncGenerator<AgentEvent> {
    let model: string | undefined;
    let sessionId: string | undefined;
    observe(request.observePerformance, 'requestSent');
    process.endInput(buildPrompt(request));
    while (true) {
      request.signal.throwIfAborted();
      const value = await process.next();
      const envelope = envelopeSchema.parse(value);
      if (envelope.type === 'system' && envelope.subtype === 'init') {
        observe(request.observePerformance, 'policyStart');
        observe(request.observePerformance, 'sessionStart');
        const init = initSchema.parse(value);
        const permitted = new Set(['WebSearch', 'EndConversation', 'mcp__candc__list_files', 'mcp__candc__read_text', 'mcp__candc__search_text', 'mcp__candc__fetch_public_page']);
        if (init.tools.some((tool) => !request.research || !permitted.has(tool))) throw new AppError('UNEXPECTED_TOOLS', 'Claude loaded tools outside the authorized research policy.');
        if (request.session && request.session.id !== init.session_id) {
          throw new AppError('SESSION_MISMATCH', 'Claude resumed a different session.');
        }
        model = init.model;
        const aliases = new Set(['sonnet', 'opus', 'fable', 'haiku']);
        if (aliases.has(request.settings.model) ? !model.startsWith(`claude-${request.settings.model}-`) : model !== request.settings.model) throw new AppError('MODEL_MISMATCH', 'Claude selected a different model; automatic fallback is not allowed.');
        sessionId = init.session_id;
        observe(request.observePerformance, 'policyEnd');
        observe(request.observePerformance, 'sessionEnd');
        yield { type: 'session', session: { id: sessionId, model, backend: 'live' } };
      } else if (envelope.type === 'stream_event') {
        const delta = textDeltaSchema.safeParse(value);
        if (delta.success) yield { type: 'delta', text: delta.data.event.delta.text };
        // Thinking deltas are deliberately not forwarded.
      } else if (envelope.type === 'assistant' || envelope.type === 'user') {
        const content = z.object({ message: z.object({ content: z.array(z.object({ type: z.string(), name: z.string().optional() }).passthrough()) }) }).safeParse(value);
        if (content.success && content.data.message.content.some((block) => block.type === 'tool_use' || block.type === 'tool_result')) {
          if (!request.research) throw new AppError('UNEXPECTED_ACTION', 'Claude attempted tool use in a no-tool session.');
          for (const block of content.data.message.content) {
            if (block.type === 'tool_use') {
              if (!block.name || !['WebSearch', 'EndConversation', 'mcp__candc__list_files', 'mcp__candc__read_text', 'mcp__candc__search_text', 'mcp__candc__fetch_public_page'].includes(block.name)) throw new AppError('UNEXPECTED_ACTION', 'Claude attempted an unauthorized tool.');
              yield { type: 'tool', name: block.name, ...(typeof block.id === 'string' ? { toolId: block.id } : {}) };
            }
          }
        }
      } else if (envelope.type === 'result') {
        const result = resultSchema.safeParse(value);
        if (!result.success || result.data.is_error || !model || result.data.session_id !== sessionId) {
          throw new AppError('AGENT_FAILURE', 'Claude did not provide a successful result for the initialized session.');
        }
        observe(request.observePerformance, 'protocolComplete');
        yield { type: 'stage', phase: 'generationComplete' };
        observe(request.observePerformance, 'cleanupStart');
        await process.finish();
        for (const evidence of await readEvidence(mcp?.evidenceFile)) yield { type: 'evidence', evidence };
        const usage = Object.fromEntries(Object.entries(result.data.usage ?? {}).filter(([key, value]) =>
          ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].includes(key) && typeof value === 'number' && value >= 0)) as Record<string, number>;
        const nativeUsage = providerUsage(result.data.usage);
        yield { type: 'completed', text: result.data.result, model, ...(nativeUsage ? { performanceUsage: nativeUsage } : {}), ...(Object.keys(usage).length ? { usage } : {}) };
        return;
      }
    }
  }
}
