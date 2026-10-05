// Pure keyboard helpers for a select-only combobox (WAI-ARIA APG pattern). Kept free of DOM so they can be unit tested.
export type ListKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

export function moveActive(index: number, count: number, key: ListKey): number {
  if (count <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return key === 'ArrowDown' ? Math.min(count - 1, index + 1) : Math.max(0, index - 1);
}

/**
 * Index of the next entry whose text starts with the typed buffer, or -1.
 * A single character searches after the current entry, so pressing it repeatedly cycles; a longer buffer may keep the current entry.
 */
export function typeahead(labels: readonly string[], buffer: string, from: number): number {
  const wanted = buffer.toLowerCase(), count = labels.length;
  if (!wanted || count === 0) return -1;
  const start = wanted.length === 1 ? from + 1 : Math.max(from, 0);
  for (let step = 0; step < count; step++) {
    const index = (start + step + count) % count;
    if (labels[index]!.toLowerCase().startsWith(wanted)) return index;
  }
  return -1;
}
