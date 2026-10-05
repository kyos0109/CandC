import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, type AgentId, type Discussion, type Message } from './domain.js';
import { buildPrompt, type TurnRequest } from './adapters/types.js';
import { controlSchema, type CallRecord, type Control, type FocusedState, type Issue, type Receipt } from './v2-contract.js';
import { redact } from './redaction.js';

export const RESPONSE_POLICY = 'Answer the controller response target first. Start with a short public paragraph stating your main judgment, new contribution or correction, including material conditions and disagreement. Add only necessary details in the same output. For a long answer you may use an unquoted level-2 heading "Details" after a substantial opening; do not force sections on short answers. Preserve requested full analysis, code, evidence and counterexamples. Never split an answer merely to shorten it. Reading sections are public text, separate from control metadata.';
export const CONTROL_START = '<<<CANDC_CONTROL_V2>>>';
export const CONTROL_END = '<<<END_CANDC_CONTROL_V2>>>';
export function initialFocused(topic: string, source: string | null = null): FocusedState {
  const issue: Issue = { id: randomUUID(), version: 1, title: topic, status: 'active', source: 'user',
    proposal: null, confirmation: null, result: '', unresolved: [] };
  return { configurationVersion: 1, taskVersion: 1, currentIssueId: issue.id, issues: [issue], receipts: [], calls: [],
    queuedIssue: null, sourceDiscussionId: source, overall: null, completed: false, uncertainBudgetMs: 0, requests: [], operationRecords: [] };
}
export function eligibleMessages(state: Discussion, speaker: AgentId, opening: boolean): Message[] {
  return state.messages.filter(m => m.status === 'completed' && m.purpose !== 'roles' &&
    (m.recipient === 'both' || m.recipient === speaker || m.sender === speaker) &&
    !(opening && m.sender !== 'user' && m.round === 1 && m.purpose !== 'summary'));
}
export function availableReceipt(state: Discussion, speaker: AgentId): Receipt | undefined {
  const v = state.v2!;
  const session = state.sessions[speaker];
  if (v.calls.some(c => c.agent === speaker && c.snapshot.purpose === 'discussion' && c.status !== 'completed' && v.receipts.some(r => r.generation === c.snapshot.generation && r.status !== 'retired'))) {
    throw new AppError('RECONCILIATION_REQUIRED', 'An incomplete call requires explicit session reconstruction.');
  }
  if (!session) return undefined;
  const receipt = v.receipts.findLast(r => r.agent === speaker && r.sessionId === session.id && r.status === 'valid');
  if (!receipt || receipt.backend !== state.backend) throw new AppError('SESSION_MISMATCH', 'Session identity has no valid receipt.');
  return receipt;
}
export function selectInput(state: Discussion, speaker: AgentId, request: TurnRequest): { request: TurnRequest; receipt: Receipt; call: CallRecord } {
  const v = state.v2!;
  const ordinary = request.purpose === 'discussion';
  const old = ordinary ? availableReceipt(state, speaker) : undefined;
  const receipt: Receipt = old ?? { generation: randomUUID(), agent: speaker, backend: state.backend,
    sessionId: null, status: 'provisional', messages: [], evidence: [], configurationVersion: 0 };
  const opening = ordinary && state.round === 1 && !old && !v.receipts.some(r => r.agent === speaker && r.status === 'retired') &&
    !state.messages.some(m => m.sender === speaker && m.status === 'completed' && m.purpose === 'discussion');
  const all = eligibleMessages(state, speaker, opening);
  const context = all.filter(m => !old?.messages.some(ref => ref.id === m.id));
  const initialTopic = context.find(m => m.round === 0 && m.sender === 'user' && m.text === state.topic);
  const issue = v.issues.find(i => i.id === v.currentIssueId);
  const unseenUsers = context.filter(m => m.sender === 'user');
  const peer = all.findLast(m => m.sender !== speaker && m.sender !== 'user' && m.purpose === 'discussion');
  // Selection is independent of physical append order and is fixed before the provider starts.
  const target = unseenUsers[0] ?? peer ?? all.findLast(m => m.sender === 'user');
  const requiredIds = new Set<string>();
  if (target) requiredIds.add(target.id);
  if (issue?.proposal && all.some(m => m.id === issue.proposal!.messageId)) requiredIds.add(issue.proposal.messageId);
  if (v.overall && all.some(m => m.id === v.overall!.messageId)) requiredIds.add(v.overall.messageId);
  for (const m of unseenUsers) if (m.inReplyTo) requiredIds.add(m.inReplyTo);
  const unresolved = v.requests.filter(r => r.status !== 'disposed' && r.status !== 'checked' && all.some(m => m.id === r.messageId));
  for (const r of unresolved) { requiredIds.add(r.messageId); if (r.responseId && all.some(m => m.id === r.responseId)) requiredIds.add(r.responseId); }
  const references = all.filter(m => requiredIds.has(m.id) && m.id !== initialTopic?.id).map(m => ({ id: m.id, version: 1 as const, text: m.text }));
  const allowedContent = (id: string) => all.some(m => m.id === id);
  const eligibleEvidence = state.evidence.filter(e => !e.owner || e.owner === speaker || e.generation &&
    v.receipts.some(r => r.generation === e.generation && r.status === 'valid' && r.messages.every(ref => allowedContent(ref.id))) &&
    v.calls.filter(c => c.snapshot.generation === e.generation).every(c => c.snapshot.messages.every(ref => allowedContent(ref.id))))
    .filter((e, index, eligible) => eligible.findIndex(other => other.source === e.source && other.sha256 === e.sha256) === index);
  const evidence = eligibleEvidence.filter(e => !old?.evidence.some(ref => ref.id === e.source && ref.version === e.sha256));
  const taskCard = { version: v.taskVersion, configurationVersion: v.configurationVersion,
    goal: state.goal || (initialTopic ? `Use topic message ${initialTopic.id} as the goal.` : state.topic),
    constraints: state.constraints, issueId: issue?.id ?? null, issueVersion: issue?.version ?? null,
    issueTitle: initialTopic && issue?.title === state.topic ? `Topic from message ${initialTopic.id}` : issue?.title ?? '',
    responseTarget: target?.id ?? null, questions: unseenUsers.filter(m => m.id !== initialTopic?.id).map(m => `Answer user message ${m.id}`),
    references: references.map(({ id, version }) => ({ id, version })),
    unresolved: [...(issue?.unresolved ?? []), ...unresolved.map(r => {
      const m = all.find(m => m.id === r.messageId)!;
      return `${m.id}: ${r.status}; see supplied message or key reference${r.responseId && all.some(m => m.id === r.responseId) ? `; answer ${r.responseId}` : ''}`;
    })], proposal: issue?.proposal && references.some(r => r.id === issue.proposal!.messageId) ? issue.proposal : null, responsePolicy: RESPONSE_POLICY,
    overall: v.overall && references.some(r => r.id === v.overall!.messageId) ? v.overall : null,
    results: v.issues.filter(i => ['concluded', 'disagreed', 'skipped'].includes(i.status)).map(i => ({ issueId: i.id, status: i.status,
      result: i.status === 'skipped' ? `Skipped: ${i.title}; remains a result limitation.` : i.result, conditions: i.proposal?.conditions ?? '', unresolved: i.unresolved })) };
  const configDelta = old?.configurationVersion === v.configurationVersion ? undefined :
    { version: v.configurationVersion, topicMessageId: state.messages[0]?.id ?? null,
      topic: context.some(m => m.round === 0 && m.text === state.topic) ? undefined : state.topic, goal: state.goal, constraints: state.constraints };
  const selected: TurnRequest = { ...request, topic: state.topic, round: state.round, settings: state.agents[speaker], role: state.roles[speaker],
    research: state.research && ordinary, roots: state.roots, session: old ? state.sessions[speaker] : undefined, context, evidence,
    contract: { taskCard: { ...taskCard, references }, ...(configDelta ? { configuration: configDelta } : {}) }, requestId: request.requestId ?? randomUUID() };
  const payload = buildPrompt(selected);
  const history = JSON.stringify(context.map(({ sender, recipient, text, id, continuation, conclusionRef }) => ({ sender, recipient, text, id, continuation, conclusionRef }))).length;
  const refsChars = JSON.stringify(references).length;
  const taskChars = JSON.stringify({ ...taskCard, references: [] }).length;
  const fullHistoryCharacters = buildPrompt({ ...selected, context: all, evidence: eligibleEvidence }).length;
  if (payload.length > 1_000_000) throw new AppError('CONTEXT_LIMIT', 'Complete conversation exceeds the application input limit; no history was omitted.');
  const call: CallRecord = { requestId: selected.requestId!, messageId: request.messageId, agent: speaker,
    snapshot: { promptVersion: 2, configuration: configDelta ?? null,
      adapterInput: { round: state.round, settings: state.agents[speaker], role: state.roles[speaker], research: Boolean(selected.research), roots: state.roots },
      messages: context.map(m => ({ id: m.id, version: 1 })), evidence: evidence.map(e => ({ id: e.source, version: e.sha256, recordIndex: state.evidence.indexOf(e) })),
      generation: receipt.generation, sessionId: receipt.sessionId, configurationVersion: v.configurationVersion,
      taskCard, purpose: request.purpose ?? 'discussion', opening, payloadHash: createHash('sha256').update(payload).digest('hex'), responseTarget: target?.id ?? null },
    status: 'prepared', provisionalSessionId: null, resolvedModel: null, budgetReservationMs: Math.min(state.limits.turnTimeoutMs, Math.max(0, state.limits.maxDurationMs - state.elapsedMs)),
    control: null, annotation: 'unmarked', startedAt: new Date().toISOString(),
    diagnostics: { input: { messageCount: context.length, characters: payload.length, history, background: JSON.stringify({ configDelta, evidence }).length,
      taskCard: taskChars, references: refsChars, fullHistoryCharacters },
      timings: { processPreparation: null, sessionReady: null, firstPublicText: null, generationComplete: null, cleanup: null, finalCommit: null }, usage: null, failureStage: null } };
  return { request: selected, receipt, call };
}

// Recreate the serialized input from confirmed public records. This never invokes or resumes a model.
export function materializeInput(state: Discussion, call: CallRecord, signal: AbortSignal): TurnRequest {
  const s = call.snapshot;
  const message = (id: string) => {
    const m = state.messages.find(m => m.id === id && m.status === 'completed' && (m.recipient === 'both' || m.recipient === call.agent || m.sender === call.agent));
    if (!m) throw new AppError('INVALID_REFERENCE', 'The snapshot references unavailable public content.');
    return m;
  };
  return { messageId: call.messageId, requestId: call.requestId, topic: state.topic, purpose: s.purpose, round: s.adapterInput.round,
    settings: s.adapterInput.settings, role: s.adapterInput.role, research: s.adapterInput.research, roots: s.adapterInput.roots, signal,
    session: s.sessionId ? { id: s.sessionId, model: call.resolvedModel ?? s.adapterInput.settings.model, backend: state.backend } : undefined,
    context: s.messages.map(ref => message(ref.id)), evidence: s.evidence.map(ref => {
      const e = state.evidence[ref.recordIndex];
      if (!e || e.source !== ref.id || e.sha256 !== ref.version) throw new AppError('INVALID_REFERENCE', 'The snapshot evidence version is unavailable.');
      return e;
    }), contract: { taskCard: { ...s.taskCard, references: s.taskCard.references.map(ref => ({ ...ref, text: message(ref.id).text })) },
      ...(s.configuration ? { configuration: s.configuration } : {}) } };
}

const annotationSchema = z.object({ references: z.array(z.object({ messageId: z.uuid(), disposition: z.enum(['addressed', 'unresolved', 'checked']), reason: z.string().max(4_000) }).strict()).max(100) }).strict();
export type Annotation = z.infer<typeof annotationSchema>;
// Only a final standalone, unquoted block outside Markdown fences is a control envelope.
export function controlBoundary(text: string): number {
  let fence: { character: string; length: number } | null = null, offset = 0, boundary = -1;
  for (const line of text.split('\n')) {
    const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
    if (match) {
      const marker = match[2]!;
      if (!fence) fence = { character: marker[0]!, length: marker.length };
      else if (marker[0] === fence.character && marker.length >= fence.length && !match[3]!.trim()) fence = null;
    } else if (!fence && line === CONTROL_START) boundary = offset;
    offset += line.length + 1;
  }
  return boundary;
}
export function focusedPreview(text: string): string {
  const index = controlBoundary(text);
  if (index >= 0) return text.slice(0, index).trimEnd();
  const last = text.lastIndexOf('\n') + 1;
  const line = text.slice(last);
  return CONTROL_START.startsWith(line) && line.length ? text.slice(0, last).trimEnd() : text;
}
export function parseFocused(text: string): { text: string; control: Control | null; annotation: Annotation | null; annotationStatus: CallRecord['annotation'] } {
  const index = controlBoundary(text);
  if (index < 0) return { text, control: null, annotation: null, annotationStatus: 'unmarked' };
  const body = text.slice(index + CONTROL_START.length).trim();
  let value: Record<string, unknown> = {};
  if (body.endsWith(CONTROL_END)) {
    try { value = JSON.parse(body.slice(0, -CONTROL_END.length).trim()); } catch { /* Invalid required control pauses after saving public text. */ }
  }
  const { annotation, ...required } = value;
  const parsed = controlSchema.safeParse(required);
  const optional = annotationSchema.safeParse(annotation);
  return { text: text.slice(0, index).trimEnd(), control: parsed.success ? parsed.data : null,
    annotation: optional.success ? optional.data : null, annotationStatus: annotation === undefined ? 'unmarked' : optional.success ? 'valid' : 'invalid' };
}
export function applyBoundary(v: FocusedState): FocusedState {
  if (!v.queuedIssue) return v;
  const { issueId, action } = v.queuedIssue;
  const issues = v.issues.map(i => i.id === issueId ? { ...i, status: action === 'skip' ? 'skipped' as const : 'active' as const,
    version: i.version + 1, proposal: null, confirmation: null } : action === 'select' && (i.status === 'active' || i.status === 'blocked') ? { ...i, status: 'pending' as const } : i);
  const currentIssueId = action === 'select' ? issueId : v.currentIssueId === issueId ? null : v.currentIssueId;
  return { ...v, issues, currentIssueId, queuedIssue: null, taskVersion: v.taskVersion + 1, overall: null, completed: false };
}
export function applyControl(state: Discussion, call: CallRecord, message: Message, parsed: ReturnType<typeof parseFocused>): { v2: FocusedState; pauseReason: string | null; controlStatus: NonNullable<CallRecord['control']> } {
  let v = structuredClone(state.v2!);
  const available = new Set([...call.snapshot.messages.map(r => r.id), ...call.snapshot.taskCard.references.map(r => r.id),
    ...(v.receipts.find(r => r.generation === call.snapshot.generation)?.messages.map(r => r.id) ?? [])]);
  const allowed = (id: string) => available.has(id) && state.messages.some(m => m.id === id && (m.recipient === 'both' || m.recipient === call.agent || m.sender === call.agent));
  if (parsed.annotation && parsed.annotation.references.every(r => allowed(r.messageId))) {
    message.responseRefs = parsed.annotation.references.map(r => r.messageId);
    for (const ref of [...parsed.annotation.references].sort((a, b) => Number(b.disposition === 'checked') - Number(a.disposition === 'checked'))) {
      const request = v.requests.find(r => r.messageId === ref.messageId);
      if (request && ref.disposition === 'addressed' && request.status !== 'checked' && request.status !== 'disposed') { request.status = 'addressed'; request.responseId = message.id; request.reason = redact(ref.reason); }
      if (request && ref.disposition === 'unresolved' && request.status !== 'checked' && request.status !== 'disposed') { request.status = 'unmarked'; request.reason = redact(ref.reason); }
      if (ref.disposition === 'checked' && state.messages.find(m => m.id === ref.messageId)?.sender !== call.agent) {
        for (const checked of v.requests.filter(r => r.responseId === ref.messageId && r.status !== 'disposed' && r.status !== 'checked')) {
          checked.status = 'checked'; checked.reason = redact(ref.reason);
        }
      }
    }
  } else if (parsed.annotation) message.annotation = 'invalid';
  const control = parsed.control ? structuredClone(parsed.control) : null;
  if (control?.action.type === 'propose') {
    control.action.result = redact(control.action.result); control.action.conditions = redact(control.action.conditions);
    control.action.unresolved = control.action.unresolved.map(value => redact(value));
  } else if (control?.action.type === 'suggest') control.action.title = redact(control.action.title);
  else if (control?.action.type === 'overall') control.action.result = redact(control.action.result);
  if (!control) return { v2: applyBoundary(v), pauseReason: 'Required issue control is missing or invalid; the answer and delivery were saved.', controlStatus: 'invalid' };
  const issue = v.issues.find(i => i.id === control.issueId);
  if (control.taskVersion !== call.snapshot.taskCard.version || control.issueId !== call.snapshot.taskCard.issueId || control.issueVersion !== call.snapshot.taskCard.issueVersion) {
    return { v2: applyBoundary(v), pauseReason: 'Required issue control does not match the input snapshot.', controlStatus: 'invalid' };
  }
  message.continuation = control.continuation;
  if (v.taskVersion !== control.taskVersion || v.currentIssueId !== control.issueId || (issue?.version ?? null) !== control.issueVersion || v.queuedIssue) {
    return { v2: applyBoundary(v), pauseReason: null, controlStatus: 'stale' };
  }
  const invalid = () => ({ v2: v, pauseReason: 'Issue action is invalid; delivery was saved without applying the action.', controlStatus: 'invalid' as const });
  const action = control.action;
  if (message.recipient !== 'both' && action.type !== 'none') return invalid();
  if (action.type === 'propose') {
    if (!issue || action.outcome === 'blocked' && !action.unresolved.length || action.outcome === 'disagreed' && !action.conditions.trim() || action.outcome !== 'blocked' && action.blocking) return invalid();
    const proposalVersion = (issue.proposal?.version ?? 0) + 1;
    const { type: _type, ...proposal } = action;
    issue.proposal = { id: randomUUID(), version: proposalVersion, author: call.agent, messageId: message.id, ...proposal };
    // Keep the active issue version stable for a first proposal; revisions invalidate the previous confirmation and task.
    issue.confirmation = null;
    issue.result = action.result; issue.unresolved = action.unresolved;
    v.taskVersion++;
  } else if (action.type === 'confirm') {
    if (!issue?.proposal || issue.proposal.author === call.agent || !allowed(issue.proposal.messageId) || issue.proposal.id !== action.proposalId || issue.proposal.version !== action.proposalVersion) return invalid();
    issue.confirmation = { author: call.agent, messageId: message.id, proposalId: action.proposalId, proposalVersion: action.proposalVersion };
    const outcome = issue.proposal.outcome;
    issue.status = outcome;
    if (outcome !== 'blocked') v.currentIssueId = null;
    v.taskVersion++;
    if (outcome === 'blocked' && issue.proposal.blocking) return { v2: v, pauseReason: 'Missing information prevents the next valid step.', controlStatus: 'valid' };
  } else if (action.type === 'suggest') {
    if (!v.issues.some(i => i.title === action.title && i.status === 'pending')) v.issues.push({ id: randomUUID(), version: 1, title: action.title,
      status: 'pending', source: message.id, proposal: null, confirmation: null, result: '', unresolved: [] });
  } else if (action.type === 'overall') {
    if (v.currentIssueId || v.issues.some(i => i.status === 'pending') || v.requests.some(r => !['checked', 'disposed'].includes(r.status))) return invalid();
    v.overall = { author: call.agent, messageId: message.id, version: v.taskVersion, result: action.result, confirmedBy: null };
  } else if (action.type === 'confirm-overall') {
    if (!v.overall || v.overall.author === call.agent || !allowed(action.messageId) || v.overall.messageId !== action.messageId || v.overall.version !== action.version ||
        v.currentIssueId || v.issues.some(i => ['pending', 'active', 'blocked'].includes(i.status)) || v.requests.some(r => !['checked', 'disposed'].includes(r.status))) return invalid();
    // Both native sessions must have received all eligible public user input.
    if ((['codex', 'claude'] as const).some(agent => state.messages.some(m => m.sender === 'user' && (m.recipient === 'both' || m.recipient === agent) &&
      !(agent === call.agent && available.has(m.id)) && !v.receipts.some(r => r.agent === agent && r.status === 'valid' && r.messages.some(ref => ref.id === m.id))))) return invalid();
    v.overall.confirmedBy = call.agent; v.completed = true;
  }
  return { v2: v, pauseReason: v.completed ? 'Overall result explicitly confirmed by both agents.' : null, controlStatus: 'valid' };
}
