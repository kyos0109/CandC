import { z } from 'zod';
import type { RoomDiscussion, RoomCall, RoomControl } from './room-contract.js';
import { AppError } from './domain.js';
import { redact } from './redaction.js';

const key = z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/);
const sources = z.array(z.uuid()).min(1).max(20);
const question = z.object({ key, text: z.string().trim().min(1).max(2_000), reason: z.string().max(2_000), sources }).strict();
const task = z.object({ key, kind: z.enum(['research', 'analysis', 'check']), target: z.string().min(1).max(24).optional(),
  task: z.string().trim().min(1).max(4_000), sources }).strict();
const checkpoint = z.object({ answer: z.string().trim().min(1).max(16_000), reasons: z.array(z.string().max(2_000)).max(10),
  dissent: z.array(z.string().max(2_000)).max(10), unknowns: z.array(z.string().max(2_000)).max(20), sources }).strict();
const resolution = z.object({ key, sources }).strict();
export const workReportSchema = z.object({ checkpoint: checkpoint.optional(), questions: z.array(question).max(10).default([]),
  tasks: z.array(task).max(10).default([]), answeredQuestions: z.array(resolution).max(10).default([]),
  completedTasks: z.array(resolution).max(10).default([]) }).strict();
export const workflowSchema = z.object({ version: z.literal(1), revision: z.number().int().nonnegative(),
  questions: z.array(question.extend({ status: z.enum(['pending', 'answered']) })).max(20),
  tasks: z.array(task.extend({ status: z.enum(['pending', 'completed']) })).max(20),
  checkpoint: checkpoint.extend({ actor: z.string(), messageId: z.uuid(), taskVersion: z.number().int().positive(),
    kind: z.enum(['analysis', 'synthesis']) }).nullable() }).strict();
export type Workflow = z.infer<typeof workflowSchema>;
export type WorkReport = z.infer<typeof workReportSchema>;
export const emptyWorkflow = (): Workflow => ({ version: 1, revision: 0, questions: [], tasks: [], checkpoint: null });
const normalized = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Research availability is enforced by the owned adapter, not by a model claim. */
export function runnableTasks(s: RoomDiscussion) {
  return s.room.workflow?.tasks.filter(t => t.status === 'pending' && (t.kind !== 'research' || s.research) &&
    (!t.target || s.participants.some(p => p.id === t.target && !s.room.muted.includes(p.id)))) ?? [];
}
export function continuationTask(s: RoomDiscussion) {
  const revision = s.room.conclusionRequest;
  if (revision && revision.target !== 'moderator') return { target: revision.target, task: revision.reason };
  if (!s.room.workflow) return null;
  const active = s.participants.filter(p => !s.room.muted.includes(p.id));
  if (!active.length) return null;
  const queued = runnableTasks(s)[0];
  if (queued) return { target: queued.target ?? active[0]!.id, task: queued.task, taskKey: queued.key };
  const answers = s.messages.filter(m => m.purpose === 'discussion' && m.status === 'completed' && m.taskVersion === s.room.taskVersion && m.sender !== 'user');
  const missing = active.find(p => !answers.some(m => m.sender === p.id));
  if (missing) return { target: missing.id, task: 'Discuss the original question from your own perspective and respond to available peer arguments. Choose useful lines of inquiry yourself.' };
  const checked = s.room.calls.some(c => c.status === 'completed' && !c.controlDiagnostic && c.purpose === 'discussion' && c.taskVersion === s.room.taskVersion &&
    c.references.some(r => r.disposition === 'checked' && answers.some(m => m.id === r.messageId && m.sender !== c.participant)));
  if (!checked && active.length > 1) return { target: active.find(p => p.id !== answers.at(-1)?.sender)?.id ?? active[0]!.id,
    task: 'Check a specific public peer argument. Explain agreement, disagreement or a revision with reasons; cite that public message as checked. Choose the form of analysis appropriate to the topic.' };
  return null;
}

/** Only eligible public source identities may support shared workflow metadata. */
export function updateWorkflow(s: RoomDiscussion, call: RoomCall, control: RoomControl | null, available: Set<string>, text: string): Workflow | undefined {
  const previous = s.room.workflow;
  if (!previous || call.purpose === 'monitor') return previous;
  if (call.participant === 'moderator' && s.moderatorMode !== 'judge' && call.purpose === 'moderation' && !s.room.outcome) return previous;
  const work = control?.work;
  const workflow = structuredClone(previous);
  const byId = new Map(s.messages.map(m => [m.id, m]));
  const visible = (ids: string[]) => ids.every(id => available.has(id) && byId.get(id)?.recipient === 'all' && byId.get(id)?.status === 'completed');
  if (work) {
    if (call.purpose === 'summary' && [...work.questions, ...work.tasks, ...work.answeredQuestions, ...work.completedTasks].length)
      throw new AppError('WORKFLOW_REFERENCE', 'Summary cannot alter questions or task scheduling.');
    const records = [...work.questions, ...work.tasks, ...work.answeredQuestions, ...work.completedTasks, ...(work.checkpoint ? [work.checkpoint] : [])];
    if (records.some(r => !visible(r.sources)) || work.tasks.some(t => t.target && !s.participants.some(p => p.id === t.target)))
      throw new AppError('WORKFLOW_REFERENCE', 'Workflow sources must be eligible saved public messages and targets must be configured seats.');
    for (const r of work.answeredQuestions) {
      if (!r.sources.some(id => byId.get(id)?.sender === 'user')) throw new AppError('WORKFLOW_REFERENCE', 'Question resolution requires a completed public user message.');
      const q = workflow.questions.find(q => q.key === r.key); if (q) { q.status = 'answered'; q.sources = r.sources; }
    }
    for (const r of work.completedTasks) {
      const t = workflow.tasks.find(t => t.key === r.key);
      if (t?.kind === 'research' && t.status === 'pending' && (!s.research || !call.researchPerformed))
        throw new AppError('WORKFLOW_REFERENCE', 'Research completion requires an observed authorized research tool operation.');
      if (t && (t.target && t.target !== call.participant && !r.sources.some(id => byId.get(id)?.sender === t.target)))
        throw new AppError('WORKFLOW_REFERENCE', 'Task completion requires its assigned speaker evidence.');
      if (t) { t.status = 'completed'; t.sources = r.sources; }
    }
    if (call.purpose !== 'summary') {
      for (const q of work.questions) {
        const old = workflow.questions.find(old => old.key === q.key || normalized(old.text) === normalized(q.text));
        if (old) { if (old.status === 'pending') { old.reason = redact(q.reason); old.sources = q.sources; } }
        else workflow.questions.push({ ...q, text: redact(q.text), reason: redact(q.reason), status: 'pending' });
      }
      for (const t of work.tasks) {
        if (!workflow.tasks.some(old => old.key === t.key || normalized(old.task) === normalized(t.task)))
          workflow.tasks.push({ ...t, task: redact(t.task), status: 'pending' });
      }
    }
    if (work.checkpoint) workflow.checkpoint = { ...work.checkpoint, answer: redact(work.checkpoint.answer),
      reasons: work.checkpoint.reasons.map(s => redact(s)), dissent: work.checkpoint.dissent.map(s => redact(s)), unknowns: work.checkpoint.unknowns.map(s => redact(s)),
      actor: call.participant, messageId: call.id, taskVersion: call.taskVersion, kind: 'synthesis' };
  }
  // Faithful fallback: a saved answer is analysis, never fabricated synthesis or agreement.
  if (!work?.checkpoint && text && (call.purpose === 'discussion' || call.purpose === 'summary')) workflow.checkpoint = {
    answer: text.slice(0, 16_000), reasons: [], dissent: [], unknowns: [], sources: [call.id], actor: call.participant,
    messageId: call.id, taskVersion: call.taskVersion, kind: call.purpose === 'summary' ? 'synthesis' : 'analysis' };
  if (workflow.questions.length > 20) { const pending = workflow.questions.filter(q => q.status === 'pending'); workflow.questions = [...pending, ...workflow.questions.filter(q => q.status === 'answered').slice(0, Math.max(0, 20 - pending.length))]; }
  if (workflow.tasks.length > 20) { const pending = workflow.tasks.filter(t => t.status === 'pending'); workflow.tasks = [...pending, ...workflow.tasks.filter(t => t.status === 'completed').slice(0, Math.max(0, 20 - pending.length))]; }
  if (workflow.questions.length > 20 || workflow.tasks.length > 20) throw new AppError('WORKFLOW_LIMIT', 'Pending workflow capacity reached; consolidate before continuing.');
  workflow.revision++; return workflow;
}

export const activeDiscussionPolicy = 'Discuss the original topic and goal from your assigned perspective. Respond to others, extend useful ideas, ask each other questions and revise your position when warranted. Choose the methods and directions appropriate to the topic; no fixed decision framework or predetermined answer is required. Distinguish facts, assumptions and inference. Use authorized research when useful, cite actual sources and state material uncertainty. Personal input may help, but unanswered questions do not automatically stop independent discussion; reuse existing question keys. Do not end every answer with a questionnaire. Agreement and disagreement both require reasons; neither should be manufactured. In conclusion mode, propose a result when warranted and independently confirm the exact peer proposal only if justified, preserving reservations. Tool permissions, user stop, manual boundaries, execution limits and storage barriers are enforced by the application.';
