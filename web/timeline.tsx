import { translate, dateLocale } from './i18n.js';
import type { ReactNode } from 'react';

type Stamped = { createdAt: string; sender: string; round: number };
// Day and round dividers come from saved timestamps and round numbers only; they do not infer hand-offs.
// Returns one divider list per message, in message order.
export function timelineDividers(messages: ReadonlyArray<Stamped>): ReactNode[] {
  let day = '', round = 0;
  return messages.map(message => {
    const date = new Date(message.createdAt), parts: ReactNode[] = [];
    if (date.toDateString() !== day) {
      day = date.toDateString();
      const time = date.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', hour12: false });
      parts.push(<div key="day" className="day-divider">{day === new Date().toDateString() ? translate("今天") : translate("{0} 月 {1} 日", date.getMonth() + 1, date.getDate())} {time}</div>);
    }
    if (message.sender !== 'user' && message.round > round) { round = message.round; parts.push(<div key="round" className="round-divider">{translate("第 {0} 輪", round)}</div>); }
    return parts;
  });
}
