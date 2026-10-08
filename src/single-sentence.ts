import type { RoomControl } from './room-contract.js';
import { redact } from './redaction.js';

export type SentenceProblem = 'empty' | 'format' | 'sentences' | 'metadata';
const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

export const singleSentencePolicy = 'Single-sentence mode applies to every response, including openings, moderation, summaries, proposals and peer reviews. Write exactly one short sentence expressing one main point, with no lists, headings, code blocks or line breaks. Do not chain many points with commas. This rule overrides other length or response-form guidance, but never changes evidence, privacy, authority or completion requirements. Keep the required control envelope on its own lines. All human-readable control fields (result, reasons, dissent, unresolved, delivery basis, review reason/gaps, references and work reports) must repeat that sentence or quote a contiguous excerpt from it; they must not add prose absent from the public sentence. Omit unnecessary optional reports. Preserve IDs, source references, verdicts and other machine fields, and retain honest limitations in the sentence itself.';

/** Mask common non-boundary periods without modifying the answer that is saved. */
function segmentationText(text: string): string {
  return text
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>「」『』“”。！？]+/giu, url => {
      const suffix = /[.!?。！？]+$/.exec(url)?.[0] ?? '';
      return 'URL' + suffix;
    })
    .replace(/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St)\.(?=\s+\p{L})/gu, word => word.replace('.', '∎'))
    .replace(/\b(?:e\.g|i\.e)\.(?=\s+\S)/gu, word => word.replaceAll('.', '∎'))
    .replace(/(?<=[\p{L}]{2})\.(?=\p{Lu})/gu, '. ');
}

function publicMetadata(control: RoomControl): string[] {
  const prose = control.references.map(reference => reference.reason);
  const action = control.action;
  switch (action.type) {
    case 'propose': case 'finish':
      prose.push(action.result, ...action.dissent, ...action.unresolved, ...(action.delivery?.basis ?? [])); break;
    case 'confirm':
      if (action.review) prose.push(action.review.reason, ...action.review.gaps); break;
    case 'speak': prose.push(action.task); break;
    case 'topic': prose.push(action.title, action.reason); break;
    case 'interrupt': case 'mute': case 'unmute': case 'pause': prose.push(action.reason); break;
  }
  const work = control.work;
  if (work) {
    if (work.checkpoint) prose.push(work.checkpoint.answer, ...work.checkpoint.reasons, ...work.checkpoint.dissent, ...work.checkpoint.unknowns);
    for (const question of work.questions) prose.push(question.text, question.reason);
    for (const task of work.tasks) prose.push(task.task);
  }
  return prose;
}

export function sentenceProblem(text: string, control?: RoomControl | null): SentenceProblem | null {
  const sentence = text.trim();
  if (!sentence) return 'empty';
  if (/[\r\n\u2028\u2029]/u.test(sentence) || /^(?:[-*+]\s|[•‣]|\d+[.)、](?!\d)|#{1,6}\s|>|```|~~~|\|)/u.test(sentence)) return 'format';
  const segments = [...segmenter.segment(segmentationText(sentence))].filter(part => part.segment.trim());
  if (segments.length !== 1) return 'sentences';
  // Public metadata can describe the same sentence, never extend it into another answer.
  if (control && publicMetadata(control).some(value => redact(value).trim() && !sentence.includes(redact(value).trim()))) return 'metadata';
  return null;
}
