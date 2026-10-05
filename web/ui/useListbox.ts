import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { moveActive, typeahead } from './listbox.js';

type Options = {
  id: string; count: number; labels: readonly string[]; selected: number; disabled: boolean;
  /** Scroll the active row into view only while the list itself is showing (not a custom-entry form). */
  listVisible?: boolean; onCommit: (index: number) => void; onOpen?: () => void;
};

/**
 * Behaviour of a select-only combobox (WAI-ARIA APG): focus stays on the trigger, arrows move an active option, typing jumps to a match,
 * Enter/Space commit, Escape closes and returns focus, Tab and outside clicks close without changing the value.
 * The popover opens upwards when it would run off the bottom of the window.
 */
export function useListbox({ id, count, labels, selected, disabled, listVisible = true, onCommit, onOpen }: Options) {
  const [open, setOpen] = useState(false), [active, setActive] = useState(0), [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLDivElement>(null), typed = useRef({ text: '', timer: 0 });
  const optionId = (index: number) => `${id}-o${index}`;
  const close = (refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  const openList = () => { onOpen?.(); setActive(selected >= 0 ? selected : 0); setOpen(true); };

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const box = trigger.current.getBoundingClientRect(), below = window.innerHeight - box.bottom;
    setUp(below < Math.min(288, count * 52 + 12) && box.top > below);
  }, [open, count]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => { if (open && listVisible) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' }); }, [open, active, listVisible, id]);
  useEffect(() => () => window.clearTimeout(typed.current.timer), []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || event.nativeEvent.isComposing) return;
    const key = event.key;
    if (!open) { if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') { event.preventDefault(); openList(); } return; }
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') { event.preventDefault(); setActive(moveActive(active, count, key)); }
    else if (key === 'Enter' || (key === ' ' && !typed.current.text)) { event.preventDefault(); onCommit(active); }
    else if (key === 'Escape') { event.preventDefault(); close(); }
    else if (key === 'Tab') close(false);
    else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      window.clearTimeout(typed.current.timer); typed.current.text += key; typed.current.timer = window.setTimeout(() => { typed.current.text = ''; }, 600);
      const hit = typeahead(labels, typed.current.text, active);
      if (hit >= 0) setActive(hit);
    }
  };
  return { open, active, setActive, up, root, trigger, close, openList, onKeyDown, optionId, toggle: () => { if (!disabled) open ? close() : openList(); } };
}
