import { z } from 'zod';

const agent = z.enum(['codex', 'claude']);
const version = z.number().int().positive();
const overallSchema = z.object({ author: agent, messageId: z.uuid(), version, result: z.string(), confirmedBy: agent.nullable() }).strict();
export const issueSchema = z.object({
  id: z.uuid(), version, title: z.string().min(1).max(32_000),
  status: z.enum(['pending', 'active', 'concluded', 'disagreed', 'blocked', 'skipped']),
  source: z.string(), proposal: z.object({
    id: z.uuid(), version, author: agent, messageId: z.uuid(),
    outcome: z.enum(['concluded', 'disagreed', 'blocked']), result: z.string().min(1),
    conditions: z.string(), unresolved: z.array(z.string()), blocking: z.boolean(),
  }).strict().nullable(),
  confirmation: z.object({ author: agent, messageId: z.uuid(), proposalId: z.uuid(), proposalVersion: version }).strict().nullable(),
  result: z.string(), unresolved: z.array(z.string()),
}).strict();
export const referenceSchema = z.object({ id: z.uuid(), version: z.literal(1) }).strict();
export const taskCardSchema = z.object({
  version, configurationVersion: version, goal: z.string(), constraints: z.string(),
  issueId: z.uuid().nullable(), issueVersion: version.nullable(), issueTitle: z.string(),
  responseTarget: z.uuid().nullable(), questions: z.array(z.string()),
  references: z.array(referenceSchema),
  unresolved: z.array(z.string()), proposal: issueSchema.shape.proposal,
  responsePolicy: z.string(),
  overall: overallSchema.nullable(),
  results: z.array(z.object({ issueId: z.uuid(), status: z.string(), result: z.string(), conditions: z.string(), unresolved: z.array(z.string()) }).strict()),
}).strict();
export const receiptSchema = z.object({
  generation: z.uuid(), agent, backend: z.enum(['fake', 'live']), sessionId: z.string().nullable(),
  status: z.enum(['provisional', 'valid', 'uncertain', 'retired']),
  messages: z.array(referenceSchema), evidence: z.array(z.object({ id: z.string(), version: z.string() }).strict()),
  configurationVersion: z.number().int().nonnegative(),
}).strict();
export const snapshotSchema = z.object({
  promptVersion: z.literal(2),
  configuration: z.object({ version, topicMessageId: z.uuid().nullable(), topic: z.string().optional(), goal: z.string(), constraints: z.string() }).strict().nullable(),
  adapterInput: z.object({ round: z.number().int().positive(), settings: z.object({ model: z.string(), effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']) }).strict(),
    role: z.string(), research: z.boolean(), roots: z.array(z.string()) }).strict(),
  messages: z.array(referenceSchema), evidence: z.array(z.object({ id: z.string(), version: z.string(), recordIndex: z.number().int().nonnegative() }).strict()),
  generation: z.uuid(), sessionId: z.string().nullable(), configurationVersion: version,
  taskCard: taskCardSchema, purpose: z.enum(['discussion', 'roles', 'summary']), opening: z.boolean(),
  payloadHash: z.string(), responseTarget: z.uuid().nullable(),
}).strict();
const observedTime = z.number().nonnegative().nullable();
export const diagnosticsSchema = z.object({
  input: z.object({ messageCount: z.number().int().nonnegative(), characters: z.number().int().nonnegative(),
    history: z.number().int().nonnegative(), background: z.number().int().nonnegative(),
    taskCard: z.number().int().nonnegative(), references: z.number().int().nonnegative(),
    fullHistoryCharacters: z.number().int().nonnegative(),
  }).strict(),
  timings: z.object({ processPreparation: observedTime, sessionReady: observedTime, firstPublicText: observedTime,
    generationComplete: observedTime, cleanup: observedTime, finalCommit: observedTime }).strict(),
  usage: z.record(z.string(), z.number().nonnegative()).nullable(), failureStage: z.string().nullable(),
}).strict();
export const callSchema = z.object({
  requestId: z.uuid(), messageId: z.uuid(), agent, snapshot: snapshotSchema,
  status: z.enum(['prepared', 'completed', 'failed']), provisionalSessionId: z.string().nullable(),
  resolvedModel: z.string().nullable(),
  budgetReservationMs: z.number().nonnegative(),
  diagnostics: diagnosticsSchema, control: z.enum(['valid', 'invalid', 'stale', 'not-applicable']).nullable(),
  annotation: z.enum(['valid', 'invalid', 'unmarked']), startedAt: z.iso.datetime(),
}).strict();
export const focusedStateSchema = z.object({
  configurationVersion: version, taskVersion: version, currentIssueId: z.uuid().nullable(),
  issues: z.array(issueSchema), receipts: z.array(receiptSchema), calls: z.array(callSchema),
  queuedIssue: z.object({ issueId: z.uuid(), action: z.enum(['select', 'skip']) }).strict().nullable(),
  sourceDiscussionId: z.uuid().nullable(),
  overall: overallSchema.nullable(),
  completed: z.boolean(),
  uncertainBudgetMs: z.number().nonnegative(),
  requests: z.array(z.object({ messageId: z.uuid(), status: z.enum(['unmarked', 'addressed', 'checked', 'disposed']),
    responseId: z.uuid().nullable(), reason: z.string() }).strict()),
  operationRecords: z.array(z.object({ id: z.uuid(), fingerprint: z.string() }).strict()),
}).strict();
export type Issue = z.infer<typeof issueSchema>;
export type TaskCard = z.infer<typeof taskCardSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type InputSnapshot = z.infer<typeof snapshotSchema>;
export type CallRecord = z.infer<typeof callSchema>;
export type FocusedState = z.infer<typeof focusedStateSchema>;
export type Diagnostics = z.infer<typeof diagnosticsSchema>;

export const controlSchema = z.object({
  version: z.literal(2), issueId: z.uuid().nullable(), issueVersion: version.nullable(),
  taskVersion: version, continuation: z.enum(['continue', 'yield', 'done']),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('none') }).strict(),
    z.object({ type: z.literal('propose'), outcome: z.enum(['concluded', 'disagreed', 'blocked']),
      result: z.string().min(1).max(32_000), conditions: z.string().max(8_000),
      unresolved: z.array(z.string().max(4_000)).max(30), blocking: z.boolean() }).strict(),
    z.object({ type: z.literal('confirm'), proposalId: z.uuid(), proposalVersion: version }).strict(),
    z.object({ type: z.literal('suggest'), title: z.string().min(1).max(32_000) }).strict(),
    z.object({ type: z.literal('overall'), result: z.string().min(1).max(32_000) }).strict(),
    z.object({ type: z.literal('confirm-overall'), messageId: z.uuid(), version }).strict(),
  ]),
}).strict();
export type Control = z.infer<typeof controlSchema>;
