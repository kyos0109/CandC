import { describe, it, expect } from 'vitest';
import { redact, safeError } from '../src/redaction.js';
import { evidence } from '../src/research.js';

// Synthetic strings only; no provider credentials are used by these tests.
const fixtures = [
  `github_pat_${'a'.repeat(40)}`, `glpat-${'b'.repeat(24)}`,
  ...['xoxa-', 'xoxb-', 'xoxp-'].map(prefix => `${prefix}${'1234567890-'.repeat(3)}fixture`),
  `npm_${'c'.repeat(36)}`, `AIza${'d'.repeat(35)}`,
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c3ludGhldGljc2lnbmF0dXJl',
];
describe('credential redaction', () => {
  it.each([
    'password="synthetic first second"',
    "secret='synthetic first second'",
    'password="synthetic \\"quoted\\" second"',
    'password="synthetic\nsecond"',
    'password="synthetic first second',
  ])('redacts complete quoted values: %s', text => {
    expect(redact(text)).not.toMatch(/synthetic|second|quoted/);
    expect(redact(text)).toContain('[REDACTED]');
    expect(redact(text, true).split('\n')).toHaveLength(text.split('\n').length);
  });
  it.each(fixtures.map((value, index) => ({ value, index })))('redacts credential fixture $index from text, errors and evidence', ({ value }) => {
    expect(redact(`before ${value} after`)).toBe('before [REDACTED TOKEN] after');
    expect(safeError(new Error(`Failed: ${value}`))).not.toContain(value);
    const result = evidence(`source/${value}`, `text ${value}`);
    expect(result.source).not.toContain(value);
    expect(result.text).not.toContain(value);
  });
  it.each(['//registry.npmjs.org/:_authToken=fixture-value-123', '"_authToken": "fixture-value-123"', '_AUTHTOKEN = fixture-value-123'])('redacts npm credential assignments: %s', text => {
    expect(redact(text)).not.toContain('fixture-value-123');
    expect(redact(text)).toContain('[REDACTED]');
  });
  it('preserves ordinary prose, identifiers and versions', () => {
    const text = 'Use npm_install, github_pat_ documentation, glpat- prefix, and version 1.2.3.';
    expect(redact(text)).toBe(text);
  });
});
