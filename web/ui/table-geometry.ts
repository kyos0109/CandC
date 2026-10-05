// Pure geometry and copy for the round table. Positions are percentages of a square stage so one layout serves every size.
import type { RoomDiscussion } from '../../src/room-contract.js';

export type Point = { x: number; y: number };
export const TABLE_RADIUS = 34;
const round = (value: number) => Math.round(value * 100) / 100;

/** Seats spread evenly on the ring, the first at twelve o'clock, then clockwise. */
export function tablePositions(count: number): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + index * 2 * Math.PI / Math.max(count, 1);
    return { x: round(50 + TABLE_RADIUS * Math.cos(angle)), y: round(50 + TABLE_RADIUS * Math.sin(angle)) };
  });
}

/** Curve for a hand-off: a spoke from the centre bows sideways; a chord between two seats bows toward the table centre. */
export function arcPath(from: Point, to: Point): string {
  const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2, dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy) || 1;
  const spoke = Math.hypot(from.x - 50, from.y - 50) < 1;
  const nx = spoke ? -dy / length : 50 - mx, ny = spoke ? dx / length : 50 - my, normal = Math.hypot(nx, ny) || 1, bow = spoke ? 9 : 12;
  return `M ${from.x} ${from.y} Q ${round(mx + nx / normal * bow)} ${round(my + ny / normal * bow)} ${to.x} ${to.y}`;
}

/** Same reading as the roster: muted by the moderator, confirmed by a participant proposal, or speaking right now. */
export function seatState(state: Pick<RoomDiscussion, 'room'>, id: string, speaking: string | null) {
  const { muted, proposal, outcome } = state.room;
  const isMuted = muted.includes(id);
  const confirmed = outcome?.authority === 'participants' || !outcome && !!proposal?.confirmed.includes(id);
  return { muted: isMuted, confirmed, speaking: !isMuted && speaking === id };
}

export function tableCaption(input: { status: RoomDiscussion['status']; concluded: boolean; speaking: string | null; name: (id: string) => string }): string {
  if (input.concluded) return '討論已結束';
  if (input.status === 'running') return input.speaking ? (input.speaking === 'moderator' ? '主持人調度中' : `${input.name(input.speaking)} 發言中`) : '準備下一位發言';
  return input.status === 'paused' ? '已暫停' : input.status === 'stopped' ? '已停止' : input.status === 'indeterminate' ? '回覆狀態待確認' : '等待開始';
}
