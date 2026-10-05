import type { RoomDiscussion, RoomMessage } from '../src/room-contract.js';
import { seatOf, type SeatView } from './seats.js';

// The room stream is the saved public messages plus compact event rows derived from saved moderator state.
// Nothing here infers intent: every row comes from a stored notice message or a stored `speak` command.
export type RoomEvent = { kind: 'event'; id: string; at: string; who: 'moderator' | 'user'; text: string; detail?: string; seat?: string };
export type TimelineItem = { kind: 'message'; message: RoomMessage } | RoomEvent;

/** A saved message carries the ID of the call that produced it, so a preview of a call that is already saved is stale and must not appear beside it. */
export function liveProgress<P extends object>(progress: P | null, messages: ReadonlyArray<{ id: string }>): P | null {
  const turnId = (progress as { turnId?: string } | null)?.turnId;
  return progress && !(turnId && messages.some(message => message.id === turnId)) ? progress : null;
}

const firstLine = (text: string) => text.split('\n', 1)[0] ?? '';
const tail = (text: string) => text.split('\n').slice(1).join('\n').trim();
const withDetail = (detail: string) => detail ? { detail } : {};

/** Public notices written by the controller (mute, interrupt, topic change, configuration) as one-line events. */
export function noticeEvent(message: RoomMessage, seats: Record<string, SeatView>): RoomEvent {
  const line = firstLine(message.text), base = { kind: 'event' as const, id: message.id, at: message.createdAt, who: message.sender === 'user' ? 'user' as const : 'moderator' as const };
  const stop = /^(解除)?停止發言：(\S+)$/.exec(line);
  if (stop) { const seat = seatOf(seats, stop[2]!); return { ...base, seat: seat.id, text: stop[1] ? `解除 ${seat.name} 的停止發言` : `停止 ${seat.name} 發言`, ...withDetail(tail(message.text)) }; }
  if (line.startsWith('主持人中止本次發言：')) return { ...base, text: '中止了目前的發言', ...withDetail(line.slice('主持人中止本次發言：'.length)) };
  if (line.startsWith('主題變更通知')) return { ...base, text: '通知改題，等你確認', ...withDetail(tail(message.text)) };
  if (line.startsWith('使用者更新題目')) return { ...base, text: '你更新了題目、目標或限制', ...withDetail(tail(message.text)) };
  return { ...base, text: line, ...withDetail(tail(message.text)) };
}

/** Messages and moderator events in saved order. `observe` commands are routine monitoring and stay out of the stream. */
export function roomTimeline(state: RoomDiscussion, seats: Record<string, SeatView>): TimelineItem[] {
  const entries: Array<{ at: string; order: number; item: TimelineItem }> = [];
  state.messages.forEach((message, order) => entries.push({ at: message.createdAt, order, item: message.purpose === 'notice' ? noticeEvent(message, seats) : { kind: 'message', message } }));
  state.room.commands.forEach((command, index) => {
    if (command.action.type !== 'speak') return;
    const call = state.room.calls.find(candidate => candidate.id === command.callId); if (!call) return;
    // Place the grant after the moderator's own answer: a call is saved when it completes, not when it starts.
    const at = new Date(Date.parse(call.startedAt) + (call.durationMs ?? 0)).toISOString(), target = seatOf(seats, command.action.target);
    entries.push({ at, order: state.messages.length + index, item: { kind: 'event', id: command.id, at, who: 'moderator', seat: target.id, text: `請 ${target.name} 發言`, detail: command.action.task } });
  });
  return entries.sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order).map(entry => entry.item);
}
