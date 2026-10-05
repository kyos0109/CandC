import type { RoomControl } from '../../src/room-contract.js';

// Explicit deterministic delivery data for existing scheduling/authority fixtures.
export function withDelivery(action: RoomControl['action']): RoomControl['action'] {
  if (action.type === 'propose' || action.type === 'finish') return { ...action, delivery: action.delivery ?? { status: 'complete', kind: 'answer', basis: ['Fixture supporting explanation, not live semantic validation.'] } };
  if (action.type === 'confirm') return { ...action, review: action.review ?? { adequate: true, reason: 'Fixture independently assessed the supplied result against the requested answer.', gaps: [] } };
  return action;
}
