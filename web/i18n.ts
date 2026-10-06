import { useSyncExternalStore } from 'react';
import { english } from './locales/en.js';

export type Locale = 'zh-TW' | 'en';
const listeners = new Set<() => void>();
const sourceByEnglish = new Map(Object.entries(english).map(([source, value]) => [value, source]));
let locale: Locale = 'zh-TW';
try { if (typeof localStorage !== 'undefined' && localStorage.getItem('candc-locale') === 'en') locale = 'en'; } catch { /* Storage may be disabled by the browser. */ }

export const getLocale = (): Locale => locale;
export const dateLocale = () => locale === 'en' ? 'en-US' : 'zh-TW';
export function setLocale(value: Locale): void {
  if (value !== 'en' && value !== 'zh-TW') return;
  locale = value;
  try { localStorage.setItem('candc-locale', value); } catch { /* Changing language still works without persistence. */ }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = value;
    document.title = `CandC · ${translate('多 AI 討論室')}`;
  }
  for (const listener of listeners) listener();
}
export function useLocale(): Locale {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, getLocale, getLocale);
}

/** Only application-owned messages are translated. Never pass user or model text here. */
export function translate(source: string, ...values: unknown[]): string {
  const message = locale === 'en' ? english[source] ?? source : source;
  return message.replace(/\{(\d+)\}/g, (placeholder, index: string) => Number(index) < values.length ? String(values[Number(index)]) : placeholder);
}

/** Re-renders an already captured application error in the selected language. */
export const systemMessage = (message: string) => translate(sourceByEnglish.get(message) ?? message);
