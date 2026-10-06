import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { CHECK_TASK, FREE_TASKS, INVITE_LEAD, INVITE_TAIL, speakingTask } from '../web/speakingTask.js';

// The same composition as src/room-controller.ts: the pending or default task, then the moderator's invitation when there is one.
const composed = (pending: string | null, invitation?: string) => (pending ?? FREE_TASKS[0]) + (invitation ? `\n${INVITE_LEAD}${invitation}\n${INVITE_TAIL}` : '');

describe('the task text behind the "moderator hands the floor" strip', () => {
  it('uses the sentences the scheduler really writes', async () => {
    const source = await readFile('src/room-controller.ts', 'utf8') + await readFile('src/discussion-policy.ts', 'utf8');
    for (const sentence of [...FREE_TASKS, CHECK_TASK, INVITE_LEAD.trim(), INVITE_TAIL]) expect(source, sentence).toContain(sentence);
  });
  it('shows only the moderator\'s own words from an invitation', () => {
    const task = speakingTask(composed(null, '請回應 Claude 認為剩餘分歧主要是語氣與預設的判斷。'));
    expect(task).toEqual({ kind: 'text', text: '請回應 Claude 認為剩餘分歧主要是語氣與預設的判斷。', asked: true, more: '' });
  });
  it('keeps a multi-line directive and a pending task someone wrote', () => {
    expect(speakingTask(composed('先核對成本數字。', '第一點\n第二點'))).toEqual({ kind: 'text', text: '第一點\n第二點', asked: true, more: '先核對成本數字。' });
  });
  it('still finds the directive when the closing sentence is missing', () => {
    expect(speakingTask(`${FREE_TASKS[0]}\n${INVITE_LEAD}請補充反例。`)).toMatchObject({ text: '請補充反例。', asked: true });
  });
  it('marks the scheduler defaults so they can be shown as a localized sentence', () => {
    for (const task of FREE_TASKS) expect(speakingTask(task)).toMatchObject({ kind: 'free', asked: false });
    expect(speakingTask(CHECK_TASK)).toMatchObject({ kind: 'check', asked: false });
  });
  it('shows any other task as written', () => {
    expect(speakingTask('  請 Gemini 比較兩個方案的成本。 ')).toEqual({ kind: 'text', text: '請 Gemini 比較兩個方案的成本。', asked: false, more: '' });
    expect(speakingTask('')).toMatchObject({ kind: 'text', text: '' });
  });
});
