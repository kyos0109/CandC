import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { AppError, type AgentSession, type RunEvent } from './domain.js';
import { DiscussionStore } from './store.js';
import { buildPrompt, type AgentAdapter, type TurnRequest } from './adapters/types.js';
import { redact, safeError } from './redaction.js';
import { validateRoots } from './research.js';
import { roomInputSchema, parseRoomAnswer, roomPreview, isJudge, type RoomInput, type RoomDiscussion, type ParticipantId,
  type ProviderId, type RoomCall, type RoomMessage, type RoomControl, type ModeratorAction } from './room-contract.js';
import { PerformanceStore, type Measurement, type PerformanceObserver, type PerformanceRecord } from './performance.js';
import { emptyWorkflow, continuationTask, runnableTasks, updateWorkflow } from './discussion-policy.js';
import { deliveryProblem, type ConclusionDelivery } from './conclusion.js';

const savedDelivery = (delivery?: ConclusionDelivery) => delivery ? { ...delivery, basis: delivery.basis.map(value => redact(value)) } : undefined;

type Listener = (event: RunEvent) => void;
type ActiveTurn = { id: string; grantId: string; actor: ParticipantId; abort: AbortController; open: boolean; text: string; interrupted: boolean; reason: string };
type Runtime = { abort: AbortController; task: Promise<void>; pause: boolean; startedAt: number; initialElapsed: number;
  purpose: 'discussion' | 'summary'; turn: ActiveTurn | null; executionId: string; versions: Partial<Record<ProviderId, string | null>>; redirects: number; deliveryCorrections: number };
type CallResult = { call: RoomCall; text: string; control: RoomControl | null };
export type RoomAdapterFactory = (provider: ProviderId, workspace: string, backend: 'fake' | 'live', actor: ParticipantId) => AgentAdapter;
export type InitialRoomHistory = { messages: RoomMessage[]; sourceDiscussionId: string; elapsedMs: number };
export class RoomController {
  private states = new Map<string, RoomDiscussion>();
  private listeners = new Map<string, Set<Listener>>();
  private runtimes = new Map<string, Runtime>();
  private reloadedFakeRooms = new Set<string>();
  private lock: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: DiscussionStore<RoomDiscussion>, private readonly factory: RoomAdapterFactory,
    private readonly preflight: (state: RoomDiscussion, observer?: PerformanceObserver) => Promise<void | Partial<Record<ProviderId, string | null>>> = async () => {},
    private readonly performance = new PerformanceStore(undefined, false), private readonly monitorIntervalMs = 10_000) {}
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.lock.then(action); this.lock = result.catch(() => undefined); return result;
  }
  has(id: string) { return this.states.has(id); }
  get(id: string): RoomDiscussion { const s = this.states.get(id); if (!s) throw new AppError('NOT_FOUND', 'Discussion not found.', 404); return structuredClone(s); }
  list() { return [...this.states.values()].map(s => structuredClone(s)); }
  get busy() { return this.runtimes.size > 0; }
  storageIssues() { return this.store.storageIssues(); }
  private assertStorage(id: string) { if (this.store.isBlocked(id)) throw new AppError('STORAGE_UNCONFIRMED', 'Storage is unconfirmed; recover before scheduling.'); }
  private progress(id: string, data: Record<string, unknown>) { this.emit(id, { sequence: 0, discussionId: id, type: 'progress', at: new Date().toISOString(), data }); }
  private emit(id: string, event: RunEvent) { for (const listener of this.listeners.get(id) ?? []) { try { listener(structuredClone(event)); } catch { /* Disconnected client. */ } } }
  private async commit(state: RoomDiscussion, type: RunEvent['type'] = 'state', data: Record<string, unknown> = {}) {
    this.assertStorage(state.id);
    const updated = { ...state, sequence: state.sequence + 1 }, event: RunEvent = { sequence: updated.sequence, discussionId: state.id,
      type, data, at: new Date().toISOString(), commitId: randomUUID() };
    try { await this.store.commit(updated, event); }
    catch (error) {
      if (this.store.isBlocked(state.id)) {
        const previous = this.get(state.id);
        this.states.set(state.id, { ...previous, status: 'indeterminate', activity: null, storage: { status: 'unconfirmed', reason: 'Journal storage is unconfirmed; explicit recovery is required.' }, pauseReason: '未確認保存，已停止主持人與發言者。' });
        this.runtimes.get(state.id)?.abort.abort(); this.progress(state.id, { storage: 'unconfirmed' });
      }
      throw error;
    }
    this.states.set(state.id, updated); this.emit(state.id, event);
  }
  async initialize() {
    for (const state of await this.store.list()) {
      this.states.set(state.id, state);
      if (state.backend === 'fake') this.reloadedFakeRooms.add(state.id);
      if (this.store.isBlocked(state.id)) {
        this.states.set(state.id, { ...state, status: 'indeterminate', storage: { status: 'unconfirmed', reason: 'Journal storage is unconfirmed; explicit recovery is required.' } });
      } else if (state.status === 'running' || state.activity) {
        await this.commit({ ...state, status: 'indeterminate', activity: null, room: { ...state.room, grant: null, currentSpeaker: null },
          pauseReason: '上次執行沒有確認結果，請明確重建工作階段；不會自動重送。' }, 'recovered');
      }
    }
  }
  async create(id: string, input: RoomInput, history?: InitialRoomHistory) {
    return this.exclusive(async () => {
      const parsed = roomInputSchema.parse(input);
      const normalized: RoomInput = { ...parsed, topic: redact(parsed.topic), goal: redact(parsed.goal.trim() || parsed.topic), constraints: redact(parsed.constraints),
        participants: parsed.participants.map(p => ({ ...p, instructions: redact(p.instructions) })), roots: await validateRoots(parsed.roots),
        ...(parsed.displayName === undefined ? {} : { displayName: redact(parsed.displayName) }) };
      const fingerprint = JSON.stringify(history ? { input: normalized, historyHash: createHash('sha256').update(JSON.stringify(history)).digest('hex') } : normalized);
      if (this.has(id)) {
        const s = this.get(id); if (s.room.operations[0]?.fingerprint !== fingerprint) throw new AppError('IDEMPOTENCY_CONFLICT', 'Discussion ID already used.'); return s;
      }
      const at = new Date().toISOString();
      const state: RoomDiscussion = { ...normalized, id, status: 'ready', sequence: 0, round: 1, elapsedMs: history?.elapsedMs ?? 0, createdAt: at, pauseReason: null,
        rolesConfirmed: normalized.kind !== 'debate', activity: null, evidence: [],
        messages: history?.messages ?? [{ id: randomUUID(), sender: 'user', recipient: 'all', text: normalized.topic, round: 0, inReplyTo: null, status: 'completed', createdAt: at, purpose: 'discussion', taskVersion: 1 }],
        room: { taskVersion: 1, configurationVersion: 1, deliveryVersion: 1, conclusionRequest: null, currentSpeaker: null, contributions: 0, moderatorCalls: 0, muted: [], grant: null,
          sessions: {}, calls: [], commands: [], pendingTopic: null, topicHistory: [{ title: normalized.topic, version: 1, reason: 'Original topic' }],
          outcome: null, proposal: null, operations: [{ id, fingerprint }], sourceDiscussionId: history?.sourceDiscussionId ?? null, uncertainBudgetMs: 0,
          ...(normalized.discussionPolicyVersion === 1 ? { workflow: emptyWorkflow() } : {}) } };
      this.states.set(id, state); await this.commit(state, 'created', { backend: state.backend, behaviorVersion: 3 }); return this.get(id);
    });
  }
  async start(id: string, operationId: string, purpose: 'discussion' | 'summary' | 'roles' = 'discussion') {
    const accepted = this.performance.captureTime(), executionId = randomUUID();
    let measurement: Measurement | undefined;
    try { return await this.exclusive(async () => {
      const state = this.get(id); this.assertStorage(id);
      if (purpose === 'roles') throw new AppError('INVALID_STATE', 'Version 3 uses explicit participant positions.');
      const fingerprint = JSON.stringify({ action: 'start', purpose });
      if (this.repeated(state, operationId, fingerprint)) return state;
      measurement = this.performance.begin({ kind: 'execution', discussionId: id, executionId, requestId: null, backend: state.backend,
        provider: null, cliVersion: null, model: null, effort: null, research: state.research && purpose === 'discussion', purpose,
        session: null, characters: null, round: null, position: null }, accepted);
      measurement?.mark('locked');
      if (this.busy) throw new AppError('BUSY', 'Only one discussion may run.');
      if (state.status === 'indeterminate') throw new AppError('RECONCILIATION_REQUIRED', 'Rebuild sessions before continuing.');
      if (state.status === 'stopped') throw new AppError('STOPPED', 'Rebuild sessions before continuing.');
      if (state.room.outcome && purpose === 'discussion') throw new AppError('COMPLETED', 'Add input before reopening a completed discussion.');
      if (!state.rolesConfirmed) throw new AppError('ROLES_REQUIRED', '請確認所有發言者的立場。');
      if (state.room.pendingTopic) throw new AppError('PENDING_TOPIC', '確認尚未套用的改題通知後才能續談。');
      if (state.elapsedMs >= state.limits.maxDurationMs) throw new AppError('TIME_LIMIT', 'Duration limit reached.');
      if (purpose === 'discussion' && state.room.contributions >= state.limits.maxRounds * state.participants.length) throw new AppError('ROUND_LIMIT', 'Round limit reached.');
      if (state.moderator && isJudge(state) && state.room.moderatorCalls >= state.limits.maxModeratorCalls) throw new AppError('MODERATOR_LIMIT', '主持人呼叫已達上限，請調整後續談。');
      const versions = state.backend === 'live' ? await this.preflight(state, measurement?.mark) : undefined;
      if (measurement && versions) measurement.record.cliVersions = { codex: versions.codex ?? null, claude: versions.claude ?? null };
      // Fixture memory is process-local. Retire saved identities only on an explicit start;
      // missing sessions select complete eligible history and receive new generations.
      const resetFakeSessions = state.backend === 'fake' && this.reloadedFakeRooms.has(id);
      const resetModeratorAuthority = !!state.moderator && state.moderatorMode === undefined;
      const upgradeDelivery = purpose === 'discussion' && state.room.deliveryVersion !== 1;
      await this.commit({ ...state, status: 'running', pauseReason: null, activity: purpose,
        ...(resetModeratorAuthority ? { moderatorMode: 'facilitator' } : {}),
        room: { ...state.room, ...(!isJudge(state) ? { muted: [] } : {}), ...(resetFakeSessions || resetModeratorAuthority || upgradeDelivery ? { sessions: {} } : {}),
          ...(upgradeDelivery ? { deliveryVersion: 1 as const, proposal: null, conclusionRequest: null } : {}), operations: [...state.room.operations, { id: operationId, fingerprint }] } });
      this.reloadedFakeRooms.delete(id);
      const runtime: Runtime = { abort: new AbortController(), task: Promise.resolve(), pause: false, startedAt: Date.now(), initialElapsed: state.elapsedMs, purpose, turn: null, executionId, versions: versions ?? {}, redirects: 0, deliveryCorrections: 0 };
      this.runtimes.set(id, runtime); runtime.task = Promise.resolve().then(() => this.execute(id, runtime)); void runtime.task.catch(() => undefined); return this.get(id);
    }); } catch (error) { measurement?.end(this.measurementOutcome(id, error)); throw error; }
    finally { measurement?.end('success'); }
  }
  private measurementOutcome(id: string, error: unknown, signal?: AbortSignal, runtime?: Runtime, measurement?: Measurement, externallyCancelled = false): NonNullable<PerformanceRecord['outcome']> {
    if (this.store.isBlocked(id)) return 'storage-unknown';
    if (externallyCancelled || runtime?.abort.signal.aborted || runtime?.turn?.abort.signal.aborted) return 'cancelled';
    if (signal?.aborted || error instanceof AppError && error.code === 'TIME_LIMIT') return 'timeout';
    if (measurement?.record.failurePhase === 'cleanupStart' || measurement?.record.failurePhase === 'inspectCleanupStart' ||
      measurement?.record.offsets.cleanupStart !== undefined && measurement.record.offsets.cleanupEnd === undefined ||
      measurement?.record.offsets.inspectCleanupStart !== undefined && measurement.record.offsets.inspectCleanupEnd === undefined) return 'cleanup-error';
    if (error instanceof AppError && ['PROCESS_START', 'PROCESS_INPUT'].includes(error.code)) return 'startup-error';
    return runtime && !(error instanceof AppError && error.code === 'CONTEXT_LIMIT') ? 'protocol-error' : 'failed';
  }
  private repeated(s: RoomDiscussion, id: string, fingerprint: string) {
    const old = s.room.operations.find(o => o.id === id); if (!old) return false;
    if (old.fingerprint !== fingerprint) throw new AppError('IDEMPOTENCY_CONFLICT', 'Operation ID used with different content.'); return true;
  }
  private eligible(s: RoomDiscussion, actor: ParticipantId) {
    return s.messages.filter(m => m.status === 'completed' && (m.recipient === 'all' || actor !== 'moderator' && m.recipient === actor));
  }
  private sessionFor(s: RoomDiscussion, actor: ParticipantId) {
    return Object.hasOwn(s.room.sessions, actor) ? s.room.sessions[actor] : undefined;
  }
  private elapsed(runtime: Runtime) { return runtime.initialElapsed + Date.now() - runtime.startedAt; }
  private async call(id: string, runtime: Runtime, actor: ParticipantId, purpose: RoomCall['purpose'], task: string,
    draft: RoomCall['draft'] = null, onDelta?: (text: string) => void, signal?: AbortSignal, fresh = false): Promise<CallResult> {
    const initial = this.get(id), participant = actor === 'moderator' ? initial.moderator! : initial.participants.find(p => p.id === actor)!;
    const callId = randomUUID();
    const measurement = this.performance.begin({ kind: 'turn', discussionId: id, executionId: runtime.executionId, requestId: callId, backend: initial.backend,
      provider: participant.provider, participant: actor, cliVersion: runtime.versions[participant.provider] ?? null, model: participant.settings.model,
      effort: participant.settings.effort ?? 'medium', research: initial.research && purpose === 'discussion', purpose,
      session: !fresh && this.sessionFor(initial, actor) ? 'resumed' : 'new', characters: null, round: initial.round, position: initial.room.calls.length + 1 });
    measurement?.mark('selectionStart');
    const prepared = await this.exclusive(async () => {
      const s = this.get(id); this.assertStorage(id); runtime.abort.signal.throwIfAborted();
      if (s.status !== 'running') throw new AppError('CANCELLED', 'Execution is no longer active.');
      if (actor === 'moderator' && s.room.moderatorCalls >= s.limits.maxModeratorCalls) throw new AppError('MODERATOR_LIMIT', '主持人呼叫已達上限。');
      const remaining = s.limits.maxDurationMs - this.elapsed(runtime); if (remaining <= 0) throw new AppError('TIME_LIMIT', 'Duration limit reached.');
      const participant = actor === 'moderator' ? s.moderator! : s.participants.find(p => p.id === actor)!;
      if (!participant) throw new AppError('INVALID_REFERENCE', 'Unknown participant.');
      const session = fresh ? undefined : this.sessionFor(s, actor);
      const eligible = this.eligible(s, actor), messages = eligible.filter(m => !session?.delivered.includes(m.id));
      const generation = session?.generation ?? randomUUID();
      const workspace = path.resolve('.cache/agents/rooms', id, actor, generation);
      const timeoutMs = Math.min(s.limits.turnTimeoutMs, remaining);
      const request: TurnRequest = { messageId: callId, requestId: callId, topic: s.topic, round: s.round,
        settings: { model: participant.settings.model, effort: participant.settings.effort ?? 'medium' },
        session: session ? { id: session.id, model: session.model, backend: session.backend } : undefined, context: [],
        signal: AbortSignal.any([runtime.abort.signal, ...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]), workspace,
        purpose: purpose === 'summary' ? 'summary' : 'discussion', research: s.research && purpose === 'discussion', roots: s.roots,
        evidence: actor === 'moderator' ? [] : s.evidence.filter(e => !e.owner || e.owner === actor).map(({ owner: _, ...e }) => e),
        untilConclusion: s.mode === 'conclusion',
        room: { actor, provider: participant.provider, taskVersion: s.room.taskVersion, grantId: draft ? runtime.turn?.grantId ?? null : s.room.grant?.id ?? null,
          deliveryVersion: s.room.deliveryVersion, conclusionRequest: s.room.conclusionRequest,
          moderatorMode: s.moderatorMode ?? 'facilitator', discussionKind: s.kind,
          execution: { mode: s.mode, researchEnabled: s.research, researchAvailable: s.research && purpose === 'discussion',
            policyVersion: s.discussionPolicyVersion ?? null, currentTaskKey: purpose === 'discussion' ? s.room.grant?.taskKey ?? null : null },
          ...(s.room.workflow ? { workflow: s.room.workflow } : {}),
          purpose, task: participant.role === 'moderator' ? task : `${participant.instructions}\n${task}`, goal: s.goal, constraints: s.constraints,
          messages, roster: [...s.participants, ...(s.moderator ? [s.moderator] : [])].map(p => ({ id: p.id, provider: p.provider, role: p.role, muted: s.room.muted.includes(p.id) && p.role === 'speaker', ...('label' in p && p.label ? { label: p.label } : {}) })),
          draft, proposal: actor === 'moderator' && isJudge(s) ? null : s.room.proposal, results: s.room.topicHistory } };
      const payload = buildPrompt(request); if (payload.length > 1_000_000) throw new AppError('CONTEXT_LIMIT', 'Input exceeds limit; no history was truncated.');
      if (measurement) { measurement.record.characters = payload.length; measurement.record.session = session ? 'resumed' : 'new'; }
      measurement?.mark('selectionEnd');
      const c: RoomCall = { id: callId, participant: actor, provider: participant.provider, generation, sessionId: session?.id ?? null, nativeSessionId: null,
        taskVersion: s.room.taskVersion, grantId: request.room!.grantId, purpose, messages: messages.map(m => m.id), topic: s.topic, goal: s.goal, constraints: s.constraints,
        task: request.room!.task, settings: participant.settings, payloadHash: createHash('sha256').update(payload).digest('hex'), characters: payload.length,
        draft, status: 'prepared', startedAt: new Date().toISOString(), durationMs: null, usage: null, reservationMs: timeoutMs, references: [] };
      measurement?.mark('preparedStart');
      await this.commit({ ...s, room: { ...s.room, moderatorCalls: s.room.moderatorCalls + (actor === 'moderator' ? 1 : 0), calls: [...s.room.calls, c] } }, 'state', { preparedCall: c.id, participant: actor });
      measurement?.mark('preparedEnd');
      return { request, call: c, session, workspace };
    }).catch(error => { measurement?.end(this.measurementOutcome(id, error, signal, runtime, measurement, signal?.aborted)); throw error; });
    const { request, call } = prepared; const started = Date.now(); let partial = '', native: AgentSession | null = null, final: string | null = null;
    if (measurement) request.observePerformance = measurement.mark;
    const toolIds = new Set<string>();
    try {
      request.signal.throwIfAborted(); await mkdir(prepared.workspace, { recursive: true });
      const adapter = this.factory(call.provider, prepared.workspace, this.get(id).backend, actor);
      for await (const event of adapter.run(request)) {
        request.signal.throwIfAborted();
        if (event.type === 'session') {
          if (native || event.session.backend !== this.get(id).backend || request.session && request.session.id !== event.session.id) throw new AppError('SESSION_MISMATCH', 'Session differs from its owned request.');
          native = event.session;
          if (measurement) measurement.record.model = event.session.model;
          await this.exclusive(async () => {
            const s = this.get(id); this.assertStorage(id);
            if (s.room.calls.some(c => c.id !== call.id && c.provider === call.provider && c.participant !== actor && c.nativeSessionId === native!.id)) throw new AppError('SESSION_MISMATCH', 'Provider reused another participant session.');
            await this.commit({ ...s, room: { ...s.room, calls: s.room.calls.map(c => c.id === call.id ? { ...c, nativeSessionId: native!.id } : c) } }, 'session', { provisional: true, callId: call.id, participant: actor });
          });
        } else if (event.type === 'delta') {
          partial += event.text; if (partial.length > 500_000) throw new AppError('OUTPUT_LIMIT', 'Response exceeded limit.');
          if (roomPreview(partial).trim()) measurement?.text('stream');
          onDelta?.(redact(roomPreview(partial)));
          if (purpose !== 'monitor') this.progress(id, { speaker: actor, preview: redact(roomPreview(partial)), characters: partial.length, turnId: call.id });
        } else if (event.type === 'completed') {
          if (final !== null || !native || event.model !== native.model) throw new AppError('INVALID_PROTOCOL', 'Invalid final result.');
          final = event.text; call.usage = event.usage ?? null;
          measurement?.usage(event.usage, event.performanceUsage);
          if (roomPreview(final).trim()) measurement?.text('final-only');
        } else if (event.type === 'evidence') {
          if (!request.research) throw new AppError('UNEXPECTED_TOOLS', 'Research is disabled.');
          call.researchPerformed = true;
          await this.exclusive(async () => { const s = this.get(id); await this.commit({ ...s, evidence: [...s.evidence, { ...event.evidence, owner: actor, generation: call.generation }] }, 'evidence', { participant: actor }); });
        } else if (event.type === 'tool') {
          if (!request.research) throw new AppError('UNEXPECTED_TOOLS', 'Tools outside the policy.');
          call.researchPerformed = true;
          if (measurement && (!event.toolId || !toolIds.has(event.toolId))) { measurement.record.tools++; if (event.toolId) toolIds.add(event.toolId); }
        }
      }
      if (native === null || final === null || final.length > 500_000) throw new AppError('INVALID_PROTOCOL', 'Session and complete answer required.');
      const parsed = parseRoomAnswer(final), text = redact(parsed.text);
      await this.exclusive(async () => {
        const s = this.get(id); this.assertStorage(id);
        if (actor !== 'moderator' && runtime.turn) runtime.turn.open = false;
        request.signal.throwIfAborted();
        if (s.status !== 'running') throw new AppError('CANCELLED', 'Execution no longer active.');
        const valid = parsed.control?.taskVersion === call.taskVersion && parsed.control.grantId === call.grantId;
        const messages = purpose === 'monitor' ? s.messages : [...s.messages, this.message(s, actor, text, purpose === 'moderation' ? 'moderation' : purpose === 'summary' ? 'summary' : 'discussion', 'completed', call.id, call.taskVersion,
          parsed.control?.continuation)];
        const availableIds = new Set([...call.messages, ...(prepared.session?.delivered ?? [])]);
        const references = parsed.control?.references ?? [];
        const referencesValid = references.every(r => availableIds.has(r.messageId));
        let diagnostic: RoomCall['controlDiagnostic'] = parsed.diagnostic ?? (parsed.control?.taskVersion !== call.taskVersion ? 'task-version' : parsed.control?.grantId !== call.grantId ? 'grant' : !referencesValid ? 'references' : undefined);
        let workflow = s.room.workflow;
        let workError: unknown;
        if (workflow && purpose !== 'monitor') {
          try { workflow = updateWorkflow({ ...s, messages }, call, valid && referencesValid ? parsed.control : null, new Set([...availableIds, call.id]), text); }
          catch (error) {
            workError = error; diagnostic = error instanceof AppError && error.code === 'WORKFLOW_LIMIT' ? 'workflow-limit' : 'workflow-reference';
            workflow = updateWorkflow({ ...s, messages }, call, null, new Set([...availableIds, call.id]), text);
          }
        }
        const completed: RoomCall = { ...call, nativeSessionId: native!.id, status: 'completed', durationMs: Date.now() - started,
          references: referencesValid ? references.map(r => ({ ...r, reason: redact(r.reason) })) : [], ...(diagnostic ? { controlDiagnostic: diagnostic } : {}) };
        const session = { ...native!, generation: call.generation, delivered: [...new Set([...(prepared.session?.delivered ?? []), ...call.messages, ...(purpose === 'monitor' ? [] : [call.id])])], configurationVersion: s.room.configurationVersion };
        measurement?.mark(purpose === 'monitor' ? 'diagnosticCommitStart' : 'answerCommitStart');
        await this.commit({ ...s, messages, room: { ...s.room, ...(workflow ? { workflow } : {}), sessions: fresh ? s.room.sessions : { ...s.room.sessions, [actor]: session }, calls: s.room.calls.map(c => c.id === call.id ? completed : c) } },
          purpose === 'monitor' ? 'state' : 'message', purpose === 'monitor' ? { monitorCompleted: call.id } : { message: messages.at(-1)! });
        measurement?.mark(purpose === 'monitor' ? 'diagnosticCommitEnd' : 'answerCommitEnd');
        if (measurement) { measurement.record.answerSaved = purpose !== 'monitor'; if (purpose === 'monitor') measurement.record.diagnosticsSaved = true; }
        if (!referencesValid) throw new AppError('INVALID_REFERENCE', 'Public answer saved; response references input outside its owned session snapshot.');
        if (!valid) throw new AppError('INVALID_CONTROL', `公開回答已保存，控制資料無效（${diagnostic}）；已暫停且不重送。`);
        if (workError) throw workError;
      });
      measurement?.end('success'); return { call, text, control: parsed.control };
    } catch (error) {
      measurement?.mark('failureObserved');
      let outcome = this.measurementOutcome(id, error, request.signal, runtime, measurement, signal?.aborted);
      try {
        runtime.turn && actor !== 'moderator' && (runtime.turn.open = false);
        if (!this.store.isBlocked(id)) await this.exclusive(async () => {
          const s = this.get(id); const saved = s.room.calls.find(c => c.id === call.id); if (saved?.status === 'completed') return;
          const cancelled = runtime.abort.signal.aborted || signal?.aborted === true;
          const message = this.message(s, actor, redact(roomPreview(partial)), purpose === 'moderation' || purpose === 'monitor' ? 'moderation' : purpose === 'summary' ? 'summary' : 'discussion', cancelled ? 'cancelled' : 'indeterminate', call.id, call.taskVersion);
          if (runtime.turn?.interrupted && actor !== 'moderator') message.interruptedBy = 'moderator';
          const sessions = { ...s.room.sessions }; delete sessions[actor];
          await this.commit({ ...s, messages: purpose === 'monitor' ? s.messages : [...s.messages, message],
            room: { ...s.room, sessions, calls: s.room.calls.map(c => c.id === call.id ? { ...c, status: cancelled ? 'cancelled' : 'failed', durationMs: Date.now() - started } : c) } }, 'error', { callId: call.id, participant: actor, error: safeError(error) });
        });
      } catch (commitError) { outcome = this.measurementOutcome(id, commitError, request.signal, runtime, measurement, signal?.aborted); throw commitError; }
      finally { measurement?.end(outcome); }
      throw error;
    }
  }
  private message(s: RoomDiscussion, sender: RoomMessage['sender'], text: string, purpose: RoomMessage['purpose'], status: RoomMessage['status'] = 'completed', id: string = randomUUID(), taskVersion = s.room.taskVersion, continuation?: RoomMessage['continuation']): RoomMessage {
    return { id, sender, recipient: 'all', text, purpose, status, round: s.round, createdAt: new Date().toISOString(), inReplyTo: null, taskVersion, ...(continuation ? { continuation } : {}) };
  }
  private unhandledRequests(s: RoomDiscussion) {
    const addressed = new Set(s.room.calls.filter(c => c.status === 'completed' && c.purpose === 'discussion' && c.participant !== 'moderator')
      .flatMap(c => c.references.filter(r => r.disposition === 'addressed').map(r => r.messageId)));
    return s.messages.filter(m => m.sender === 'user' && m.purpose === 'discussion' && m.status === 'completed' && !addressed.has(m.id)).map(m => m.id);
  }
  private async command(id: string, runtime: Runtime, result: CallResult, monitor: boolean) {
    return this.exclusive(async () => {
      const s = this.get(id); this.assertStorage(id); const control = result.control!;
      if (!s.moderator || result.call.participant !== 'moderator') throw new AppError('INVALID_CONTROL', 'Only the moderator may issue commands.');
      if (runtime.abort.signal.aborted || s.status !== 'running') return;
      if (result.call.taskVersion !== s.room.taskVersion) return;
      const action = control.action;
      if (['none', 'propose', 'confirm'].includes(action.type)) throw new AppError('INVALID_CONTROL', 'Moderator command required.');
      const a = JSON.parse(JSON.stringify(action, (_, value: unknown) => typeof value === 'string' ? redact(value) : value)) as ModeratorAction;
      const turn = runtime.turn;
      if (monitor && (!turn?.open || result.call.draft?.turnId !== turn.id || result.call.grantId !== turn.grantId)) return;
      if (monitor && !['observe', 'interrupt', 'mute'].includes(a.type)) throw new AppError('INVALID_CONTROL', 'Monitor command cannot change the next turn.');
      if ('target' in a && !s.participants.some(p => p.id === a.target)) throw new AppError('INVALID_REFERENCE', 'Unknown moderator target.');
      if (monitor && a.type === 'mute' && a.target !== turn!.actor) throw new AppError('INVALID_CONTROL', 'Monitor mute must target the current speaker.');
      if (!isJudge(s) && !['observe', 'speak'].includes(a.type)) {
        const commandId = randomUUID();
        await this.commit({ ...s, room: { ...s.room, commands: [...s.room.commands, { id: commandId, callId: result.call.id, action: a, applied: false }] } },
          'state', { moderatorCommand: commandId, action: a.type, rejected: 'judge-mode-required' });
        return;
      }
      if (!monitor && a.type === 'interrupt') throw new AppError('INVALID_CONTROL', 'There is no live turn to interrupt.');
      const redirect = !monitor && !runtime.pause && (a.type === 'pause' || a.type === 'finish') ? continuationTask(s) : null;
      if (redirect) {
        const commandId = randomUUID();
        const exhausted = ++runtime.redirects > Math.max(3, s.participants.length + 1);
        await this.commit({ ...s, status: exhausted ? 'paused' : s.status,
          pauseReason: exhausted ? '主持人未完成必要的分析或核對；已達調度修正上限，請查看階段成果。' : null,
          messages: [...s.messages, this.message(s, 'moderator', exhausted ? '調度修正已達上限，保留階段成果。' : '系統未套用本次暫停／結束：仍有可執行的分析或核對任務，繼續安排發言。', 'notice')],
          room: { ...s.room, commands: [...s.room.commands, { id: commandId, callId: result.call.id, action: a, applied: false }],
            grant: exhausted ? null : { id: randomUUID(), ...redirect, version: s.room.taskVersion }, currentSpeaker: exhausted ? null : redirect.target } }, 'state', { moderatorCommand: commandId, action: a.type, rejected: 'pending-work' });
        return;
      }
      const commandId = randomUUID(), room = { ...s.room, commands: [...s.room.commands, { id: commandId, callId: result.call.id, action: a, applied: a.type !== 'topic' }] };
      let messages = s.messages, reason = s.pauseReason; let status: RoomDiscussion['status'] = s.status;
      if (a.type === 'speak') {
        if (room.muted.includes(a.target)) throw new AppError('INVALID_CONTROL', 'Muted speaker cannot receive a grant.');
        const queued = runnableTasks(s).find(t => t.task === a.task && (!t.target || t.target === a.target));
        room.grant = { id: randomUUID(), target: a.target, task: redact(a.task), version: room.taskVersion, ...(queued ? { taskKey: queued.key } : {}) }; room.currentSpeaker = a.target;
      } else if (a.type === 'mute' || a.type === 'unmute') {
        room.muted = a.type === 'mute' ? [...new Set([...room.muted, a.target])] : room.muted.filter(p => p !== a.target);
        messages = [...messages, this.message(s, 'moderator', `${a.type === 'mute' ? '停止發言' : '解除停止發言'}：${a.target}\n${redact(a.reason)}`, 'notice')];
        if (room.grant?.target === a.target && a.type === 'mute') { room.grant = null; room.currentSpeaker = null; }
      } else if (a.type === 'topic') {
        room.pendingTopic = { commandId, oldTitle: s.topic, title: redact(a.title), reason: redact(a.reason) };
        messages = [...messages, this.message(s, 'moderator', `主題變更通知\n原題：${s.topic}\n新題：${room.pendingTopic.title}\n理由：${room.pendingTopic.reason}\n保留原始目標與限制。`, 'notice')];
      } else if (a.type === 'pause') { status = 'paused'; reason = redact(a.reason); }
      else if (a.type === 'finish') {
        const problem = s.room.deliveryVersion === 1 ? deliveryProblem(a) : null;
        if (problem) {
          room.commands.at(-1)!.applied = false;
          room.conclusionRequest = { target: 'moderator', reason: problem };
          await this.commit({ ...s, room }, 'state', { conclusionRejected: problem }); return;
        }
        room.conclusionRequest = null;
        room.outcome = { authority: 'moderator', result: redact(a.result), dissent: a.dissent.map(value => redact(value)), unresolved: a.unresolved.map(value => redact(value)), unhandledRequests: this.unhandledRequests(s), ...(a.delivery ? { delivery: savedDelivery(a.delivery) } : {}) };
        status = 'paused'; reason = a.delivery?.status === 'partial' ? '主持人已保存暫定結果；結論交付尚未完成。' : '主持人已裁決結束；異議及未解事項保留。';
      } else if (a.type === 'interrupt') messages = [...messages, this.message(s, 'moderator', `主持人中止本次發言：${redact(a.reason)}`, 'notice')];
      if (monitor && (a.type === 'interrupt' || a.type === 'mute')) { room.grant = null; room.currentSpeaker = null; }
      await this.commit({ ...s, room, messages, status, pauseReason: reason }, 'state', { moderatorCommand: commandId, action: a.type });
      if (monitor && (a.type === 'interrupt' || a.type === 'mute')) {
        turn!.interrupted = true; turn!.reason = a.reason; turn!.open = false; turn!.abort.abort(new AppError('MODERATOR_INTERRUPTED', 'Interrupted by moderator.'));
      }
    });
  }
  private async applyTopic(id: string) {
    await this.exclusive(async () => {
      const s = this.get(id), pending = s.room.pendingTopic; if (!pending) return;
      if (s.status !== 'running' || this.runtimes.get(id)?.turn) throw new AppError('BUSY', 'Topic changes require an idle boundary.');
      await this.commit({ ...s, topic: pending.title, room: { ...s.room, pendingTopic: null, taskVersion: s.room.taskVersion + 1,
        configurationVersion: s.room.configurationVersion + 1, grant: null, currentSpeaker: null, proposal: null, conclusionRequest: null,
        ...(s.room.workflow ? { workflow: { ...s.room.workflow, revision: s.room.workflow.revision + 1, tasks: [] } } : {}),
        commands: s.room.commands.map(c => c.id === pending.commandId ? { ...c, applied: true } : c),
        topicHistory: [...s.room.topicHistory, { title: pending.title, version: s.room.taskVersion + 1, reason: pending.reason }] } }, 'state', { topicChanged: true });
    });
  }
  private async speak(id: string, runtime: Runtime, actor: ParticipantId, task: string) {
    const s = this.get(id), grantId = s.room.grant?.id ?? randomUUID();
    const turn: ActiveTurn = { id: '', grantId, actor, abort: new AbortController(), open: true, text: '', interrupted: false, reason: '' };
    runtime.turn = turn;
    let checked = 0, nextCheck = Date.now() + this.monitorIntervalMs, monitorTask: Promise<void> | null = null, monitorError: unknown;
    // Separate controllers let moderator interruption cancel this turn while preserving the discussion runtime.
    const monitorAbort = new AbortController();
    const timer = s.moderator && isJudge(s) ? setInterval(() => {
      if (!turn.open || runtime.abort.signal.aborted || Date.now() < nextCheck || turn.text.length <= checked || monitorTask) return;
      nextCheck = Date.now() + this.monitorIntervalMs; checked = turn.text.length;
      const draft = { turnId: turn.id, text: turn.text, through: checked };
      monitorTask = this.call(id, runtime, 'moderator', 'monitor', 'Check this provisional public draft for repetition, irrelevant content or a reason to stop; preserve the original goal and constraints.', draft, undefined, monitorAbort.signal)
        .then(result => this.command(id, runtime, result, true)).catch(error => {
          if (!monitorAbort.signal.aborted) { monitorError = error; turn.abort.abort(); }
        }).finally(() => { monitorTask = null; });
    }, Math.min(250, this.monitorIntervalMs)) : undefined;
    try {
      const result = await this.call(id, runtime, actor, 'discussion', task, null, text => {
        const call = this.get(id).room.calls.findLast(c => c.participant === actor && c.status === 'prepared');
        turn.id = call?.id ?? ''; turn.text = text;
      }, turn.abort.signal);
      turn.open = false;
      if (monitorTask) { monitorAbort.abort(); await monitorTask; }
      if (monitorError) throw monitorError;
      await this.exclusive(async () => {
        const current = this.get(id); const room = { ...current.room, grant: null, currentSpeaker: null, contributions: current.room.contributions + 1 };
        if (result.call.taskVersion === room.taskVersion && (!current.moderator || !isJudge(current))) {
          const action = result.control!.action;
          if (action.type === 'propose') {
            const problem = room.deliveryVersion === 1 ? deliveryProblem(action) : null;
            if (problem) room.conclusionRequest = { target: actor, reason: problem };
            else {
              room.conclusionRequest = null;
              room.proposal = { id: result.call.id, author: actor, taskVersion: room.taskVersion, result: redact(action.result), dissent: action.dissent.map(value => redact(value)), unresolved: action.unresolved.map(value => redact(value)), confirmed: [actor],
                ...(action.delivery ? { delivery: savedDelivery(action.delivery), reviews: [] } : {}) };
            }
          }
          else if (action.type === 'confirm') {
            if (!room.proposal || room.proposal.id !== action.proposalId || room.proposal.taskVersion !== room.taskVersion || room.proposal.author === actor) throw new AppError('INVALID_CONTROL', 'Confirmation does not match a peer proposal.');
            const review = action.review;
            if (room.deliveryVersion === 1 && !review) room.conclusionRequest = { target: actor, reason: 'Independently review whether this exact proposal answers the original user request at the requested depth. Include review {adequate,reason,gaps}; agreement alone is not delivery review.' };
            else {
              if (review) room.proposal = { ...room.proposal, reviews: [...(room.proposal.reviews ?? []).filter(r => r.actor !== actor), { ...review, reason: redact(review.reason), gaps: review.gaps.map(value => redact(value)), actor, callId: result.call.id }] };
              if (review && (!review.adequate || review.gaps.length > 0)) {
                room.proposal = { ...room.proposal, confirmed: room.proposal.confirmed.filter(id => id !== actor) };
                room.conclusionRequest = { target: room.proposal.author, reason: redact(`Revise the proposed answer to the original request, addressing this peer delivery review: ${review.reason}\nAddress the specific gaps in the current proposal's reviews. Publish a new proposal containing the requested answer and retained disagreements/limitations; do not merely promise future work unless that is what the user requested.`) };
              } else {
                room.proposal = { ...room.proposal, confirmed: [...new Set([...room.proposal.confirmed, actor])] };
                if (room.conclusionRequest?.target === actor) room.conclusionRequest = null;
              }
            }
          } else if (action.type !== 'none') throw new AppError('INVALID_CONTROL', 'Speaker cannot issue moderator commands.');
          if ((action.type === 'confirm' || current.room.workflow) && room.proposal?.taskVersion === room.taskVersion &&
            current.participants.every(p => room.proposal!.confirmed.includes(p.id)) && !room.conclusionRequest && !continuationTask({ ...current, room }))
            room.outcome = { authority: 'participants', result: room.proposal.result, dissent: room.proposal.dissent, unresolved: room.proposal.unresolved, unhandledRequests: this.unhandledRequests(current), ...(room.proposal.delivery ? { delivery: room.proposal.delivery } : {}) };
        } else if (current.moderator && !['none', 'propose', 'confirm'].includes(result.control!.action.type)) throw new AppError('INVALID_CONTROL', 'Speaker cannot issue moderator commands.');
        await this.commit({ ...current, room });
      });
      return result;
    } catch (error) {
      turn.open = false; monitorAbort.abort(); if (monitorTask) await monitorTask;
      if (monitorError) throw monitorError;
      if (!turn.interrupted || this.store.isBlocked(id) || runtime.abort.signal.aborted) throw error;
      if (error instanceof AppError && error.code === 'PROCESS_STUCK') throw error;
      await this.exclusive(async () => { const current = this.get(id); await this.commit({ ...current,
        room: { ...current.room, grant: null, currentSpeaker: null, contributions: current.room.contributions + 1 } }); });
      return null;
    } finally { if (timer) clearInterval(timer); monitorAbort.abort(); runtime.turn = null; }
  }
  private nextSpeaker(s: RoomDiscussion, previous: ParticipantId | null) {
    const eligible = s.participants.filter(p => !s.room.muted.includes(p.id)); if (!eligible.length) return null;
    if (s.room.conclusionRequest && eligible.some(p => p.id === s.room.conclusionRequest!.target)) return s.room.conclusionRequest.target;
    const queued = runnableTasks(s)[0]; if (queued) return queued.target ?? eligible.find(p => p.id !== previous)?.id ?? eligible[0]!.id;
    const last = previous ? s.messages.findLast(m => m.sender === previous && m.purpose === 'discussion' && m.status === 'completed') : undefined;
    if (s.flow === 'free' && last?.continuation === 'continue') {
      const tail = s.messages.filter(m => m.purpose === 'discussion' && m.sender !== 'user' && m.status === 'completed').slice(-3);
      if (tail.length < 3 || tail.some(m => m.sender !== previous)) return previous;
    }
    const start = previous ? eligible.findIndex(p => p.id === previous) + 1 : s.room.contributions % eligible.length;
    for (let i = 0; i < eligible.length; i++) {
      const p = eligible[(start + i) % eligible.length]!;
      const message = s.messages.findLast(m => m.sender === p.id && m.purpose === 'discussion' && m.status === 'completed');
      const unseenUser = this.eligible(s, p.id).some(m => m.sender === 'user' && !this.sessionFor(s, p.id)?.delivered.includes(m.id));
      if (s.flow !== 'free' || !message || message.continuation !== 'done' || unseenUser || s.room.proposal && !s.room.proposal.confirmed.includes(p.id)) return p.id;
    }
    return null;
  }
  private async execute(id: string, runtime: Runtime) {
    try {
      if (runtime.purpose === 'summary') {
        const s = this.get(id), actors: ParticipantId[] = s.moderator ? ['moderator'] : s.participants.map(p => p.id);
        for (const actor of actors) await this.call(id, runtime, actor, 'summary', 'Summarize eligible saved discussion, checking earlier summary drafts and preserving disagreements, unknowns and limitations. Do not declare completion.', null, undefined, undefined, true);
        await this.exclusive(async () => { const current = this.get(id); if (current.status === 'running') await this.commit({ ...current, status: 'paused', pauseReason: '已完成公開討論整理。' }); }); return;
      }
      let previous: ParticipantId | null = null, decisionsWithoutSpeech = 0;
      const startContributions = this.get(id).room.contributions;
      while (!runtime.abort.signal.aborted) {
        let s = this.get(id); if (s.status !== 'running') break;
        if (runtime.pause || this.elapsed(runtime) >= s.limits.maxDurationMs || s.room.contributions >= s.limits.maxRounds * s.participants.length || s.room.outcome ||
          s.mode === 'manual' && s.room.contributions - startContributions >= s.participants.length) {
          await this.exclusive(async () => { const current = this.get(id); if (current.status === 'running' && !runtime.abort.signal.aborted) await this.commit({ ...current, status: 'paused', pauseReason: runtime.pause ? 'Paused by user.' : current.room.outcome?.delivery?.status === 'partial' ? '暫定結果已保存，結論交付尚未完成。' : current.room.outcome ? '參與者已確認同一版結果，保留分歧與限制。' : '本輪或執行上限已達，請明確續談。' }); }); break;
        }
        if (s.moderator && isJudge(s)) {
          const result = await this.call(id, runtime, 'moderator', 'moderation', 'Choose the next useful speaking task, deepen an unresolved question, publicly explain a decision, change a related topic or finish with limitations. You cannot see directed messages.');
          await this.command(id, runtime, result, false); await this.applyTopic(id); s = this.get(id);
          if (s.status !== 'running') break;
          if (!s.room.grant) {
            if (++decisionsWithoutSpeech >= 8) throw new AppError('MODERATOR_STALLED', '主持人連續裁決未安排發言；已暫停。'); continue;
          }
          decisionsWithoutSpeech = 0; previous = s.room.grant.target; await this.speak(id, runtime, previous, s.room.grant.task);
        } else {
          if (s.room.conclusionRequest && ++runtime.deliveryCorrections > 3) {
            await this.exclusive(async () => { const current = this.get(id); if (current.status === 'running' && !runtime.abort.signal.aborted) await this.commit({ ...current, status: 'paused', pauseReason: '結論仍需補寫或審查；已達本次修正上限，保留原文與缺漏，請明確續談。' }); }); break;
          }
          let actor: ParticipantId | null = s.room.grant?.target ?? this.nextSpeaker(s, previous);
          const next = continuationTask(s);
          if (!actor && next && ++runtime.redirects <= 3) actor = next.target;
          if (!actor) { await this.exclusive(async () => { const current = this.get(id); if (current.status === 'running' && !runtime.abort.signal.aborted) await this.commit({ ...current, status: 'paused', pauseReason: next ? '未完成必要的分析或核對；已達調度修正上限，請查看階段成果。' : current.room.workflow ? '目前沒有可執行任務；保留階段成果與待補充問題。' : '所有參與者等待新輸入。' }); }); break; }
          const queued = runnableTasks(s).find(t => !t.target || t.target === actor);
          const invitation = s.room.grant?.task;
          const task = queued?.task ?? (next && next.target === actor ? next.task : invitation ? `The moderator invites you to address: ${invitation}\nTreat this as an optional angle. Develop the original topic freely and respond to public peer arguments.` : s.room.workflow ? 'Discuss the original question from your perspective and respond to other speakers. Choose useful directions yourself.' : 'Develop the current issue, answer eligible user requests and check public peer claims.');
          await this.exclusive(async () => { const current = this.get(id); await this.commit({ ...current, room: { ...current.room,
            currentSpeaker: actor, grant: { id: randomUUID(), target: actor!, task, version: current.room.taskVersion, ...(queued ? { taskKey: queued.key } : {}) } } }); });
          await this.speak(id, runtime, actor, task); previous = actor;
        }
        await this.exclusive(async () => { const current = this.get(id); await this.commit({ ...current, round: Math.floor(current.room.contributions / current.participants.length) + 1 }); });
        s = this.get(id);
        if (s.moderator && !isJudge(s) && !runtime.pause && !runtime.abort.signal.aborted && s.status === 'running' &&
          s.room.moderatorCalls < s.limits.maxModeratorCalls && (s.room.outcome || s.room.contributions % s.participants.length === 0)) {
          const result = await this.call(id, runtime, 'moderator', 'moderation', s.room.outcome ?
            'Briefly present the result explicitly confirmed by every speaker. Preserve its meaning, dissent and limitations. Use observe; do not substitute your own judgment.' :
            'If useful, briefly coordinate the next exchange or invite a speaker to address a remaining point. Do not answer the topic yourself, narrow it, pause it or claim a conclusion. Prefer observe.');
          await this.command(id, runtime, result, false);
        }
      }
    } catch (error) {
      if (!this.store.isBlocked(id)) await this.exclusive(async () => { const s = this.get(id); if (s.status === 'running') await this.commit({ ...s,
        status: runtime.abort.signal.aborted ? 'stopped' : s.room.calls.some(c => c.status === 'failed' && Date.parse(c.startedAt) >= runtime.startedAt) ? 'indeterminate' : 'paused', pauseReason: safeError(error), room: { ...s.room, grant: null, currentSpeaker: null } }, 'error', { error: safeError(error) }); });
    } finally {
      try { if (!this.store.isBlocked(id)) await this.exclusive(async () => { const s = this.get(id); await this.commit({ ...s,
        elapsedMs: this.elapsed(runtime), activity: null, room: { ...s.room, grant: null, currentSpeaker: null } }); }); }
      finally { this.runtimes.delete(id); }
    }
  }
  async pause(id: string) { return this.exclusive(async () => { const s = this.get(id); const r = this.runtimes.get(id); if (r) r.pause = true;
    await this.commit({ ...s, status: r ? s.status : 'paused', pauseReason: 'User requested pause after the current answer.' }); return this.get(id); }); }
  async stop(id: string) { return this.exclusive(async () => { const s = this.get(id); await this.commit({ ...s, status: 'stopped', pauseReason: 'Stopped by user.', room: { ...s.room, grant: null, currentSpeaker: null } }); this.runtimes.get(id)?.abort.abort(); return this.get(id); }); }
  async send(id: string, messageId: string, text: string, recipient: ParticipantId | 'all', inReplyTo: string | null = null) {
    return this.exclusive(async () => {
      const s = this.get(id); const normalized = redact(text); const old = s.messages.find(m => m.id === messageId);
      if (old) { if (old.sender !== 'user' || old.text !== normalized || old.recipient !== recipient || old.inReplyTo !== inReplyTo) throw new AppError('IDEMPOTENCY_CONFLICT', 'Message ID already used.'); return s; }
      if (s.status === 'stopped' || s.status === 'indeterminate') throw new AppError('INVALID_STATE', 'Rebuild before adding input.');
      if (recipient !== 'all' && !s.participants.some(p => p.id === recipient)) throw new AppError('INVALID_REFERENCE', 'Directed input is restricted to speaker seats. Moderator input is public.');
      if (recipient === 'moderator') throw new AppError('INVALID_REFERENCE', 'Moderator accepts public messages only.');
      if (inReplyTo && !s.messages.some(m => m.id === inReplyTo && m.status === 'completed' && (m.recipient === 'all' || recipient !== 'all' && m.recipient === recipient))) throw new AppError('INVALID_REFERENCE', 'Reply outside recipient visibility.');
      const m = { ...this.message(s, 'user', normalized, 'discussion', 'completed', messageId), recipient, inReplyTo };
      await this.commit({ ...s, messages: [...s.messages, m], room: { ...s.room, taskVersion: s.room.taskVersion + 1, outcome: null, proposal: null, conclusionRequest: null } }, 'message', { message: m }); return this.get(id);
    });
  }
  async configure(id: string, patch: { mode?: RoomInput['mode'] | undefined; flow?: RoomInput['flow'] | undefined; limits?: Omit<RoomInput['limits'], 'maxModeratorCalls'> & { maxModeratorCalls?: number | undefined } | undefined; topic?: string | undefined; goal?: string | undefined; constraints?: string | undefined; expectedVersion?: number | undefined; confirmRoles?: boolean | undefined;
    research?: boolean | undefined; roots?: string[] | undefined; discussionPolicyVersion?: 1 | undefined; moderatorMode?: RoomInput['moderatorMode'] | undefined }) {
    return this.exclusive(async () => {
      const s = this.get(id); if (this.busy) throw new AppError('BUSY', 'Pause before changing settings.');
      if (patch.expectedVersion !== s.room.configurationVersion) throw new AppError('VERSION_CONFLICT', 'Refresh before changing settings.');
      if (patch.moderatorMode && !s.moderator) throw new AppError('INVALID_STATE', 'Moderator mode requires a moderator.');
      const research = patch.research ?? s.research;
      if (research && (s.backend !== 'live' || [...s.participants, ...(s.moderator ? [s.moderator] : [])].some(p => !['codex', 'claude'].includes(p.provider))))
        throw new AppError('RESEARCH_UNVERIFIED', '研究只允許已接線的 Codex／Claude 真實討論。');
      if (patch.roots?.length && !research) throw new AppError('RESEARCH_DISABLED', '啟用研究後才能設定本機讀取範圍。');
      const roots = research ? await validateRoots(patch.roots ?? s.roots) : [];
      const modeChanged = patch.moderatorMode !== undefined && patch.moderatorMode !== (s.moderatorMode ?? 'facilitator');
      const resetSessions = modeChanged || research !== s.research || JSON.stringify(roots) !== JSON.stringify(s.roots) || patch.discussionPolicyVersion === 1 && !s.room.workflow;
      const { expectedVersion: _, confirmRoles, ...settings } = patch;
      const changed: RoomDiscussion = { ...s, ...Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)), limits: { ...s.limits, ...patch.limits, maxModeratorCalls: patch.limits?.maxModeratorCalls ?? s.limits.maxModeratorCalls }, rolesConfirmed: confirmRoles ? true : s.rolesConfirmed,
        research, roots,
        topic: patch.topic === undefined ? s.topic : redact(patch.topic), goal: patch.goal === undefined ? s.goal : redact(patch.goal), constraints: patch.constraints === undefined ? s.constraints : redact(patch.constraints) };
      const taskChanged = changed.topic !== s.topic || changed.goal !== s.goal || changed.constraints !== s.constraints;
      if (taskChanged) changed.messages = [...s.messages, this.message(s, 'user', `使用者更新題目／目標／限制\n題目：${changed.topic}\n目標：${changed.goal}\n限制：${changed.constraints}`, 'notice')];
      changed.room = { ...s.room, configurationVersion: s.room.configurationVersion + 1, taskVersion: s.room.taskVersion + 1, grant: null, currentSpeaker: null,
        ...(resetSessions ? { sessions: {} } : {}),
        ...(patch.moderatorMode === 'facilitator' ? { muted: [] } : {}),
        ...(patch.discussionPolicyVersion === 1 && !s.room.workflow ? { workflow: emptyWorkflow() } : {}),
        ...(taskChanged && s.room.workflow ? { workflow: { ...s.room.workflow, revision: s.room.workflow.revision + 1, tasks: [] } } : {}),
        proposal: null, outcome: null, conclusionRequest: null, ...(taskChanged ? { topicHistory: [...s.room.topicHistory, { title: changed.topic, version: s.room.taskVersion + 1, reason: 'User configuration' }] } : {}) };
      if (resetSessions) changed.messages = [...changed.messages, this.message(s, 'user', `使用者更新討論策略／研究權限：主動討論 ${changed.discussionPolicyVersion === 1 ? '啟用' : '未啟用'}，研究 ${research ? '啟用' : '停用'}。工作階段將以已確認紀錄重建，不會自動發言。`, 'notice')];
      if (patch.moderatorMode !== undefined) changed.messages = [...changed.messages, this.message(s, 'user', `使用者設定主持人為${patch.moderatorMode === 'judge' ? '裁判模式：可強制介入，裁決不代表全體共識' : '一般主持：只協調發言，正式結論需發言者明確共識'}。`, 'notice')];
      await this.commit(changed); return this.get(id);
    });
  }
  async rename(id: string, displayName: string, expectedVersion: number) {
    return this.exclusive(async () => { const s = this.get(id); if (this.busy) throw new AppError('BUSY', 'Pause before renaming.');
      if ((s.displayVersion ?? 0) !== expectedVersion) throw new AppError('VERSION_CONFLICT', 'Display version changed.');
      await this.commit({ ...s, displayName: redact(displayName.trim()), displayVersion: expectedVersion + 1 }); return this.get(id); });
  }
  async rebuild(id: string, operationId: string, expectedVersion: number) {
    return this.exclusive(async () => { const s = this.get(id); this.assertStorage(id); if (this.busy) throw new AppError('BUSY', 'Wait for owned processes to close.');
      const fingerprint = JSON.stringify({ action: 'rebuild', expectedVersion }); if (this.repeated(s, operationId, fingerprint)) return s;
      if (s.room.taskVersion !== expectedVersion) throw new AppError('VERSION_CONFLICT', 'Task version changed.');
      // Overlapping prepared calls reserve their union duration, rather than summing concurrent time twice.
      const outstanding = s.room.calls.filter(c => c.status === 'prepared');
      const reserved = outstanding.length ? Math.max(...outstanding.map(c => Date.parse(c.startedAt) + c.reservationMs)) - Math.min(...outstanding.map(c => Date.parse(c.startedAt))) : 0;
      await this.commit({ ...s, status: 'paused', activity: null, elapsedMs: s.elapsedMs + reserved, pauseReason: '已重建工作階段；將從已確認且合資格的紀錄續談。',
        room: { ...s.room, sessions: {}, grant: null, currentSpeaker: null, uncertainBudgetMs: s.room.uncertainBudgetMs + reserved,
          calls: s.room.calls.map(c => c.status === 'prepared' ? { ...c, status: 'failed' } : c), operations: [...s.room.operations, { id: operationId, fingerprint }] } }); return this.get(id); });
  }
  async recover(id: string, repairTail = false) { return this.exclusive(async () => { if (this.busy) throw new AppError('BUSY', 'Wait for cancellation cleanup.');
    const recovered = await this.store.recover(id, repairTail); if (!recovered.state) throw new AppError('RECOVERY_UNAVAILABLE', 'No confirmed history.'); this.states.set(id, recovered.state);
    await this.commit({ ...recovered.state, status: 'indeterminate', activity: null, room: { ...recovered.state.room, sessions: {}, grant: null, currentSpeaker: null }, pauseReason: 'Storage verified. Explicit session reconstruction is required before continuing.' }, 'recovered'); return this.get(id); }); }
  async resolveTopic(id: string, operationId: string, expectedVersion: number, apply: boolean) {
    return this.exclusive(async () => { const s = this.get(id); if (this.busy) throw new AppError('BUSY', 'Wait for an idle boundary.');
      const fingerprint = JSON.stringify({ action: 'resolve-topic', expectedVersion, apply }); if (this.repeated(s, operationId, fingerprint)) return s;
      if (s.room.taskVersion !== expectedVersion || !s.room.pendingTopic) throw new AppError('VERSION_CONFLICT', 'Pending topic changed.');
      const pending = s.room.pendingTopic;
      await this.commit({ ...s, ...(apply ? { topic: pending.title } : {}), room: { ...s.room, pendingTopic: null, taskVersion: s.room.taskVersion + 1,
        configurationVersion: s.room.configurationVersion + 1, proposal: null, outcome: null, conclusionRequest: null, grant: null,
        ...(apply && s.room.workflow ? { workflow: { ...s.room.workflow, revision: s.room.workflow.revision + 1, tasks: [] } } : {}),
        topicHistory: apply ? [...s.room.topicHistory, { title: pending.title, version: s.room.taskVersion + 1, reason: pending.reason }] : s.room.topicHistory,
        commands: s.room.commands.map(c => c.id === pending.commandId ? { ...c, applied: apply } : c), operations: [...s.room.operations, { id: operationId, fingerprint }] } }); return this.get(id); });
  }
  subscribe(id: string, listener: Listener) { this.get(id); const listeners = this.listeners.get(id) ?? new Set<Listener>(); listeners.add(listener); this.listeners.set(id, listeners); return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(id); }; }
  async events(id: string, after = 0) { this.get(id); return (await this.store.records(id)).map(r => r.event).filter(e => e.sequence > after); }
  async wait(id: string) { await this.runtimes.get(id)?.task; }
  async close() { for (const [id, r] of this.runtimes) { if (this.store.isBlocked(id)) r.abort.abort(); else await this.stop(id); } await Promise.all([...this.runtimes.values()].map(r => r.task)); }
}
