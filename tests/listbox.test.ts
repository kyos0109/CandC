import { describe, expect, it } from 'vitest';
import { moveActive, typeahead } from '../web/ui/listbox.js';

describe('select-only combobox keys', () => {
  it('clamps arrow movement at both ends and jumps with Home and End', () => {
    expect(moveActive(0, 3, 'ArrowUp')).toBe(0); expect(moveActive(2, 3, 'ArrowDown')).toBe(2);
    expect(moveActive(0, 3, 'ArrowDown')).toBe(1); expect(moveActive(2, 3, 'ArrowUp')).toBe(1);
    expect(moveActive(1, 3, 'Home')).toBe(0); expect(moveActive(1, 3, 'End')).toBe(2);
    expect(moveActive(0, 0, 'ArrowDown')).toBe(-1);
  });
  it('cycles on a repeated single character and keeps the match for a longer buffer', () => {
    const labels = ['Sonnet', 'Opus', 'Sage', 'Fable'];
    expect(typeahead(labels, 's', 0)).toBe(2); expect(typeahead(labels, 's', 2)).toBe(0);
    expect(typeahead(labels, 'so', 0)).toBe(0); expect(typeahead(labels, 'so', 2)).toBe(0);
    expect(typeahead(labels, 'SA', 0)).toBe(2);
    expect(typeahead(labels, 'z', 0)).toBe(-1); expect(typeahead(labels, '', 0)).toBe(-1); expect(typeahead([], 'a', 0)).toBe(-1);
  });
});
