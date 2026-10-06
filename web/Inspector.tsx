import { translate } from './i18n.js';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function useNarrow(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const update = () => setMatches(media.matches);
    media.addEventListener('change', update); update();
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

// `focus` is off for a panel the app opened by itself (the default participants dock), so opening a room never steals focus from the composer.
export function Inspector({ title, modal, onClose, children, side = 'right', focus = true }: { title: string; modal: boolean; onClose: () => void; children: ReactNode; side?: 'left' | 'right'; focus?: boolean }) {
  const container = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = container.current!;
    const controls = () => [...panel.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter(el => el.getClientRects().length > 0);
    if (focus) controls()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (!modal || event.key !== 'Tab') return;
      const items = controls(), first = items[0], last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    const contain = (event: FocusEvent) => { if (modal && !panel.contains(event.target as Node)) controls()[0]?.focus(); };
    document.addEventListener('keydown', key); document.addEventListener('focusin', contain);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('focusin', contain); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, [modal]);
  return <>{modal && <div className="drawer-backdrop" onClick={onClose}/>}
    <aside ref={container} className={`inspector ${modal ? 'overlay' : 'docked'} ${side}`} role={modal ? 'dialog' : 'complementary'} aria-modal={modal || undefined} aria-label={title}>
      <header><h2>{title}</h2><button aria-label={translate("關閉{0}", title)} onClick={onClose}>×</button></header><div className="inspector-content">{children}</div>
    </aside></>;
}
