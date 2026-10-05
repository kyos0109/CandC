import { z } from 'zod';
import { focusedStateSchema, type FocusedState } from './v2-contract.js';

export const agentIdSchema = z.enum(['codex', 'claude']);
export type AgentId = z.infer<typeof agentIdSchema>;
export const settingsSchema = z.object({
  model: z.string().trim().min(1).max(160),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
}).strict();
export type AgentSettings = z.infer<typeof settingsSchema>;
export const discussionInputSchema = z.object({
  displayName: z.string().trim().max(120).optional(),
  behaviorVersion: z.union([z.literal(1), z.literal(2)]).default(2),
  goal: z.string().trim().max(32_000).default(''),
  constraints: z.string().trim().max(32_000).default(''),
  focused: z.boolean().default(true),
  topic: z.string().trim().min(1).max(32_000),
  mode: z.enum(['auto', 'manual', 'conclusion']).default('manual'),
  flow: z.enum(['alternating', 'free']).default('free'),
  backend: z.enum(['fake', 'live']).default('fake'),
  kind: z.enum(['discussion', 'debate']).default('discussion'),
  roles: z.object({ codex: z.string().max(4_000), claude: z.string().max(4_000) }).default({ codex: '', claude: '' }),
  research: z.boolean().default(false),
  roots: z.array(z.string().min(1).max(1_000)).max(8).default([]),
  agents: z.object({ codex: settingsSchema, claude: settingsSchema }).strict(),
  limits: z.object({
    maxRounds: z.number().int().min(1).max(1_000).default(50),
    maxDurationMs: z.number().int().min(100).max(86_400_000).default(14_400_000),
    turnTimeoutMs: z.number().int().min(50).max(3_600_000).default(600_000),
  }).strict().default({ maxRounds: 50, maxDurationMs: 14_400_000, turnTimeoutMs: 600_000 }),
}).strict();
export type DiscussionInput = z.infer<typeof discussionInputSchema>;
export type Message = z.infer<typeof messageSchema>;
export type AgentSession = { id: string; model: string; backend: 'fake' | 'live' };
export type DiscussionStatus = 'ready' | 'running' | 'paused' | 'stopped' | 'indeterminate';
export type Discussion = DiscussionInput & {
  displayVersion?: number | undefined;
  id: string;
  backend: 'fake' | 'live';
  status: DiscussionStatus;
  round: number;
  nextSpeaker: AgentId;
  completedInRound: AgentId[];
  sessions: Partial<Record<AgentId, AgentSession>>;
  messages: Message[];
  createdAt: string;
  elapsedMs: number;
  pauseReason: string | null;
  operationIds: string[];
  sequence: number;
  rolesConfirmed: boolean;
  activity: 'discussion' | 'roles' | 'summary' | null;
  evidence: Evidence[];
  v2?: FocusedState | undefined;
  storage?: { status: 'unconfirmed'; reason: string };
};
export type Evidence = { source: string; text: string; sha256: string; retrievedAt: string; truncated: boolean; owner?: AgentId | undefined; generation?: string | undefined };
export type RunEvent = {
  sequence: number;
  discussionId: string;
  type: 'created' | 'state' | 'session' | 'message' | 'progress' | 'evidence' | 'error' | 'recovered';
  at: string;
  data: Record<string, unknown>;
  commitId?: string | undefined;
};
const messageSchema = z.object({
  id: z.uuid(), sender: z.union([agentIdSchema, z.literal('user')]),
  recipient: z.union([agentIdSchema, z.literal('both')]), text: z.string(),
  round: z.number().int().nonnegative(), inReplyTo: z.uuid().nullable(),
  status: z.enum(['completed', 'cancelled', 'indeterminate']), createdAt: z.iso.datetime(),
  purpose: z.enum(['discussion', 'roles', 'summary']).optional(),
  continuation: z.enum(['continue', 'yield', 'done', 'conclude']).optional(),
  conclusionRef: z.uuid().optional(),
  inputMessageId: z.uuid().optional(),
  issueId: z.uuid().nullable().optional(), issueVersion: z.number().int().positive().nullable().optional(),
  taskVersion: z.number().int().positive().optional(), responseTarget: z.uuid().nullable().optional(),
  responseRefs: z.array(z.uuid()).optional(), annotation: z.enum(['valid', 'invalid', 'unmarked']).optional(),
});
const stateSchema = discussionInputSchema.extend({
  displayVersion: z.number().int().nonnegative().optional(),
  behaviorVersion: z.union([z.literal(1), z.literal(2)]).default(1),
  flow: z.enum(['alternating', 'free']).default('alternating'),
  id: z.uuid(), backend: z.enum(['fake', 'live']), status: z.enum(['ready', 'running', 'paused', 'stopped', 'indeterminate']),
  round: z.number().int().positive(), nextSpeaker: agentIdSchema, completedInRound: z.array(agentIdSchema).max(2),
  sessions: z.object({
    codex: z.object({ id: z.string().min(1), model: z.string(), backend: z.enum(['fake', 'live']) }).optional(),
    claude: z.object({ id: z.string().min(1), model: z.string(), backend: z.enum(['fake', 'live']) }).optional(),
  }).strict().transform(({ codex, claude }) => ({ ...(codex ? { codex } : {}), ...(claude ? { claude } : {}) })),
  messages: z.array(messageSchema), createdAt: z.iso.datetime(), elapsedMs: z.number().nonnegative(),
  pauseReason: z.string().nullable(), operationIds: z.array(z.uuid()), sequence: z.number().int().positive(),
  rolesConfirmed: z.boolean().default(false), activity: z.enum(['discussion', 'roles', 'summary']).nullable().default(null),
  evidence: z.array(z.object({ source: z.string(), text: z.string(), sha256: z.string(), retrievedAt: z.string(), truncated: z.boolean(), owner: agentIdSchema.optional(), generation: z.uuid().optional() })).default([]),
  v2: focusedStateSchema.optional(),
}).superRefine((state, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (state.behaviorVersion === 1) { if (state.v2) fail('Legacy discussions cannot carry focused state.'); return; }
  const v2 = state.v2;
  if (!v2) { fail('Version 2 requires focused state.'); return; }
  const messages = new Map(state.messages.map(m => [m.id, m]));
  const issues = new Map(v2.issues.map(i => [i.id, i]));
  if (messages.size !== state.messages.length || issues.size !== v2.issues.length) fail('Duplicate public identity.');
  const active = v2.issues.filter(i => i.status === 'active' || i.status === 'blocked');
  if (active.length > 1 || (v2.currentIssueId === null ? active.length !== 0 : active[0]?.id !== v2.currentIssueId)) fail('Current issue must match the single active issue.');
  for (const m of state.messages) {
    if (m.issueId === undefined || m.issueVersion === undefined || m.taskVersion === undefined || m.responseTarget === undefined) fail('Version 2 messages require task and issue attribution.');
    if ((m.issueId === null) !== (m.issueVersion === null)) fail('Issue identity and version must be paired.');
    if (m.issueId && (!issues.has(m.issueId) || m.issueVersion === null || m.issueVersion! > issues.get(m.issueId)!.version)) fail('Unknown message issue.');
    if (m.responseTarget && !messages.has(m.responseTarget)) fail('Unknown response target.');
  }
  for (const i of v2.issues) {
    if (i.proposal && messages.get(i.proposal.messageId)?.sender !== i.proposal.author) fail('Unknown proposal source.');
    if (i.confirmation && messages.get(i.confirmation.messageId)?.sender !== i.confirmation.author) fail('Unknown confirmation source.');
    if (i.confirmation && (!i.proposal || i.confirmation.author === i.proposal.author || i.confirmation.proposalId !== i.proposal.id || i.confirmation.proposalVersion !== i.proposal.version)) fail('Invalid issue confirmation.');
    if (['concluded', 'disagreed'].includes(i.status) && !i.confirmation) fail('Completed issue requires peer confirmation.');
  }
  if (new Set(v2.receipts.map(r => r.generation)).size !== v2.receipts.length || new Set(v2.calls.map(c => c.requestId)).size !== v2.calls.length) fail('Duplicate session or call identity.');
  for (const r of v2.receipts) {
    if (r.status === 'valid' && !r.sessionId) fail('Valid receipt requires native identity.');
    if (r.messages.some(ref => !messages.has(ref.id))) fail('Unknown receipt message.');
    if (r.evidence.some(ref => !state.evidence.some(e => e.source === ref.id && e.sha256 === ref.version))) fail('Unknown receipt evidence version.');
    if (new Set(r.messages.map(ref => ref.id)).size !== r.messages.length) fail('Duplicate receipt message.');
    if (r.messages.some(ref => { const m = messages.get(ref.id); return m && (m.status !== 'completed' || m.recipient !== 'both' && m.recipient !== r.agent && m.sender !== r.agent); })) fail('Receipt contains ineligible content.');
  }
  for (const c of v2.calls) {
    if (!v2.receipts.some(r => r.generation === c.snapshot.generation && r.agent === c.agent)) fail('Unknown call generation.');
    if (c.snapshot.messages.some(ref => !messages.has(ref.id))) fail('Unknown snapshot message.');
    if (c.snapshot.evidence.some(ref => { const e = state.evidence[ref.recordIndex]; return !e || e.source !== ref.id || e.sha256 !== ref.version; })) fail('Unknown snapshot evidence record.');
    if (c.snapshot.messages.some(ref => { const m = messages.get(ref.id); return m && (m.status !== 'completed' || m.recipient !== 'both' && m.recipient !== c.agent && m.sender !== c.agent); })) fail('Snapshot contains ineligible content.');
    if (c.snapshot.taskCard.references.some(ref => { const m = messages.get(ref.id); return !m || m.status !== 'completed' || m.recipient !== 'both' && m.recipient !== c.agent && m.sender !== c.agent; })) fail('Invalid snapshot reference.');
    if (c.snapshot.configurationVersion > v2.configurationVersion || c.snapshot.taskCard.version > v2.taskVersion) fail('Snapshot references a future configuration.');
    if (c.status === 'completed' && !messages.has(c.messageId)) fail('Completed call requires public answer.');
    if (c.status === 'completed' && (messages.get(c.messageId)?.sender !== c.agent || messages.get(c.messageId)?.taskVersion !== c.snapshot.taskCard.version)) fail('Answer attribution differs from its call.');
  }
  if (v2.requests.some(r => messages.get(r.messageId)?.sender !== 'user')) fail('Unknown user request.');
  if (v2.completed && (!v2.overall?.confirmedBy || v2.overall.confirmedBy === v2.overall.author || v2.currentIssueId ||
    v2.issues.some(i => ['pending', 'active', 'blocked'].includes(i.status)) || v2.requests.some(r => !['checked', 'disposed'].includes(r.status)))) fail('Invalid overall completion.');
});
export const discussionStateSchema = z.preprocess((value, ctx) => {
  if (value && typeof value === 'object' && 'behaviorVersion' in value && value.behaviorVersion === 2) {
    for (const field of ['goal', 'constraints', 'focused', 'mode', 'flow', 'roles', 'roots', 'research', 'limits', 'rolesConfirmed', 'activity', 'evidence', 'v2']) {
      if (!(field in value) || (value as Record<string, unknown>)[field] === undefined) ctx.addIssue({ code: 'custom', message: `Version 2 requires ${field}.` });
    }
  }
  return value;
}, stateSchema);
export const runEventSchema = z.object({
  sequence: z.number().int().positive(), discussionId: z.uuid(),
  type: z.enum(['created', 'state', 'session', 'message', 'progress', 'evidence', 'error', 'recovered']),
  at: z.iso.datetime(), data: z.record(z.string(), z.unknown()),
  commitId: z.uuid().optional(),
});
export class AppError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 409) {
    super(message);
  }
}
