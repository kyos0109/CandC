import type { AgentId, Discussion, Message } from './domain.js';

export function parseContribution(text: string): { text: string; continuation: NonNullable<Message['continuation']>; conclusionRef?: string } {
  const marker = /(?:^|\n)\s*\[\[CANDC:(continue|yield|done|conclude)(?::([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?\]\]\s*$/i.exec(text);
  return { text: marker ? text.slice(0, marker.index).trimEnd() : text,
    continuation: marker ? marker[1]!.toLowerCase() as NonNullable<Message['continuation']> : 'yield',
    ...(marker?.[1]?.toLowerCase() === 'conclude' && marker[2] ? { conclusionRef: marker[2] } : {}) };
}

export function hasConfirmedConclusion(state: Discussion): boolean {
  if (pendingInput(state, 'codex') || pendingInput(state, 'claude')) return false;
  const lastUser = state.messages.findLastIndex(m => m.sender === 'user');
  const recent = state.messages.slice(lastUser + 1).filter(m => m.purpose === 'discussion' && m.status === 'completed');
  const latest = recent.at(-1);
  const peer = recent.findLast(m => m.sender !== latest?.sender);
  return latest?.continuation === 'conclude' && peer?.continuation === 'conclude' && latest.conclusionRef === peer.id;
}

// A response appended after an intervention may have started before that input.
export function pendingInput(state: Discussion, speaker: AgentId): boolean {
  if (state.behaviorVersion === 2) {
    const session = state.sessions[speaker];
    const receipt = state.v2!.receipts.findLast(r => r.agent === speaker && r.status === 'valid' && r.sessionId === session?.id);
    return state.messages.some(m => m.sender === 'user' && (m.recipient === 'both' || m.recipient === speaker) &&
      !receipt?.messages.some(ref => ref.id === m.id));
  }
  const inputIndex = state.messages.findLastIndex(m => m.sender === 'user' && (m.recipient === 'both' || m.recipient === speaker));
  if (inputIndex < 0) return false;
  const answerIndex = state.messages.findLastIndex(m => m.sender === speaker && m.purpose === 'discussion' && m.status === 'completed');
  const answer = state.messages[answerIndex];
  if (answer?.inputMessageId) return answer.inputMessageId !== state.messages[inputIndex]!.id;
  // Legacy completed records predate input tracking; retain their stored ordering.
  return answerIndex < inputIndex;
}

export function publicPreview(text: string): string {
  return text.replace(/(?:^|\n)\s*\[\[CANDC:[^\n]*$/, '');
}

export function chooseNext(state: Discussion, speaker: AgentId): { speaker: AgentId; settled: boolean } {
  const peer = speaker === 'codex' ? 'claude' : 'codex';
  const messages = state.messages.filter(m => m.purpose === 'discussion' && m.status === 'completed');
  // Everyone gets an independent opening before continuation requests take effect.
  if (messages.length === 1) return { speaker: peer, settled: false };
  if (pendingInput(state, peer)) return { speaker: peer, settled: false };
  if (pendingInput(state, speaker)) return { speaker, settled: false };
  const lastUser = state.messages.findLastIndex(m => m.sender === 'user');
  const recent = state.messages.slice(lastUser + 1).filter(m => m.purpose === 'discussion' && m.status === 'completed');
  const own = recent.findLast(m => m.sender === speaker);
  const theirs = recent.findLast(m => m.sender === peer);
  const settled = (own?.continuation === 'done' || own?.continuation === 'yield') && theirs?.continuation === 'done';
  let consecutive = 0;
  for (const message of recent.toReversed()) {
    if (message.sender !== speaker) break;
    consecutive++;
  }
  const next = own?.continuation === 'conclude' || own?.continuation === 'done' ? peer : theirs?.continuation === 'done' ? speaker :
    own?.continuation === 'continue' && consecutive < 3 ? speaker : peer;
  return { speaker: next, settled };
}
