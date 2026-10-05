import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentAdapter, AgentEvent, TurnRequest } from './types.js';
import { ROOM_CONTROL_START, ROOM_CONTROL_END, parseRoomAnswer, type ProviderId, type RoomControl, type RoomMessage } from '../room-contract.js';
import { AppError } from '../domain.js';

export function fakeRoomResponse(request: TurnRequest): string {
  const r = request.room!;
  const publicAnswers = r.messages.filter(m => m.purpose === 'discussion' && m.sender !== 'user');
  let action: RoomControl['action'] = { type: 'none' };
  let text = `[示範 ${r.actor}] 依目前題目與限制補充分析。這是隔離測試回覆，沒有真實 AI 推論。`;
  let continuation: RoomControl['continuation'] = 'yield';
  if (r.actor === 'moderator') {
    if (r.purpose === 'monitor') { action = { type: 'observe' }; text = '監看目前公開發言。'; }
    else if (r.purpose === 'summary') { action = { type: 'observe' }; text = '示範整理：保留公開觀點、分歧與尚待確認的資料。'; }
    else if (r.moderatorMode !== 'judge') { action = { type: 'observe' }; text = '請發言者依原題互相回應；尚有分歧時保留爭點。'; }
    else {
      const speakers = r.roster.filter(p => p.role === 'speaker' && !p.muted);
      const next = speakers[publicAnswers.length % speakers.length];
      action = publicAnswers.length >= speakers.length * 2 ? { type: 'finish', result: '示範主持裁決：目前分析已足夠，仍需要實際資料。', dissent: [], unresolved: ['示範資料不構成真實證據。'] } :
        next ? { type: 'speak', target: next.id, task: '針對目前題目補充理由、反例與待查證事項。' } : { type: 'pause', reason: '沒有可發言的參與者。' };
      text = action.type === 'speak' ? `主持人請 ${action.target} 補充。` : '主持人整理公開討論與限制。';
    }
  } else if (request.untilConclusion) {
    action = r.proposal ? { type: 'confirm', proposalId: r.proposal.id } : { type: 'propose', result: '依提供資料形成條件式結果。', dissent: [], unresolved: ['需要真實資料確認。'] };
  } else if (publicAnswers.filter(m => m.sender === r.actor).length >= 1) continuation = 'done';
  if (action.type === 'propose' || action.type === 'finish') action = { ...action, delivery: { status: 'complete', kind: 'undetermined', basis: ['示範模式只能驗證流程，沒有可支持實際主題判斷的真實資料。'] } };
  if (action.type === 'confirm') action = { ...action, review: { adequate: true, reason: '示範審查：此結果明確交代示範模式無法判斷實際主題；不代表真實模型品質驗證。', gaps: [] } };
  if (action.type === 'propose') action.result = '示範模式無法判斷此主題的實際答案：目前只有測試回覆，沒有真實 AI 分析或查證。';
  const references: RoomControl['references'] = r.actor === 'moderator' || r.purpose === 'summary' ? [] : r.messages.filter(m => m.sender === 'user').slice(-99).map(m => ({ messageId: m.id, disposition: 'addressed', reason: 'Fixture response; no live validation.' }));
  const peer = publicAnswers.findLast(m => m.sender !== r.actor && m.recipient === 'all');
  if (peer && r.actor !== 'moderator' && r.purpose === 'discussion') references.push({ messageId: peer.id, disposition: 'checked', reason: 'Fixture peer check; not factual verification.' });
  const work = r.execution?.policyVersion === 1 && r.purpose !== 'monitor' && !(r.actor === 'moderator' && r.moderatorMode !== 'judge' && r.purpose === 'moderation') ? { checkpoint: { answer: text, reasons: ['示範資料只驗證流程。'], dissent: [], unknowns: ['尚未驗證真實模型品質。'], sources: [request.messageId] },
    completedTasks: r.execution.currentTaskKey ? [{ key: r.execution.currentTaskKey, sources: [request.messageId] }] : [] } : undefined;
  return `${text}\n${ROOM_CONTROL_START}\n${JSON.stringify({ version: 3, taskVersion: r.taskVersion, grantId: r.grantId, continuation, action, references, ...(work ? { work } : {}) })}\n${ROOM_CONTROL_END}`;
}

export class RoomFakeAdapter implements AgentAdapter {
  readonly backend = 'fake' as const;
  private readonly memories = new Map<string, RoomMessage[]>();
  constructor(readonly id: ProviderId, private readonly respond = fakeRoomResponse, private readonly delayMs = 5) {}
  async *run(request: TurnRequest): AsyncGenerator<AgentEvent> {
    request.signal.throwIfAborted();
    const room = request.room;
    if (!room) throw new AppError('INVALID_PROTOCOL', 'Room request required.');
    if (request.session && !this.memories.has(request.session.id)) throw new AppError('SESSION_MISMATCH', 'Fixture session does not exist.');
    const session = request.session ?? { id: `room-${this.id}-${randomUUID()}`, model: request.settings.model, backend: 'fake' as const };
    const history = this.memories.get(session.id) ?? [];
    for (const m of room.messages) if (!history.some(old => old.id === m.id)) history.push(structuredClone(m));
    this.memories.set(session.id, history);
    yield { type: 'session', session };
    const text = this.respond({ ...request, room: { ...room, messages: structuredClone(history) } });
    for (const chunk of text.match(/.{1,48}/gs) ?? []) {
      await delay(this.delayMs, undefined, { signal: request.signal });
      yield { type: 'delta', text: chunk };
    }
    const parsed = parseRoomAnswer(text);
    if (room.purpose !== 'monitor') history.push({ id: request.messageId, sender: room.actor, recipient: 'all', text: parsed.text,
      round: request.round, inReplyTo: null, status: 'completed', createdAt: new Date().toISOString(), taskVersion: room.taskVersion,
      purpose: room.purpose === 'moderation' ? 'moderation' : room.purpose === 'summary' ? 'summary' : 'discussion' });
    yield { type: 'completed', text, model: session.model };
  }
}
