import { z } from 'zod';
import { AppError } from '../domain.js';
import { JsonLineProcess, type ProcessFactory } from './process.js';
import { assertLiveAuthorized, buildPrompt, type AgentAdapter, type AgentEvent, type LiveAuthorization, type TurnRequest } from './types.js';
import { providerUsage } from '../performance.js';

export function subscriptionEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_GENAI_USE_VERTEXAI', 'XAI_API_KEY', 'ANTHROPIC_API_KEY']) delete env[key];
  return env;
}
export function geminiArguments(request: TurnRequest): string[] {
  return ['--output-format', 'stream-json', '--model', request.settings.model, '--approval-mode', 'default',
    '--extensions', 'none', ...(request.session ? ['--resume', request.session.id] : [])];
}
// A caller must verify effective policy/configuration against a pinned CLI before constructing an authorized adapter.
// The application keeps this adapter locked until that live verification exists; fixture parsing is insufficient.
export class GeminiAdapter implements AgentAdapter {
  readonly id = 'gemini' as const; readonly backend = 'live' as const;
  constructor(private readonly executable: string, private readonly cwd: string,
    private readonly authorization: LiveAuthorization = { messagesAuthorized: false, toolPolicyVerified: false },
    private readonly launch: ProcessFactory = spec => new JsonLineProcess(spec)) {}
  async *run(request: TurnRequest): AsyncGenerator<AgentEvent> {
    assertLiveAuthorized(this.authorization); request.signal.throwIfAborted();
    if (request.research) throw new AppError('RESEARCH_UNVERIFIED', 'Gemini research isolation has not been validated.');
    const child = this.launch({ executable: this.executable, args: geminiArguments(request), cwd: request.workspace ?? this.cwd,
      env: subscriptionEnvironment(), signal: request.signal, observePerformance: request.observePerformance });
    let session: string | null = null, text = '';
    try {
      child.endInput(buildPrompt(request));
      while (true) {
        request.signal.throwIfAborted();
        const event = z.object({ type: z.string() }).passthrough().parse(await child.next());
        if (event.type === 'init') {
          const init = z.object({ session_id: z.string().min(1), model: z.string().min(1) }).parse(event);
          if (session || request.session && request.session.id !== init.session_id) throw new AppError('SESSION_MISMATCH', 'Gemini resumed a different session.');
          if (init.model !== request.settings.model) throw new AppError('MODEL_MISMATCH', 'Gemini changed models.');
          session = init.session_id; yield { type: 'session', session: { id: session, model: init.model, backend: 'live' } };
        } else if (event.type === 'message') {
          const message = z.object({ role: z.enum(['user', 'assistant']), content: z.string(), delta: z.boolean().optional() }).parse(event);
          if (!session) throw new AppError('INVALID_PROTOCOL', 'Gemini text before session init.');
          if (message.role === 'assistant') {
            if (message.delta !== true && text) throw new AppError('INVALID_PROTOCOL', 'Ambiguous Gemini non-delta output.');
            text += message.content; yield { type: 'delta', text: message.content };
          }
        } else if (event.type === 'tool_use' || event.type === 'tool_result') throw new AppError('UNEXPECTED_TOOLS', 'Gemini attempted a tool outside the no-tool policy.');
        else if (event.type === 'error') throw new AppError('PROVIDER_ERROR', 'Gemini reported an error; raw provider details are not logged.');
        else if (event.type === 'result') {
          const result = z.object({ status: z.literal('success'), error: z.never().optional(), stats: z.object({
            tool_calls: z.literal(0), models: z.record(z.string(), z.unknown()), input_tokens: z.number().nonnegative().optional(), output_tokens: z.number().nonnegative().optional(),
          }).passthrough().optional() }).parse(event);
          if (!session || result.stats && Object.keys(result.stats.models).some(model => model !== request.settings.model)) throw new AppError('MODEL_MISMATCH', 'Gemini result model is not the requested model.');
          await child.finish(); const usage = providerUsage(result.stats);
          yield { type: 'completed', text, model: request.settings.model, ...(usage ? { performanceUsage: usage, usage: Object.fromEntries(Object.entries(usage as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) } : {}) }; return;
        } else throw new AppError('INVALID_PROTOCOL', 'Unknown Gemini protocol event.');
      }
    } finally { await child.close(); }
  }
}
