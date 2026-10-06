import { ROOM_CONTROL_START, ROOM_CONTROL_END } from '../../src/room-contract.js';

// Sanitized shapes of the three observed native outputs; no user history is read.
export const misplacedDeliveryCases = [
  { name: 'initial proposal with a response reference', continuation: 'done', references: true },
  { name: 'resumed proposal without references', continuation: 'done', references: false },
  { name: 'research-enabled proposal yielding to a peer', continuation: 'yield', references: true },
] as const;

export function moveDeliveryOutsideAction(text: string): string {
  const [answer, envelope] = text.split(ROOM_CONTROL_START);
  const control = JSON.parse(envelope!.split(ROOM_CONTROL_END)[0]!);
  const { delivery, ...action } = control.action;
  return `${answer}${ROOM_CONTROL_START}\n${JSON.stringify({ ...control, action, delivery })}\n${ROOM_CONTROL_END}`;
}
