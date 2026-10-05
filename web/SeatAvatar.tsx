import { Icon } from './Icon.js';
import type { SeatView } from './seats.js';

export type SeatBadge = 'ok' | 'mute' | 'alert';
// Circle = AI seat, rounded square = moderator, filled = you. Later seats of one provider are outlined and numbered (see seats.ts).
export function SeatAvatar({ seat, size, state, badge }: { seat: SeatView; size?: 'sm' | 'lg'; state?: 'speaking' | 'muted' | undefined; badge?: SeatBadge | undefined }) {
  const kind = seat.kind === 'moderator' ? 'moderator' : seat.kind === 'user' ? 'me' : `k-${seat.provider ?? 'other'}`;
  const cls = ['seat-avatar', kind, seat.alt && 'alt', size, state].filter(Boolean).join(' ');
  return <span className={cls} aria-hidden="true">{seat.symbol}{badge && <span className={'seat-badge ' + badge}><Icon name={badge === 'ok' ? 'check' : badge === 'mute' ? 'mute' : 'alert'}/></span>}</span>;
}
