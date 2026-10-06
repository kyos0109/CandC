import { z } from 'zod';
import { workflowSchema, workReportSchema, type Workflow } from './discussion-policy.js';
import { deliverySchema, conclusionReviewSchema } from './conclusion.js';

export const providerSchema = z.enum(['codex', 'claude', 'gemini', 'grok']);
export type ProviderId = z.infer<typeof providerSchema>;
export const moderatorModeSchema = z.enum(['facilitator', 'judge']);
export const isJudge = (state: { moderatorMode?: 'facilitator' | 'judge' | undefined }) => state.moderatorMode === 'judge';
// A seat is one independent speaking session. Its ID is not the provider: several seats may share a provider.
// The first seat of a provider normally keeps the provider's ID (`codex`), later ones use `codex-2`.
const RESERVED_SEAT_IDS = ['moderator', 'user', 'all', 'both'];
export const seatIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,23}$/).refine(id => !RESERVED_SEAT_IDS.includes(id), 'Reserved participant ID.');
export const participantSchema = z.union([seatIdSchema, z.literal('moderator')]);
export type ParticipantId = z.infer<typeof participantSchema>;
const effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export const roomSettingsSchema = z.object({ model: z.string().trim().min(1).max(160), effort: effort.nullable() }).strict();
const speakerSchema = z.object({ id: seatIdSchema, provider: providerSchema, settings: roomSettingsSchema,
  role: z.literal('speaker'), instructions: z.string().max(4_000).default(''), label: z.string().trim().min(1).max(40).optional() }).strict();
const moderatorSchema = z.object({ id: z.literal('moderator'), provider: providerSchema, settings: roomSettingsSchema,
  role: z.literal('moderator') }).strict();
export const roomInputSchema = z.object({
  behaviorVersion: z.literal(3), displayName: z.string().trim().max(120).optional(),
  discussionPolicyVersion: z.literal(1).optional(),
  moderatorMode: moderatorModeSchema.optional(),
  topic: z.string().trim().min(1).max(32_000), goal: z.string().max(32_000).default(''), constraints: z.string().max(32_000).default(''),
  backend: z.enum(['fake', 'live']).default('fake'), kind: z.enum(['discussion', 'debate']).default('discussion'),
  mode: z.enum(['manual', 'auto', 'conclusion']).default('manual'), flow: z.enum(['free', 'alternating']).default('free'),
  participants: z.array(speakerSchema).min(2).max(4), moderator: moderatorSchema.nullable().default(null),
  research: z.boolean().default(false), roots: z.array(z.string().min(1).max(1_000)).max(8).default([]),
  limits: z.object({ maxRounds: z.number().int().min(1).max(1_000), maxDurationMs: z.number().int().min(100).max(86_400_000),
    turnTimeoutMs: z.number().int().min(50).max(3_600_000), maxModeratorCalls: z.number().int().min(1).max(10_000).default(500) }).strict(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.participants.map(p => p.id)).size !== value.participants.length)
    ctx.addIssue({ code: 'custom', message: 'Speaker seat IDs must be unique.' });
  if (value.kind === 'debate' && value.participants.some(p => !p.instructions.trim()))
    ctx.addIssue({ code: 'custom', message: 'Debate speakers require explicit positions.' });
});
export type RoomInput = z.infer<typeof roomInputSchema>;
export const roomMessageSchema = z.object({ id: z.uuid(), sender: z.union([participantSchema, z.literal('user')]),
  recipient: z.union([participantSchema, z.literal('all')]), text: z.string(), round: z.number().int().nonnegative(),
  inReplyTo: z.uuid().nullable(), status: z.enum(['completed', 'cancelled', 'indeterminate']), createdAt: z.iso.datetime(),
  purpose: z.enum(['discussion', 'moderation', 'notice', 'summary']), taskVersion: z.number().int().positive(),
  interruptedBy: z.literal('moderator').optional(), continuation: z.enum(['continue', 'yield', 'done']).optional(),
}).strict();
export type RoomMessage = z.infer<typeof roomMessageSchema>;
const referenceSchema = z.object({ messageId: z.uuid(), disposition: z.enum(['addressed', 'unresolved', 'checked']), reason: z.string().max(4000) }).strict();
const sessionSchema = z.object({ id: z.string().min(1), model: z.string(), backend: z.enum(['fake', 'live']), generation: z.uuid(),
  delivered: z.array(z.uuid()), configurationVersion: z.number().int().nonnegative() }).strict();
const metadataDiagnosticSchema = z.enum(['work-schema', 'work-reference', 'work-limit', 'references-schema', 'references', 'delivery-schema', 'review-schema', 'proposal-reference', 'unsupported-action', 'control-schema', 'delivery-repair-limit']);
const callSchema = z.object({ id: z.uuid(), participant: participantSchema, provider: providerSchema, generation: z.uuid(),
  sessionId: z.string().nullable(), nativeSessionId: z.string().nullable(), taskVersion: z.number().int().positive(),
  grantId: z.uuid().nullable(), purpose: z.enum(['discussion', 'moderation', 'monitor', 'summary']),
  openingSpeaker: seatIdSchema.optional(),
  messages: z.array(z.uuid()), topic: z.string(), goal: z.string(), constraints: z.string(), task: z.string(),
  settings: roomSettingsSchema, payloadHash: z.string(), characters: z.number().int().nonnegative(),
  draft: z.object({ turnId: z.uuid(), text: z.string(), through: z.number().int().nonnegative() }).strict().nullable(),
  status: z.enum(['prepared', 'completed', 'cancelled', 'failed']), startedAt: z.iso.datetime(), durationMs: z.number().nonnegative().nullable(),
  usage: z.record(z.string(), z.number().nonnegative()).nullable(), reservationMs: z.number().nonnegative(),
  references: z.array(referenceSchema).max(100).default([]),
  researchPerformed: z.boolean().optional(),
  controlDiagnostic: z.enum(['envelope', 'json', 'schema', 'task-version', 'grant', 'references', 'workflow-reference', 'workflow-limit']).optional(),
  metadataDiagnostics: z.array(metadataDiagnosticSchema).max(11).optional(),
}).strict();
export type RoomCall = z.infer<typeof callSchema>;
export const moderatorActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('observe') }).strict(),
  z.object({ type: z.literal('speak'), target: seatIdSchema, task: z.string().min(1).max(8_000) }).strict(),
  z.object({ type: z.literal('interrupt'), reason: z.string().min(1).max(4_000) }).strict(),
  z.object({ type: z.literal('mute'), target: seatIdSchema, reason: z.string().min(1).max(4_000) }).strict(),
  z.object({ type: z.literal('unmute'), target: seatIdSchema, reason: z.string().min(1).max(4_000) }).strict(),
  z.object({ type: z.literal('topic'), title: z.string().trim().min(1).max(32_000), reason: z.string().min(1).max(4_000) }).strict(),
  z.object({ type: z.literal('pause'), reason: z.string().min(1).max(4_000) }).strict(),
  z.object({ type: z.literal('finish'), result: z.string().min(1).max(32_000), dissent: z.array(z.string().max(4_000)).max(30), unresolved: z.array(z.string().max(4_000)).max(30), delivery: deliverySchema.optional() }).strict(),
]);
export type ModeratorAction = z.infer<typeof moderatorActionSchema>;
export const roomControlSchema = z.object({ version: z.literal(3), taskVersion: z.number().int().positive(), grantId: z.uuid().nullable(),
  work: workReportSchema.optional(),
  references: z.array(referenceSchema).max(100).default([]),
  continuation: z.enum(['continue', 'yield', 'done']), action: z.union([moderatorActionSchema,
    z.object({ type: z.literal('none') }).strict(),
    z.object({ type: z.literal('propose'), result: z.string().min(1).max(32_000), dissent: z.array(z.string()).max(30), unresolved: z.array(z.string()).max(30), delivery: deliverySchema.optional() }).strict(),
    z.object({ type: z.literal('confirm'), proposalId: z.uuid(), review: conclusionReviewSchema.optional() }).strict()]),
}).strict();
export type RoomControl = z.infer<typeof roomControlSchema>;
export type MetadataDiagnostic = z.infer<typeof metadataDiagnosticSchema>;
const proposalSchema = z.object({ id: z.uuid(), author: seatIdSchema, taskVersion: z.number().int().positive(), result: z.string(), dissent: z.array(z.string()), unresolved: z.array(z.string()), confirmed: z.array(seatIdSchema), delivery: deliverySchema.optional(),
  reviews: z.array(conclusionReviewSchema.extend({ actor: seatIdSchema, callId: z.uuid() }).strict()).max(4).optional() }).strict();
const roomRuntimeSchema = z.object({ taskVersion: z.number().int().positive(), configurationVersion: z.number().int().positive(),
  deliveryVersion: z.literal(1).optional(),
  conclusionRequest: z.object({ target: participantSchema, reason: z.string().min(1).max(16_000), kind: z.enum(['repair', 'review']).optional() }).strict().nullable().optional(),
  currentSpeaker: seatIdSchema.nullable(), contributions: z.number().int().nonnegative(), moderatorCalls: z.number().int().nonnegative(),
  muted: z.array(seatIdSchema), grant: z.object({ id: z.uuid(), target: seatIdSchema, task: z.string(), version: z.number().int().positive(), taskKey: z.string().optional() }).strict().nullable(),
  workflow: workflowSchema.optional(),
  sessions: z.record(participantSchema, sessionSchema), calls: z.array(callSchema),
  commands: z.array(z.object({ id: z.uuid(), callId: z.uuid(), action: moderatorActionSchema, applied: z.boolean() }).strict()),
  pendingTopic: z.object({ commandId: z.uuid(), oldTitle: z.string(), title: z.string(), reason: z.string() }).strict().nullable(),
  topicHistory: z.array(z.object({ title: z.string(), version: z.number().int().positive(), reason: z.string() }).strict()),
  outcome: z.object({ authority: z.enum(['moderator', 'participants']), result: z.string(), dissent: z.array(z.string()), unresolved: z.array(z.string()), unhandledRequests: z.array(z.uuid()).default([]), delivery: deliverySchema.optional() }).strict().nullable(),
  proposal: proposalSchema.nullable(),
  interimResults: z.array(proposalSchema.extend({ unhandledRequests: z.array(z.uuid()) }).strict()).max(4_000).optional(),
  operations: z.array(z.object({ id: z.uuid(), fingerprint: z.string() }).strict()), sourceDiscussionId: z.uuid().nullable(),
  uncertainBudgetMs: z.number().nonnegative(),
}).strict();
export const roomStateSchema = roomInputSchema.safeExtend({ id: z.uuid(), sequence: z.number().int().positive(),
  status: z.enum(['ready', 'running', 'paused', 'stopped', 'indeterminate']), round: z.number().int().positive(),
  messages: z.array(roomMessageSchema), createdAt: z.iso.datetime(), elapsedMs: z.number().nonnegative(), pauseReason: z.string().nullable(),
  rolesConfirmed: z.boolean(), activity: z.enum(['discussion', 'summary']).nullable(),
  evidence: z.array(z.object({ source: z.string(), text: z.string(), sha256: z.string(), retrievedAt: z.string(), truncated: z.boolean(), owner: participantSchema.optional(), generation: z.uuid().optional() }).strict()),
  displayVersion: z.number().int().nonnegative().optional(), room: roomRuntimeSchema,
}).superRefine((state, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const ids = new Set<string>(state.participants.map(p => p.id)); if (state.moderator) ids.add('moderator');
  const messages = new Map(state.messages.map(m => [m.id, m]));
  if (messages.size !== state.messages.length) fail('Duplicate message identity.');
  for (const m of state.messages) {
    if (m.sender !== 'user' && !ids.has(m.sender) || m.recipient !== 'all' && !ids.has(m.recipient)) fail('Unknown message participant.');
    if (m.inReplyTo && !messages.has(m.inReplyTo)) fail('Unknown reply target.');
    if (m.sender === 'moderator' && m.recipient !== 'all') fail('Moderation is public.');
    if (m.recipient === 'moderator') fail('Moderator cannot receive directed messages.');
  }
  const native = new Set<string>();
  for (const [actor, s] of Object.entries(state.room.sessions)) {
    if (!ids.has(actor)) { fail('Unknown session owner.'); continue; }
    const provider = actor === 'moderator' ? state.moderator!.provider : state.participants.find(p => p.id === actor)!.provider;
    const key = `${provider}:${s.id}`; if (native.has(key)) fail('Session shared across participants.'); native.add(key);
    if (s.delivered.some(id => { const m = messages.get(id); return !m || m.status !== 'completed' || m.recipient !== 'all' && m.recipient !== actor; })) fail('Ineligible delivery receipt.');
  }
  const callIds = new Set<string>(), ownership = new Map<string, ParticipantId>();
  for (const c of state.room.calls) {
    if (!ids.has(c.participant)) { fail('Unknown call participant.'); continue; }
    if (c.openingSpeaker && (c.participant !== 'moderator' || c.purpose !== 'moderation' || !state.participants.some(p => p.id === c.openingSpeaker))) fail('Invalid opening speaker or owner.');
    if (callIds.has(c.id)) fail('Duplicate call identity.'); callIds.add(c.id);
    const provider = c.participant === 'moderator' ? state.moderator!.provider : state.participants.find(p => p.id === c.participant)!.provider;
    if (provider !== c.provider) fail('Call provider differs from its owner.');
    if (c.nativeSessionId) { const key = `${provider}:${c.nativeSessionId}`, previous = ownership.get(key); if (previous && previous !== c.participant) fail('Historical native session shared across owners.'); ownership.set(key, c.participant); }
    if (c.messages.some(id => { const m = messages.get(id); return !m || m.status !== 'completed' || m.recipient !== 'all' && m.recipient !== c.participant; })) fail('Ineligible call input.');
    if (c.participant === 'moderator' && c.messages.some(id => messages.get(id)?.recipient !== 'all')) fail('Private input delivered to moderator.');
    if (c.references.some(r => { const m = messages.get(r.messageId); return !m || m.status !== 'completed' || m.recipient !== 'all' && m.recipient !== c.participant; })) fail('Ineligible response reference.');
  }
  if (state.room.grant && (!ids.has(state.room.grant.target) || state.room.muted.includes(state.room.grant.target))) fail('Invalid speaking grant.');
  if (state.room.commands.some(c => !state.room.calls.some(call => call.id === c.callId && call.participant === 'moderator' && call.status === 'completed'))) fail('Command without completed moderator provenance.');
  if (state.room.muted.some(id => !state.participants.some(p => p.id === id))) fail('Unknown muted speaker.');
  // Seat IDs are free-form strings now, so every reference to a speaker must name a configured seat.
  const seats = new Set(state.participants.map(p => p.id)), proposal = state.room.proposal;
  if (state.room.currentSpeaker && !seats.has(state.room.currentSpeaker)) fail('Unknown current speaker.');
  if (proposal && (!seats.has(proposal.author) || proposal.confirmed.some(id => !seats.has(id)))) fail('Unknown proposal participant.');
  if (state.room.conclusionRequest && !ids.has(state.room.conclusionRequest.target)) fail('Unknown conclusion revision target.');
  if (proposal?.reviews && new Set(proposal.reviews.map(r => r.actor)).size !== proposal.reviews.length) fail('Duplicate conclusion reviewer.');
  if (proposal?.reviews?.some(r => !seats.has(r.actor) || r.actor === proposal.author || !state.room.calls.some(c => c.id === r.callId && c.participant === r.actor && c.status === 'completed' && c.taskVersion === proposal.taskVersion))) fail('Conclusion review without completed peer provenance.');
  if (state.room.deliveryVersion === 1 && proposal?.confirmed.some(id => id !== proposal.author && !proposal.reviews?.some(r => r.actor === id && r.adequate && r.gaps.length === 0))) fail('Confirmation without a delivery review.');
  if (state.room.deliveryVersion === 1 && state.room.outcome && !state.room.outcome.delivery) fail('Outcome without delivery assessment.');
  if (state.room.deliveryVersion === 1 && proposal && !proposal.delivery) fail('Proposal without delivery assessment.');
  if (state.room.deliveryVersion === 1 && state.room.outcome?.authority === 'participants' &&
      (!proposal || proposal.taskVersion !== state.room.taskVersion || state.participants.some(p => !proposal.confirmed.includes(p.id)) || state.room.outcome.result !== proposal.result || state.room.conclusionRequest)) fail('Outcome without a fully reviewed current proposal.');
  const stages = state.room.interimResults ?? [];
  if (new Set(stages.map(p => p.id)).size !== stages.length) fail('Duplicate interim result.');
  for (const p of stages) {
    if (!seats.has(p.author) || p.taskVersion > state.room.taskVersion || !p.delivery ||
        p.confirmed.length !== state.participants.length || new Set(p.confirmed).size !== state.participants.length || p.confirmed.some(id => !seats.has(id)) ||
        !state.room.calls.some(c => c.id === p.id && c.participant === p.author && c.purpose === 'discussion' && c.status === 'completed' && !c.controlDiagnostic && !c.metadataDiagnostics?.includes('control-schema') && c.taskVersion === p.taskVersion) ||
        p.confirmed.some(id => id !== p.author && !p.reviews?.some(r => r.actor === id && r.adequate && r.gaps.length === 0)) ||
        p.reviews?.length !== state.participants.length - 1 || p.reviews?.some(r => !seats.has(r.actor) || r.actor === p.author || !state.room.calls.some(c => c.id === r.callId && c.participant === r.actor && c.purpose === 'discussion' && c.status === 'completed' && !c.controlDiagnostic && !c.metadataDiagnostics?.includes('control-schema') && c.taskVersion === p.taskVersion)) ||
        new Set(p.reviews?.map(r => r.actor)).size !== p.reviews?.length || p.unhandledRequests.some(id => messages.get(id)?.sender !== 'user')) fail('Interim result without complete peer-review provenance.');
  }
  if (state.room.commands.some(c => 'target' in c.action && !seats.has(c.action.target))) fail('Unknown command target.');
  if (state.room.pendingTopic && !state.room.commands.some(c => c.id === state.room.pendingTopic!.commandId && c.action.type === 'topic' && !c.applied)) fail('Pending topic without notification command.');
  if (state.room.outcome?.authority === 'moderator' && !state.moderator) fail('Outcome without moderator.');
  if (!!state.room.workflow !== (state.discussionPolicyVersion === 1)) fail('Workflow policy version differs from state.');
  const workflow = state.room.workflow;
  if (workflow) {
    if (new Set(workflow.questions.map(q => q.key)).size !== workflow.questions.length || new Set(workflow.tasks.map(t => t.key)).size !== workflow.tasks.length) fail('Duplicate workflow key.');
    for (const entry of [...workflow.questions, ...workflow.tasks, ...(workflow.checkpoint ? [workflow.checkpoint] : [])])
      if (entry.sources.some(id => messages.get(id)?.recipient !== 'all' || messages.get(id)?.status !== 'completed')) fail('Workflow source is not completed public input.');
    if (workflow.tasks.some(t => t.target && !seats.has(t.target))) fail('Unknown workflow target.');
    if (workflow.checkpoint && (!ids.has(workflow.checkpoint.actor) || messages.get(workflow.checkpoint.messageId)?.sender !== workflow.checkpoint.actor)) fail('Unknown checkpoint owner.');
  }
});
export type RoomDiscussion = z.infer<typeof roomStateSchema> & { storage?: { status: 'unconfirmed'; reason: string }; v2?: undefined };
export type RoomSession = z.infer<typeof sessionSchema>;
export type RoomPrompt = { actor: ParticipantId; provider: ProviderId; taskVersion: number; grantId: string | null;
  openingSpeaker?: ParticipantId;
  deliveryVersion?: 1 | undefined; conclusionRequest?: RoomDiscussion['room']['conclusionRequest'];
  moderatorMode?: 'facilitator' | 'judge';
  discussionKind?: RoomInput['kind'];
  execution?: { mode: RoomInput['mode']; researchEnabled: boolean; researchAvailable: boolean; policyVersion: 1 | null; currentTaskKey: string | null };
  workflow?: Workflow;
  purpose: RoomCall['purpose']; task: string; goal: string; constraints: string; messages: RoomMessage[];
  roster: { id: string; provider: ProviderId; role: string; muted: boolean; label?: string }[]; draft: RoomCall['draft'];
  proposal: RoomDiscussion['room']['proposal']; results: RoomDiscussion['room']['topicHistory']; };
export const ROOM_CONTROL_START = '<<<CANDC_CONTROL_V3>>>';
export const ROOM_CONTROL_END = '<<<END_CANDC_CONTROL_V3>>>';
function roomBoundary(text: string): number {
  let fence: { character: string; length: number } | null = null, offset = 0, boundary = -1;
  for (const line of text.split('\n')) {
    const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
    if (match) {
      const marker = match[2]!;
      if (!fence) fence = { character: marker[0]!, length: marker.length };
      else if (marker[0] === fence.character && marker.length >= fence.length && !match[3]!.trim()) fence = null;
    } else if (!fence && line === ROOM_CONTROL_START) { if (boundary >= 0) return -1; boundary = offset; }
    offset += line.length + 1;
  }
  return boundary;
}
const controlIdentitySchema = z.object({ version: z.literal(3), taskVersion: z.number().int().positive(), grantId: z.uuid().nullable() });
export function parseRoomAnswer(text: string): { text: string; control: RoomControl | null; diagnostic?: 'envelope' | 'json' | 'schema'; metadataDiagnostics?: MetadataDiagnostic[]; fallbackIdentity?: z.infer<typeof controlIdentitySchema> } {
  const boundary = roomBoundary(text);
  const match = /(?:^|\n)<<<CANDC_CONTROL_V3>>>\s*\n([^]*?)\n<<<END_CANDC_CONTROL_V3>>>\s*$/.exec(text);
  if (!match || boundary < 0 || boundary !== match.index + (match[0].startsWith('\n') ? 1 : 0)) return { text: roomPreview(text), control: null, diagnostic: 'envelope' };
  let value: unknown;
  try { value = JSON.parse(match[1]!); } catch { return { text: text.slice(0, match.index).trimEnd(), control: null, diagnostic: 'json' }; }
  // Only the observed placement error is repaired. Unknown fields, conflicting
  // nested data, invalid identities and inappropriate actions still fail strictly.
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'delivery')) {
    const input = value as Record<string, unknown>, action = input.action;
    if (action && typeof action === 'object' && !Array.isArray(action) && !Object.hasOwn(action, 'delivery') &&
      ((action as Record<string, unknown>).type === 'propose' || (action as Record<string, unknown>).type === 'finish')) {
      const { delivery, ...rest } = input;
      value = { ...rest, action: { ...action, delivery } };
    }
  }
  const metadataDiagnostics: MetadataDiagnostic[] = [];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const input = { ...value } as Record<string, unknown>;
    // Optional reports can fail without granting authority or accepting a result.
    if (Object.hasOwn(input, 'work') && !workReportSchema.safeParse(input.work).success) { delete input.work; metadataDiagnostics.push('work-schema'); }
    if (Object.hasOwn(input, 'references') && !z.array(referenceSchema).max(100).safeParse(input.references).success) { delete input.references; metadataDiagnostics.push('references-schema'); }
    const a = input.action;
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      const action = { ...a } as Record<string, unknown>;
      if ((action.type === 'propose' || action.type === 'finish') && Object.hasOwn(action, 'delivery') && !deliverySchema.safeParse(action.delivery).success) { delete action.delivery; metadataDiagnostics.push('delivery-schema'); }
      if (action.type === 'confirm' && Object.hasOwn(action, 'review') && !conclusionReviewSchema.safeParse(action.review).success) { delete action.review; metadataDiagnostics.push('review-schema'); }
      input.action = action;
    }
    value = input;
  }
  const parsed = roomControlSchema.safeParse(value);
  if (parsed.success) return { text: text.slice(0, match.index).trimEnd(), control: parsed.data, ...(metadataDiagnostics.length ? { metadataDiagnostics } : {}) };
  // Only identity is recoverable. The controller must verify it against the owned
  // call before replacing all actions, continuation and claims with neutral control.
  const identity = controlIdentitySchema.safeParse(value);
  return { text: text.slice(0, match.index).trimEnd(), control: null, diagnostic: 'schema', ...(identity.success ? { fallbackIdentity: identity.data } : {}) };
}
export function roomPreview(text: string) {
  const index = roomBoundary(text); let result = index < 0 ? text : text.slice(0, index);
  if (index < 0) for (let n = 1; n < ROOM_CONTROL_START.length; n++) if (result.endsWith(ROOM_CONTROL_START.slice(0, n))) result = result.slice(0, -n);
  return result.trimEnd();
}
