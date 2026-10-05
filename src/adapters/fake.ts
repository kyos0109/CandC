import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError, type AgentId, type Message } from '../domain.js';
import type { AgentAdapter, AgentEvent, TurnRequest } from './types.js';
import { CONTROL_START, CONTROL_END, parseFocused } from '../focused.js';

export type FakeResponder = (request: TurnRequest) => string;
export class FakeAdapter implements AgentAdapter {
  readonly backend = 'fake' as const;
  private readonly sessions = new Map<string, Message[]>();
  constructor(readonly id: AgentId, private readonly respond: FakeResponder =
    (request) => `[FAKE ${id}] round ${request.round}: ${request.topic}`, private readonly delayMs = 5) {}

  async *run(request: TurnRequest): AsyncGenerator<AgentEvent> {
    request.signal.throwIfAborted();
    yield { type: 'stage', phase: 'processPreparation' };
    const session = request.session ?? {
      id: `fake-${this.id}-${randomUUID()}`, model: request.settings.model, backend: 'fake',
    };
    if (request.contract && request.session && !this.sessions.has(session.id)) throw new AppError('SESSION_MISMATCH', 'Fake native session is unavailable.');
    const memory = this.sessions.get(session.id) ?? [];
    for (const m of request.context) if (!memory.some(old => old.id === m.id)) memory.push(structuredClone(m));
    this.sessions.set(session.id, memory);
    yield { type: 'session', session };
    const visible = request.contract ? { ...request, context: structuredClone(memory) } : request;
    const text = request.purpose === 'roles' ? JSON.stringify({ codex: '優先評估可靠性、風險與長期維護。', claude: '優先評估成本、速度與方案必要性。' }) : request.purpose === 'summary' ?
      `[示範 ${this.id}]\n\n## 討論整理\n\n- 雙方已比較可靠性與成本。\n- 這是示範流程，沒有真實 AI 推論或外部查證。\n- 待確認：具體限制與可接受的成本。` : this.respond(visible);
    const output = request.contract && request.purpose === 'discussion' && !text.includes(CONTROL_START) ? text.replace(/\n?\[\[CANDC:[^\n]+\]\]\s*$/, '') + `\n${CONTROL_START}\n` + JSON.stringify({ version: 2,
      issueId: request.contract.taskCard.issueId, issueVersion: request.contract.taskCard.issueVersion, taskVersion: request.contract.taskCard.version,
      continuation: /\[\[CANDC:continue\]\]/.test(text) ? 'continue' : /\[\[CANDC:done\]\]/.test(text) ? 'done' : 'yield', action: { type: 'none' } }) + `\n${CONTROL_END}` : text;
    for (const chunk of output.match(/.{1,32}/gs) ?? []) {
      await delay(this.delayMs, undefined, { signal: request.signal });
      yield { type: 'delta', text: chunk };
    }
    yield { type: 'stage', phase: 'generationComplete' };
    memory.push({ id: request.messageId, sender: this.id, recipient: 'both', text: request.contract ? parseFocused(output).text : text,
      round: request.round, inReplyTo: request.contract?.taskCard.responseTarget ?? null, status: 'completed', createdAt: new Date().toISOString(), purpose: request.purpose ?? 'discussion' });
    yield { type: 'completed', text: output, model: request.settings.model };
    yield { type: 'stage', phase: 'cleanup' };
  }
}
