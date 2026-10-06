import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { discussionStateSchema, runEventSchema, type Discussion, type RunEvent } from './domain.js';
import { roomStateSchema, type RoomDiscussion } from './room-contract.js';

export type JournalDiscussion = Discussion | RoomDiscussion;
export type StoredRecord = { event: RunEvent; state: JournalDiscussion };
export class JournalCorruptionError extends Error {}
export const recordSchema = z.object({ event: runEventSchema, state: z.union([discussionStateSchema, roomStateSchema]) });
const nestedPatchSchema = z.object({ set: z.record(z.string(), z.unknown()), append: z.record(z.string(), z.array(z.unknown())),
  replace: z.record(z.string(), z.array(z.object({ index: z.number().int().nonnegative(), value: z.unknown() }).strict())) }).strict();
const compactSchema = z.object({
  version: z.union([z.literal(2), z.literal(3), z.literal(4)]), event: runEventSchema,
  set: z.record(z.string(), z.unknown()),
  append: z.record(z.string(), z.array(z.unknown())),
  references: z.record(z.string(), z.object({ field: z.enum(['messages', 'evidence']), index: z.number().int().nonnegative() }).strict()),
  focused: nestedPatchSchema.optional(), room: nestedPatchSchema.optional(),
}).strict();

export function encode(record: StoredRecord, previous?: JournalDiscussion): string {
  const set: Record<string, unknown> = {}, append: Record<string, unknown[]> = {};
  for (const [key, value] of Object.entries(record.state)) {
    if (key === 'v2' && previous?.v2) continue;
    if (key === 'room' && previous?.behaviorVersion === 3) continue;
    const old = previous ? (previous as unknown as Record<string, unknown>)[key] : undefined;
    if (isDeepStrictEqual(old, value)) continue;
    if (Array.isArray(old) && Array.isArray(value) && old.length <= value.length &&
        old.every((item, index) => isDeepStrictEqual(item, value[index]))) {
      append[key] = value.slice(old.length);
    } else set[key] = value;
  }
  let room: z.infer<typeof nestedPatchSchema> | undefined;
  if (record.state.behaviorVersion === 3 && previous?.behaviorVersion === 3) {
    room = { set: {}, append: {}, replace: {} };
    for (const [key, value] of Object.entries(record.state.room)) {
      const old = previous.room[key as keyof typeof previous.room];
      if (isDeepStrictEqual(old, value)) continue;
      if (Array.isArray(old) && Array.isArray(value) && old.length <= value.length) {
        const changed = old.flatMap((item, index) => isDeepStrictEqual(item, value[index]) ? [] : [{ index, value: value[index] }]);
        if (changed.length) room.replace[key] = changed;
        if (value.length > old.length) room.append[key] = value.slice(old.length);
      } else room.set[key] = value;
    }
  }
  let focused: z.infer<typeof compactSchema>['focused'];
  if (record.state.v2 && previous?.v2) {
    focused = { set: {}, append: {}, replace: {} };
    for (const [key, value] of Object.entries(record.state.v2)) {
      const old = previous.v2[key as keyof typeof previous.v2];
      if (isDeepStrictEqual(old, value)) continue;
      if (Array.isArray(old) && Array.isArray(value) && old.length <= value.length) {
        const changed = old.flatMap((item, index) => isDeepStrictEqual(item, value[index]) ? [] : [{ index, value: value[index] }]);
        if (changed.length) focused.replace[key] = changed;
        if (value.length > old.length) focused.append[key] = value.slice(old.length);
      } else focused.set[key] = value;
    }
  }
  const data = { ...record.event.data };
  const references: Record<string, { field: 'messages' | 'evidence'; index: number }> = {};
  for (const [key, field] of [['message', 'messages'], ['evidence', 'evidence']] as const) {
    if (!(key in data)) continue;
    const index = record.state[field].findIndex(item => isDeepStrictEqual(item, data[key]));
    if (index >= 0) { references[key] = { field, index }; delete data[key]; }
  }
  return JSON.stringify({ version: record.state.behaviorVersion === 3 ? 4 : record.state.behaviorVersion === 2 ? 3 : 2, event: { ...record.event, data }, set, append, references, ...(focused ? { focused } : {}), ...(room ? { room } : {}) });
}

export function decode(text: string, id: string, allowTail = false): StoredRecord[] {
  const lines = text.split('\n'), records: StoredRecord[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line?.trim()) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); }
    catch {
      if (index !== lines.length - 1 || !allowTail) throw new JournalCorruptionError('Discussion journal contains an invalid record.');
      continue;
    }
    let candidate = parsed;
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      const compact = compactSchema.safeParse(parsed);
      if (!compact.success) throw new JournalCorruptionError('Discussion journal contains an invalid compact schema.');
      const { set, append, event, references, focused, room } = compact.data;
      if (compact.data.version === 2 && focused) throw new JournalCorruptionError('Legacy compact records cannot carry focused patches.');
      if (compact.data.version !== 4 && room) throw new JournalCorruptionError('Only version 4 can carry room patches.');
      const state: Record<string, unknown> = { ...records.at(-1)?.state, ...set };
      for (const [key, values] of Object.entries(append)) {
        if (key in set || !['messages', 'evidence', 'operationIds', 'completedInRound', 'roots'].includes(key) || !Array.isArray(state[key])) {
          throw new JournalCorruptionError('Discussion journal contains an invalid array change.');
        }
        state[key] = [...state[key], ...values];
      }
      if (focused) {
        if ('v2' in set || !state.v2 || typeof state.v2 !== 'object') throw new JournalCorruptionError('Invalid focused patch base.');
        const value: Record<string, unknown> = { ...state.v2, ...focused.set };
        for (const key of new Set([...Object.keys(focused.replace), ...Object.keys(focused.append)])) {
          if (key in focused.set || !['issues', 'receipts', 'calls', 'requests', 'operationRecords'].includes(key) || !Array.isArray(value[key])) throw new JournalCorruptionError('Invalid focused array patch.');
          const array: unknown[] = [...value[key]];
          const indices = new Set<number>();
          for (const replacement of focused.replace[key] ?? []) {
            if (replacement.index >= array.length || indices.has(replacement.index)) throw new JournalCorruptionError('Invalid focused replacement index.');
            indices.add(replacement.index); array[replacement.index] = replacement.value;
          }
          value[key] = [...array, ...(focused.append[key] ?? [])];
        }
        state.v2 = value;
      }
      if (room) {
        if ('room' in set || !state.room || typeof state.room !== 'object') throw new JournalCorruptionError('Invalid room patch base.');
        const value: Record<string, unknown> = { ...state.room, ...room.set };
        for (const key of new Set([...Object.keys(room.replace), ...Object.keys(room.append)])) {
          if (key in room.set || !['muted', 'calls', 'commands', 'topicHistory', 'operations', 'interimResults'].includes(key) || !Array.isArray(value[key])) throw new JournalCorruptionError('Invalid room array patch.');
          const array: unknown[] = [...value[key]], indices = new Set<number>();
          for (const replacement of room.replace[key] ?? []) {
            if (replacement.index >= array.length || indices.has(replacement.index)) throw new JournalCorruptionError('Invalid room replacement index.');
            indices.add(replacement.index); array[replacement.index] = replacement.value;
          }
          value[key] = [...array, ...(room.append[key] ?? [])];
        }
        state.room = value;
      }
      const data = { ...event.data };
      for (const [key, reference] of Object.entries(references)) {
        const values = state[reference.field];
        if (key in data || !Array.isArray(values) || reference.index >= values.length) {
          throw new JournalCorruptionError('Discussion journal contains an invalid event reference.');
        }
        data[key] = values[reference.index];
      }
      candidate = { state, event: { ...event, data } };
    }
    const validated = recordSchema.safeParse(candidate);
    if (!validated.success) throw new JournalCorruptionError('Discussion journal contains an invalid schema.');
    const record = validated.data;
    if ((record.state.behaviorVersion === 2 || record.state.behaviorVersion === 3) && !record.event.commitId) throw new JournalCorruptionError('Versioned discussions require a journal commit identity.');
    if (records.length && record.state.behaviorVersion !== records.at(-1)!.state.behaviorVersion) throw new JournalCorruptionError('Discussion behavior cannot change inside a journal.');
    if (record.state.id !== id || record.event.discussionId !== id || record.state.sequence !== record.event.sequence ||
        record.event.sequence !== (records.at(-1)?.event.sequence ?? 0) + 1) {
      throw new JournalCorruptionError('Discussion journal has inconsistent identifiers or sequence numbers.');
    }
    records.push(record);
  }
  return records;
}
