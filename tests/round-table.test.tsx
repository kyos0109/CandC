import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RoundTable } from '../web/ui/RoundTable.js';
import { arcPath, seatState, tableCaption, tablePositions } from '../web/ui/table-geometry.js';
import { seatViews } from '../web/seats.js';
import type { RoomDiscussion } from '../src/room-contract.js';

const seat = (id: string, provider: string) => ({ id, provider, role: 'speaker', instructions: '', settings: { model: 'm', effort: null } });
const room = (over: Record<string, unknown> = {}) => ({ muted: [], grant: null, proposal: null, outcome: null, currentSpeaker: null, ...over });
const discussion = (over: { moderator?: boolean; status?: string; room?: Record<string, unknown> } = {}) => ({
  status: over.status ?? 'running', participants: [seat('codex', 'codex'), seat('gemini', 'gemini'), seat('gemini-2', 'gemini')],
  moderator: over.moderator === false ? null : { id: 'moderator', provider: 'codex', role: 'moderator', instructions: '', settings: { model: 'm', effort: null } }, room: room(over.room),
}) as unknown as RoomDiscussion;
const render = (state: RoomDiscussion, speaking: string | null, variant?: 'dock' | 'mini') => renderToStaticMarkup(<RoundTable state={state} seats={seatViews(state)} speaking={speaking} variant={variant}/>);

describe('round table geometry', () => {
  it('spreads seats evenly from twelve o\'clock, clockwise', () => {
    expect(tablePositions(0)).toEqual([]); expect(tablePositions(1)).toEqual([{ x: 50, y: 16 }]);
    expect(tablePositions(2)).toEqual([{ x: 50, y: 16 }, { x: 50, y: 84 }]);
    expect(tablePositions(4)).toEqual([{ x: 50, y: 16 }, { x: 84, y: 50 }, { x: 50, y: 84 }, { x: 16, y: 50 }]);
    const three = tablePositions(3); expect(three[0]).toEqual({ x: 50, y: 16 }); expect(three[1]!.x).toBeGreaterThan(50); expect(three[2]!.x).toBeLessThan(50); expect(three[1]!.y).toBe(three[2]!.y);
  });
  it('bows a spoke sideways and a chord toward the centre', () => {
    expect(arcPath({ x: 50, y: 50 }, { x: 50, y: 16 })).toBe('M 50 50 Q 59 33 50 16');
    expect(arcPath({ x: 50, y: 16 }, { x: 84, y: 50 })).toBe('M 50 16 Q 58.51 41.49 84 50');
  });
});

describe('round table reading of the room', () => {
  it('mirrors the roster: muted wins over speaking, and a confirmation counts only for participant authority', () => {
    const state = discussion({ room: { muted: ['gemini'], proposal: { confirmed: ['codex'] } } });
    expect(seatState(state, 'gemini', 'gemini')).toEqual({ muted: true, confirmed: false, speaking: false });
    expect(seatState(state, 'codex', 'gemini')).toEqual({ muted: false, confirmed: true, speaking: false });
    const ended = discussion({ room: { outcome: { authority: 'moderator' }, proposal: { confirmed: ['codex'] } } });
    expect(seatState(ended, 'codex', null).confirmed).toBe(false);
    expect(seatState(discussion({ room: { outcome: { authority: 'participants' } } }), 'codex', null).confirmed).toBe(true);
  });
  it('captions the table from saved state only', () => {
    const name = (id: string) => id === 'gemini-2' ? 'Gemini 2' : id;
    expect(tableCaption({ status: 'running', concluded: false, speaking: 'gemini-2', name })).toBe('Gemini 2 發言中');
    expect(tableCaption({ status: 'running', concluded: false, speaking: 'moderator', name })).toBe('主持人調度中');
    expect(tableCaption({ status: 'running', concluded: false, speaking: null, name })).toBe('準備下一位發言');
    expect(tableCaption({ status: 'paused', concluded: false, speaking: null, name })).toBe('已暫停');
    expect(tableCaption({ status: 'ready', concluded: false, speaking: null, name })).toBe('等待開始');
    expect(tableCaption({ status: 'running', concluded: true, speaking: 'codex', name })).toBe('討論已結束');
  });
});

describe('round table rendering', () => {
  it('shows one speaker, numbers repeated seats, marks muted seats and never animates a hand-off on first render', () => {
    const html = render(discussion({ room: { muted: ['codex'] } }), 'gemini-2');
    expect(html).toContain('aria-hidden="true"'); expect(html.match(/data-state="speaking"/g)).toHaveLength(1); expect(html.match(/data-state="muted"/g)).toHaveLength(1);
    expect(html).toContain('Gemini 2 發言中'); expect(html).toContain('>G2<'); expect(html).toContain('seat-badge mute'); expect(html).not.toContain('rt-arc');
  });
  it('puts the moderator at the centre only when there is one, and caps the header version to dots', () => {
    expect(render(discussion(), null)).toContain('rt-mod'); expect(render(discussion({ moderator: false }), null)).not.toContain('rt-mod');
    const mini = render(discussion(), 'moderator', 'mini');
    expect(mini).toContain('rt-dot mod speaking'); expect(mini).not.toContain('figcaption'); expect(mini).not.toContain('seat-avatar');
  });
  it('shows confirmation ticks while a proposal is open', () => {
    const html = render(discussion({ moderator: false, room: { proposal: { confirmed: ['codex', 'gemini'] } } }), null);
    expect(html.match(/seat-badge ok/g)).toHaveLength(2);
  });
});
