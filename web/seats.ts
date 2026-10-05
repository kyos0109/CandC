import type { ProviderId, RoomDiscussion } from '../src/room-contract.js';

// A seat is one speaking session. The provider is only an attribute of the seat, so identity never assumes one seat per provider.
export const PROVIDERS: ProviderId[] = ['codex', 'claude', 'gemini', 'grok'];
export const providerNames: Record<ProviderId, string> = { codex: 'Codex', claude: 'Claude', gemini: 'Gemini', grok: 'Grok' };
const glyph: Record<ProviderId, string> = { codex: 'C', claude: 'A', gemini: 'G', grok: 'X' };

export type SeatView = { id: string; kind: 'speaker' | 'moderator' | 'user'; provider: ProviderId | null; name: string; short: string; symbol: string; alt: boolean };
export const userSeat: SeatView = { id: 'user', kind: 'user', provider: null, name: '你', short: '你', symbol: '你', alt: false };
const shortName = (name: string) => { const index = name.indexOf(' · '); return index > -1 ? name.slice(index + 3) : name; };

/** Names and glyphs for an ordered seat list. Later seats of one provider are numbered (`C2`) and drawn outlined, so identity is not only a colour. */
export function numberSeats(seats: ReadonlyArray<{ provider: ProviderId; label?: string | undefined }>) {
  const total: Partial<Record<ProviderId, number>> = {}, seen: Partial<Record<ProviderId, number>> = {};
  for (const seat of seats) total[seat.provider] = (total[seat.provider] ?? 0) + 1;
  return seats.map(seat => {
    const ordinal = seen[seat.provider] = (seen[seat.provider] ?? 0) + 1, repeated = (total[seat.provider] ?? 0) > 1;
    const fallback = providerNames[seat.provider] + (repeated ? ` ${ordinal}` : '');
    return { symbol: glyph[seat.provider] + (repeated ? String(ordinal) : ''), alt: ordinal > 1, repeated, fallback, name: seat.label?.trim() || fallback };
  });
}

/** Seat IDs stay compatible with older records: the first seat of a provider uses the provider ID, later ones use `provider-2`, `provider-3`. */
export function seatIdsFor(providers: ReadonlyArray<ProviderId>): string[] {
  const seen: Partial<Record<ProviderId, number>> = {};
  return providers.map(provider => { const ordinal = seen[provider] = (seen[provider] ?? 0) + 1; return ordinal === 1 ? provider : `${provider}-${ordinal}`; });
}

export function seatViews(state: Pick<RoomDiscussion, 'participants' | 'moderator'>): Record<string, SeatView> {
  const numbered = numberSeats(state.participants.map(p => ({ provider: p.provider, label: p.label })));
  const views: Record<string, SeatView> = { user: userSeat };
  state.participants.forEach((p, index) => {
    const seat = numbered[index]!;
    views[p.id] = { id: p.id, kind: 'speaker', provider: p.provider, name: seat.name, short: shortName(seat.name), symbol: seat.symbol, alt: seat.alt };
  });
  if (state.moderator) views.moderator = { id: 'moderator', kind: 'moderator', provider: state.moderator.provider, name: '主持人', short: '主持人', symbol: '主', alt: false };
  return views;
}
/** A provider on its own (connections page, provider pickers), before it has a seat. */
export const providerSeat = (provider: ProviderId): SeatView => ({ id: provider, kind: 'speaker', provider, name: providerNames[provider], short: providerNames[provider], symbol: glyph[provider], alt: false });
export const seatOf = (views: Record<string, SeatView>, id: string): SeatView =>
  views[id] ?? { id, kind: 'speaker', provider: null, name: id, short: id, symbol: id.slice(0, 1).toUpperCase(), alt: false };
