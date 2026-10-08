import { describe, expect, it } from 'vitest';
import { sentenceProblem } from '../src/single-sentence.js';
import { roomControlSchema } from '../src/room-contract.js';

describe('single-sentence validation', () => {
  it.each([
    '保留限制，先驗證再決定。', '先確認資料', 'Is this supported?', 'One useful point!',
    'Use version 3.14 for this check.', 'Dr. Smith agrees with Ms. Chen.',
    'Use a sample, e.g. the smallest input.', 'The value, i.e. 3.14, is sufficient.',
    'Read https://example.com/a.b?q=3.14 for details.', 'See https://example.com/a.b.',
    '請參考 https://example.com/a.b 的說明。', '  One sentence.  ',
  ])('accepts %s without rewriting it', text => expect(sentenceProblem(text)).toBeNull());
  it.each([
    ['', 'empty'], ['  ', 'empty'], ['第一句。第二句。', 'sentences'], ['One. Two.', 'sentences'],
    ['Why? Because.', 'sentences'], ['Go! Stop!', 'sentences'],
    ['One.Two.', 'sentences'],
    ['See https://example.com/a.b. Another point.', 'sentences'],
    ['請看 https://example.com/a.b。還有另一句。', 'sentences'],
    ['1.條列', 'format'], ['•條列', 'format'],
    ['第一段\n第二段', 'format'], ['One\n\nparagraph', 'format'], ['One\u2028two', 'format'],
    ['- An item.', 'format'], ['1. An item.', 'format'], ['• An item.', 'format'],
    ['# A heading.', 'format'], ['```code```', 'format'], ['> A block.', 'format'],
  ])('rejects %s as %s', (text, reason) => expect(sentenceProblem(text)).toBe(reason));
  const control = (action: unknown, extra = {}) => roomControlSchema.parse({ version: 3, taskVersion: 1, grantId: null, continuation: 'yield', action, ...extra });
  it('allows faithful excerpts in a partial conclusion without discarding structured meaning', () => {
    const text = 'Use the supplied evidence, but cost is unknown.';
    expect(sentenceProblem(text, control({ type: 'propose', result: text, dissent: [], unresolved: ['cost is unknown'],
      delivery: { status: 'partial', kind: 'answer', basis: ['supplied evidence'] } }))).toBeNull();
  });
  it.each([
    { type: 'propose', result: 'A different answer.', dissent: [], unresolved: [] },
    { type: 'finish', result: 'One point.', dissent: ['Another position.'], unresolved: [] },
    { type: 'confirm', proposalId: '11111111-1111-4111-8111-111111111111', review: { adequate: false, reason: 'One point.', gaps: ['Extra gap.'] } },
    { type: 'speak', target: 'codex', task: 'Extra task.' },
    { type: 'topic', title: 'Extra topic', reason: 'One point.' },
    { type: 'interrupt', reason: 'Extra reason.' },
  ])('rejects additional public prose in $type metadata', action => expect(sentenceProblem('One point.', control(action))).toBe('metadata'));
  it('checks reference and workflow prose as part of the whole response', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(sentenceProblem('One point.', control({ type: 'none' }, { references: [{ messageId: id, disposition: 'checked', reason: 'Extra explanation.' }] }))).toBe('metadata');
    for (const work of [
      { checkpoint: { answer: 'One point.', reasons: [], dissent: [], unknowns: ['Extra limitation.'], sources: [id] } },
      { questions: [{ key: 'question', text: 'Extra question?', reason: '', sources: [id] }] },
      { tasks: [{ key: 'task', kind: 'check', task: 'Extra task.', sources: [id] }] },
    ]) expect(sentenceProblem('One point.', control({ type: 'none' }, { work }))).toBe('metadata');
  });
});
