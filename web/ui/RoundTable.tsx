import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { RoomDiscussion } from '../../src/room-contract.js';
import { SeatAvatar } from '../SeatAvatar.js';
import { seatOf, type SeatView } from '../seats.js';
import { arcPath, seatState, tableCaption, tablePositions, type Point } from './table-geometry.js';

type Props = { state: RoomDiscussion; seats: Record<string, SeatView>; speaking: string | null; variant?: 'dock' | 'mini' | undefined };
const CENTRE: Point = { x: 50, y: 50 };
const at = (point: Point) => ({ left: `${point.x}%`, top: `${point.y}%` });
const tint = (name: string | null) => ({ '--dot': name ? `var(--${name})` : 'var(--accent)' }) as CSSProperties;

/**
 * Who has the floor, drawn as a table. Seats sit on a ring, the moderator at the centre.
 * When the moderator grants a turn (or, without a moderator, the floor passes on) a short arc is drawn between the two.
 * Purely presentational and aria-hidden: the status pill and the message list already carry the same facts as text.
 */
export function RoundTable({ state, seats, speaking, variant = 'dock' }: Props) {
  const positions = useMemo(() => tablePositions(state.participants.length), [state.participants.length]);
  const grant = state.room.grant, moderator = state.moderator, grantId = grant?.id ?? null;
  const [hand, setHand] = useState<{ key: number; from: string; to: string } | null>(null);
  const counter = useRef(0), lastGrant = useRef(grantId), lastSpeaker = useRef(speaking);
  // The first render never animates: only a change after mount is a hand-off.
  useEffect(() => {
    const changed = grantId !== lastGrant.current; lastGrant.current = grantId;
    if (changed && moderator && grant) setHand({ key: ++counter.current, from: 'moderator', to: grant.target });
  }, [grantId]);
  useEffect(() => {
    if (!speaking) return;
    const from = lastSpeaker.current; lastSpeaker.current = speaking;
    if (!moderator && from && from !== speaking) setHand({ key: ++counter.current, from, to: speaking });
  }, [speaking]);

  const nodes = state.participants.map((p, index) => ({ id: p.id, point: positions[index]!, seat: seatOf(seats, p.id), ...seatState(state, p.id, speaking) }));
  const pointOf = (id: string) => id === 'moderator' ? CENTRE : nodes.find(node => node.id === id)?.point;
  const from = hand ? pointOf(hand.from) : undefined, to = hand ? pointOf(hand.to) : undefined;
  const caption = tableCaption({ status: state.status, concluded: !!state.room.outcome, speaking, name: id => seatOf(seats, id).name });

  return <figure className={`round-table ${variant}`} aria-hidden="true">
    <div className="rt-stage">
      <span className="rt-surface"/>
      <svg className="rt-svg" viewBox="0 0 100 100"><circle className="rt-ring" cx="50" cy="50" r="34"/>{variant === 'dock' && hand && from && to && <path key={hand.key} className="rt-arc" d={arcPath(from, to)} pathLength={1}/>}</svg>
      {moderator && (variant === 'dock'
        ? <span className="rt-mod" style={at(CENTRE)}><SeatAvatar seat={seatOf(seats, 'moderator')} size="sm" state={speaking === 'moderator' ? 'speaking' : undefined}/></span>
        : <span className={'rt-dot mod' + (speaking === 'moderator' ? ' speaking' : '')} style={{ ...at(CENTRE), ...tint('moderator') }}/>)}
      {nodes.map(node => <span key={node.id} className="rt-seat" data-state={node.muted ? 'muted' : node.speaking ? 'speaking' : 'idle'} style={{ ...at(node.point), ...tint(node.seat.provider) }}>
        {variant === 'dock'
          ? <><span className="rt-spot"/><SeatAvatar seat={node.seat} state={node.muted ? 'muted' : node.speaking ? 'speaking' : undefined} badge={node.muted ? 'mute' : node.confirmed ? 'ok' : undefined}/></>
          : <span className="rt-dot"/>}
      </span>)}
    </div>
    {variant === 'dock' && <figcaption className="rt-caption" key={caption}>{caption}</figcaption>}
  </figure>;
}
