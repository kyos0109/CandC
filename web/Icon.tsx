import type { ReactNode } from 'react';

// Small stroke icons for states that must not rely on colour alone. Drawn on a 16px grid, sized by CSS (.icon).
const paths = {
  check: <path d="M3 8.5 6.5 12 13 4.5"/>,
  chevron: <path d="M4 6.5 8 10.5 12 6.5"/>,
  refresh: <path d="M13 3.5v3.2h-3.2M3 12.5V9.3h3.2M12.4 6.7A4.8 4.8 0 0 0 4 5.2M3.6 9.3A4.8 4.8 0 0 0 12 10.8"/>,
  mute: <><path d="M2.5 6v4h2.5L8.5 13V3L5 6z"/><path d="M11 5.5l3 5M14 5.5l-3 5"/></>,
  lock: <><rect x="3" y="7" width="10" height="7" rx="1.8"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7"/></>,
  alert: <><path d="M8 2.5 14 13H2z"/><path d="M8 6.5v3M8 11.3v.1"/></>,
  scale: <path d="M8 2.5v11M4.5 13.5h7M3 5.5h10M3 5.5l-1.5 4a2 2 0 0 0 3 0zM13 5.5l-1.5 4a2 2 0 0 0 3 0z"/>,
  x: <path d="M4 4l8 8M12 4l-8 8"/>,
  plus: <path d="M8 3.5v9M3.5 8h9"/>,
  stop: <rect x="4" y="4" width="8" height="8" rx="1.6"/>,
  pause: <path d="M5.5 3.5v9M10.5 3.5v9"/>,
  reply: <path d="M6.5 4 2.5 8l4 4M3 8h6.5a4 4 0 0 1 4 4"/>,
  copy: <><rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 5.5V4.3a1.8 1.8 0 0 0-1.8-1.8H4.3a1.8 1.8 0 0 0-1.8 1.8v4.4a1.8 1.8 0 0 0 1.8 1.8h1.2"/></>,
} satisfies Record<string, ReactNode>;
export type IconName = keyof typeof paths;
export function Icon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
