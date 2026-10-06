// A speaking grant stores the whole task text the seat is given. Besides what a moderator wrote it can contain sentences the
// scheduler adds (src/room-controller.ts, src/discussion-policy.ts). The strip above the stream shows only the moderator's own
// words; these sentences are pinned to their source by tests/speaking-task.test.ts.
export const FREE_TASKS = [
  'Discuss the original question from your perspective and respond to public peer arguments. Choose useful directions yourself.',
  'Discuss the original question from your own perspective and respond to available peer arguments. Choose useful lines of inquiry yourself.',
];
export const CHECK_TASK = 'Check a specific public peer argument. Explain agreement, disagreement or a revision with reasons; cite that public message as checked. Choose the form of analysis appropriate to the topic.';
export const INVITE_LEAD = 'The moderator invites you to address: ';
export const INVITE_TAIL = 'Respond to this public point alongside any pending task, or explain why another issue should take priority. Keep the original topic and choose your own analysis and conclusion.';

/** `free` and `check` are scheduler defaults (shown as a localized sentence); `text` is someone's own words. `asked` means a moderator invitation was found. */
export type SpeakingTask = { kind: 'free' | 'check' | 'text'; text: string; asked: boolean; more: string };

export function speakingTask(task: string): SpeakingTask {
  const lead = task.indexOf(INVITE_LEAD);
  if (lead >= 0) {
    const after = task.slice(lead + INVITE_LEAD.length), tail = after.lastIndexOf(INVITE_TAIL);
    const directive = (tail >= 0 ? after.slice(0, tail) : after).trim(), base = task.slice(0, lead).trim();
    // A pending task someone wrote travels with the invitation; the scheduler's own default sentences are dropped.
    if (directive) return { kind: 'text', text: directive, asked: true, more: [...FREE_TASKS, CHECK_TASK].includes(base) ? '' : base };
  }
  const text = task.trim();
  return { kind: FREE_TASKS.includes(text) ? 'free' : text === CHECK_TASK ? 'check' : 'text', text, asked: false, more: '' };
}
