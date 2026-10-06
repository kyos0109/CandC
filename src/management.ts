import { z } from 'zod';
import { AppError, type Discussion } from './domain.js';
import type { RoomDiscussion } from './room-contract.js';

import { folderSchema, type Management, type Folder, type ManagementAction } from './management-contract.js';
export { folderSchema, managementSchema, managementActionSchema, type Management, type Folder, type ManagementAction } from './management-contract.js';
type State = Discussion | RoomDiscussion;
export function folderOf(state: { management?: Management | undefined }): Folder { return state.management?.folder ?? 'active'; }
export function assertEditable(state: State) {
  if (folderOf(state) !== 'active') throw new AppError('DISCUSSION_READ_ONLY', 'Restore the discussion to the active folder before changing it.');
}
export function changeManagement(state: State, action: ManagementAction, operationId: string, expectedSequence: number): Management | null {
  if (state.management?.operationId === operationId) {
    if (state.management.action !== action) throw new AppError('IDEMPOTENCY_CONFLICT', 'Management operation ID already used.');
    return null;
  }
  if (state.sequence !== expectedSequence) throw new AppError('VERSION_CONFLICT', 'Discussion changed; refresh before managing it.');
  const folder = folderOf(state);
  const next = action === 'archive' && folder === 'active' ? 'archived' : action === 'unarchive' && folder === 'archived' ? 'active' :
    action === 'trash' && folder !== 'trash' ? 'trash' : action === 'restore' && folder === 'trash' ? state.management!.previousFolder! : null;
  if (!next) throw new AppError('INVALID_STATE', 'Management action is not available in this folder.');
  return { folder: next, changedAt: new Date().toISOString(), previousFolder: next === 'trash' ? folder as 'active' | 'archived' : null, operationId, action };
}
export const lastActivity = (state: State) => state.messages.at(-1)?.createdAt ?? state.createdAt;
export function summaryOf(state: State, runtime = false) {
  return { id: state.id, displayName: state.displayName, topic: state.topic.slice(0, 240), backend: state.backend,
    behaviorVersion: state.behaviorVersion, status: state.status, createdAt: state.createdAt, lastActivityAt: lastActivity(state),
    sequence: state.sequence, folder: folderOf(state), management: state.management, storage: state.storage,
    runtime, participants: state.behaviorVersion === 3 ? state.participants.map(p => ({ id: p.id, provider: p.provider })) : [],
    moderator: state.behaviorVersion === 3 && !!state.moderator,
    outcome: state.behaviorVersion === 3 ? state.room.outcome?.authority ?? null : state.v2?.completed ? 'participants' as const : null };
}
export type DiscussionSummary = ReturnType<typeof summaryOf>;
export const indexQuerySchema = z.object({ folder: folderSchema.default('active'), q: z.string().max(32_000).default(''),
  before: z.iso.datetime().optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
export type IndexQuery = z.infer<typeof indexQuerySchema>;
export function matchesIndex(state: State, q: string, before?: string) {
  return (!q || `${state.displayName ?? ''} ${state.topic}`.toLowerCase().includes(q.trim().toLowerCase())) &&
    (!before || lastActivity(state) < before);
}
