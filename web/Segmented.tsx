import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

// Native radios keep arrow-key navigation and form semantics; styling makes them a segmented control.
// A thumb slides to the chosen option. It is measured, so options of any width (and wrapping rows) work.
export function Segmented<T extends string>({ label, name, value, options, onChange, disabled = false }: {
  label: string; name: string; value: T; options: Array<[T, string]>; onChange: (value: T) => void; disabled?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null), [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const element = root.current; if (!element) return;
    const measure = () => {
      const chosen = element.querySelector<HTMLInputElement>('input:checked')?.parentElement;
      if (!chosen || !chosen.offsetWidth) return setBox(null);
      setBox(previous => previous && previous.x === chosen.offsetLeft && previous.y === chosen.offsetTop && previous.w === chosen.offsetWidth && previous.h === chosen.offsetHeight ? previous : { x: chosen.offsetLeft, y: chosen.offsetTop, w: chosen.offsetWidth, h: chosen.offsetHeight });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure); observer?.observe(element);
    // The first position is applied without animation; later changes slide.
    const frame = requestAnimationFrame(() => setReady(true));
    return () => { observer?.disconnect(); cancelAnimationFrame(frame); };
  }, [value, options.length]);
  const style = box ? { '--x': `${box.x}px`, '--y': `${box.y}px`, '--w': `${box.w}px`, '--h': `${box.h}px` } as CSSProperties : undefined;
  return <div className={'segmented' + (box ? ' has-thumb' : '') + (ready ? ' ready' : '')} ref={root} role="radiogroup" aria-label={label} style={style}><span className="seg-thumb" aria-hidden="true"/>{options.map(([option, text]) =>
    <label key={option}><input type="radio" name={name} value={option} checked={value === option} disabled={disabled} onChange={() => onChange(option)}/><span>{text}</span></label>)}</div>;
}
