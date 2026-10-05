import { describe, expect, it } from 'vitest';
import { PROVIDERS, numberSeats, seatIdsFor, seatViews, seatOf } from '../web/seats.js';
import { liveProgress, roomTimeline } from '../web/roomEvents.js';
import type { RoomDiscussion } from '../src/room-contract.js';

const speaker = (id: string, provider: (typeof PROVIDERS)[number], label?: string) => ({ id, provider, role: 'speaker' as const, instructions: '', settings: { model: 'm', effort: null }, ...(label ? { label } : {}) });

describe('seat identity', () => {
  it.each(PROVIDERS)('numbers repeated %s seats and keeps single seats plain', provider => {
    const [first, second] = numberSeats([{ provider }, { provider }]);
    expect(first!.symbol).toMatch(/^[A-Z]1$/); expect(second!.symbol).toMatch(/^[A-Z]2$/);
    expect([first!.alt, second!.alt]).toEqual([false, true]);
    expect(first!.name).not.toBe(second!.name);
    expect(numberSeats([{ provider }])[0]).toMatchObject({ repeated: false, alt: false, name: first!.fallback.replace(/ 1$/, '') });
  });
  it('gives every provider a distinct glyph, so identity is not only a colour', () => {
    const glyphs = PROVIDERS.map(provider => numberSeats([{ provider }])[0]!.symbol);
    expect(new Set(glyphs).size).toBe(PROVIDERS.length);
  });
  it('prefers a trimmed custom label and mixes providers freely', () => {
    const seats = numberSeats([{ provider: 'codex', label: '  Codex · 效能 ' }, { provider: 'codex' }, { provider: 'gemini' }, { provider: 'gemini' }]);
    expect(seats.map(seat => seat.name)).toEqual(['Codex · 效能', 'Codex 2', 'Gemini 1', 'Gemini 2']);
    expect(seats.map(seat => seat.symbol)).toEqual(['C1', 'C2', 'G1', 'G2']);
  });
  it('keeps seat ids compatible with records that used the provider as the id', () => {
    expect(seatIdsFor(['codex', 'claude'])).toEqual(['codex', 'claude']);
    expect(seatIdsFor(['grok', 'grok', 'codex', 'grok'])).toEqual(['grok', 'grok-2', 'codex', 'grok-3']);
  });
  it('builds views with a moderator and falls back for unknown ids', () => {
    const views = seatViews({ participants: [speaker('claude', 'claude', 'Claude · 風險'), speaker('claude-2', 'claude')], moderator: { id: 'moderator', provider: 'codex', role: 'moderator', settings: { model: 'm', effort: null } } });
    expect(views.claude).toMatchObject({ name: 'Claude · 風險', short: '風險', symbol: 'A1', alt: false });
    expect(views['claude-2']).toMatchObject({ name: 'Claude 2', symbol: 'A2', alt: true });
    expect(views.moderator).toMatchObject({ kind: 'moderator', symbol: '主' });
    expect(seatOf(views, 'ghost').name).toBe('ghost');
  });
});

describe('room timeline', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 5, 6, minute)).toISOString();
  const message = (id: string, sender: string, minute: number, text: string, purpose = 'discussion') => ({ id, sender, recipient: 'all', text, round: 1, inReplyTo: null, status: 'completed', createdAt: at(minute), purpose, taskVersion: 1 });
  const state = {
    participants: [speaker('codex', 'codex'), speaker('codex-2', 'codex', 'Codex · 維運')],
    moderator: { id: 'moderator', provider: 'claude', role: 'moderator', settings: { model: 'm', effort: null } },
    messages: [message('1', 'user', 0, 'Topic'), message('2', 'codex', 3, 'Answer'), message('3', 'moderator', 4, '停止發言：codex-2\nRepeats itself.', 'notice'), message('4', 'moderator', 5, '主持人中止本次發言：Too long.', 'notice')],
    room: {
      calls: [{ id: 'c1', startedAt: at(1), durationMs: 60_000 }, { id: 'c2', startedAt: at(2), durationMs: 1000 }],
      commands: [{ id: 'k1', callId: 'c1', applied: true, action: { type: 'speak', target: 'codex-2', task: 'Cost view.' } }, { id: 'k2', callId: 'c2', applied: true, action: { type: 'observe' } }],
    },
  } as unknown as RoomDiscussion;
  it('turns notices and speak grants into events, keeps routine monitoring out, and sorts by saved time', () => {
    const timeline = roomTimeline(state, seatViews(state));
    expect(timeline.map(item => item.kind === 'message' ? `message:${item.message.id}` : `event:${item.text}`)).toEqual([
      'message:1', 'event:請 Codex · 維運 發言', 'message:2', 'event:停止 Codex · 維運 發言', 'event:中止了目前的發言']);
    const mute = timeline[3]!; expect(mute).toMatchObject({ kind: 'event', seat: 'codex-2', detail: 'Repeats itself.' });
    expect(JSON.stringify(timeline)).not.toContain('observe');
  });
});

describe('live progress', () => {
  it('drops a preview whose call is already saved, so it never repeats the saved message', () => {
    const preview = { speaker: 'moderator', preview: 'same text', turnId: 'call-1' };
    expect(liveProgress(preview, [{ id: 'call-0' }])).toBe(preview);
    expect(liveProgress(preview, [{ id: 'call-0' }, { id: 'call-1' }])).toBeNull();
    const unsaved = { speaker: 'codex' };
    expect(liveProgress(unsaved, [{ id: 'call-1' }])).toBe(unsaved);
    expect(liveProgress(null, [])).toBeNull();
  });
});
