import { assertEditable, changeManagement, matchesIndex, summaryOf, type ManagementAction } from './management.js';
import { PerformanceStore, performanceReport, performanceMarkdown, type Measurement, type PerformanceObserver, type PerformanceRecord } from './performance.js';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AppError, discussionInputSchema, type AgentId, type AgentSession, type Discussion, type DiscussionInput, type Message, type RunEvent } from './domain.js';
import { buildPrompt, type AgentAdapter, type TurnRequest } from './adapters/types.js';
import { redact, safeError } from './redaction.js';
import { DiscussionStore } from './store.js';
import { validateRoots } from './research.js';
import { z } from 'zod';
import { chooseNext, hasConfirmedConclusion, parseContribution, publicPreview } from './conversation.js';
import { initialFocused, applyBoundary } from './focused.js';
import { executeFocused } from './focused-execution.js';
import { pausedStatus, StorageCommitError, type Runtime } from './execution-runtime.js';
import type { CallRecord, Issue } from './v2-contract.js';

type Listener = (event: RunEvent) => void;
const other = (id: AgentId): AgentId => id === 'codex' ? 'claude' : 'codex';
const MAX_RESPONSE_CHARS = 500_000;
const MAX_CONTEXT_CHARS = 1_000_000;

export class DiscussionController {
  private states = new Map<string, Discussion>();
  private listeners = new Map<string, Set<Listener>>();
  private runtimes = new Map<string, Runtime>();
  get busy() { return this.runtimes.size > 0; }
  has(id: string) { return this.states.has(id); }
  private lock: Promise<unknown> = Promise.resolve();
  private readonly storageBlocked = new Set<string>();

  constructor(private readonly store: DiscussionStore, private readonly adapters: Record<AgentId, AgentAdapter>,
    private readonly liveAdapters?: Record<AgentId, AgentAdapter>,
    private readonly beforeLive?: (state: Discussion, observer?: PerformanceObserver) => Promise<void | { codex: string | null; claude: string | null }>,
    readonly performance = new PerformanceStore(undefined, false)) {
    if (adapters.codex.backend !== adapters.claude.backend) throw new Error('Both adapters must use the same backend mode.');
  }
  private adaptersFor(state: Discussion) {
    const adapters = state.backend === this.adapters.codex.backend ? this.adapters : this.liveAdapters;
    if (!adapters || adapters.codex.backend !== state.backend) throw new AppError('BACKEND_UNAVAILABLE', 'Selected AI backend is unavailable.');
    return adapters;
  }

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.lock.then(action);
    this.lock = result.catch(() => undefined);
    return result;
  }

  async initialize(): Promise<void> {
    for (const state of await this.store.list()) {
      if (state.kind === 'discussion') state.rolesConfirmed = true;
      this.states.set(state.id, state);
      if (this.store.isBlocked(state.id)) {
        this.blockStorage(state.id);
        continue;
      }
      if (state.status === 'running' || state.activity !== null) {
        await this.commit({ ...state, activity: null,
          status: state.status === 'running' ? 'indeterminate' : state.status,
          pauseReason: state.status === 'running' ? 'Previous execution ended without a confirmed result.' : state.pauseReason }, 'recovered', {});
      }
    }
  }

  private async commit(state: Discussion, type: RunEvent['type'], data: Record<string, unknown>): Promise<void> {
    this.assertStorage(state.id);
    const updated = { ...state, sequence: state.sequence + 1 };
    const event: RunEvent = { sequence: updated.sequence, discussionId: state.id, type, at: new Date().toISOString(), data, commitId: randomUUID() };
    try { await this.store.commit(updated, event); }
    catch (error) {
      if (!this.store.isBlocked(state.id)) throw error;
      this.blockStorage(state.id); throw new StorageCommitError('Discussion journal commit failed.', { cause: error });
    }
    this.states.set(state.id, updated);
    for (const listener of this.listeners.get(state.id) ?? []) {
      try { listener(structuredClone(event)); } catch { /* A disconnected client cannot fail a discussion. */ }
    }
  }
  private assertStorage(id: string) {
    if (this.storageBlocked.has(id) || this.store.isBlocked(id)) throw new AppError('STORAGE_UNCONFIRMED', 'Storage is unconfirmed; recover the journal before any write or model request.');
  }
  private blockStorage(id: string) {
    this.storageBlocked.add(id);
    const state = this.states.get(id);
    if (state) this.states.set(id, { ...state, status: 'indeterminate', activity: null,
      pauseReason: 'Journal storage is unconfirmed; explicit recovery is required.', storage: { status: 'unconfirmed', reason: 'Journal storage is unconfirmed; explicit recovery is required.' } });
    this.runtimes.get(id)?.abort.abort(new AppError('STORAGE_UNCONFIRMED', 'Storage is unconfirmed.'));
    this.progress(id, { storage: 'unconfirmed', diagnosticsSaved: false });
  }
  async performanceView(id: string) { this.get(id); return this.performance.view(id); }
  async performanceBaseline(format: 'json' | 'markdown') {
    const report = performanceReport(await this.performance.view());
    return format === 'markdown' ? performanceMarkdown(report) : report;
  }
  private turnMeasurement(state: Discussion, runtime: Runtime, speaker: AgentId, request: TurnRequest) {
    return this.performance.begin({ kind: 'turn', discussionId: state.id, executionId: runtime.executionId, requestId: request.requestId ?? request.messageId,
      backend: state.backend, provider: speaker, participant: speaker, cliVersion: runtime.versions[speaker], model: request.settings.model, effort: request.settings.effort,
      research: Boolean(request.research), purpose: runtime.purpose, session: request.session ? 'resumed' : 'new', characters: null,
      round: state.round, position: state.messages.filter(m => m.sender !== 'user').length + 1 });
  }
  private measurementOutcome(error: unknown, runtime?: Runtime, signal?: AbortSignal, measurement?: Measurement): NonNullable<PerformanceRecord['outcome']> {
    if (error instanceof StorageCommitError || error instanceof AppError && error.code === 'STORAGE_UNCONFIRMED') return 'storage-unknown';
    if (runtime?.abort.signal.aborted) return 'cancelled';
    if (signal?.aborted) return 'timeout';
    if (measurement?.record.failurePhase === 'cleanupStart' || measurement?.record.failurePhase === 'inspectCleanupStart') return 'cleanup-error';
    if (measurement?.record.offsets.cleanupStart !== undefined && measurement.record.offsets.cleanupEnd === undefined || measurement?.record.offsets.inspectCleanupStart !== undefined && measurement.record.offsets.inspectCleanupEnd === undefined) return 'cleanup-error';
    if (error instanceof AppError && ['PROCESS_START', 'PROCESS_INPUT'].includes(error.code)) return 'startup-error';
    if (error instanceof AppError && error.code === 'CONTEXT_LIMIT') return 'failed';
    return runtime ? 'protocol-error' : 'failed';
  }


  isDeleted(id: string) { return this.store.isDeleted(id); }
  summaries(q = '', before?: string) { return [...this.states.values()].filter(s => !this.store.isDeleted(s.id) && matchesIndex(s, q, before)).map(s => summaryOf(s, this.runtimes.has(s.id))); }
  deletionIssues() { return this.store.deletionIssues(); }
  async manage(id: string, action: ManagementAction, operationId: string, expectedSequence: number) {
    return this.exclusive(async () => {
      const state = this.get(id); this.assertStorage(id);
      if (this.runtimes.has(id) || state.activity !== null || state.status === 'running') throw new AppError('BUSY', 'Wait for execution and cancellation cleanup before managing the discussion.');
      const management = changeManagement(state, action, operationId, expectedSequence);
      if (management) await this.commit({ ...state, management }, 'state', { managementAction: action });
      return this.get(id);
    });
  }
  async permanentDelete(id: string, operationId: string, expectedSequence: number) {
    return this.exclusive(async () => {
      if (this.runtimes.has(id)) throw new AppError('BUSY', 'Wait for cancellation cleanup before deleting the discussion.');
      if (!this.store.isDeleted(id)) { const state = this.get(id); this.assertStorage(id);
        if (state.activity !== null || state.status === 'running') throw new AppError('BUSY', 'Wait for an idle discussion.'); }
      try { return await this.store.permanentDelete(id, operationId, expectedSequence); }
      finally { if (this.store.isDeleted(id)) {
        for (const listener of this.listeners.get(id) ?? []) { try { listener({ sequence: 0, discussionId: id, type: 'progress', at: new Date().toISOString(), data: { deleted: true } }); } catch { /* Disconnected client. */ } }
        this.listeners.delete(id); this.states.delete(id); this.storageBlocked.delete(id);
      } }
    });
  }
  storageIssues() { return this.store.storageIssues(); }
  async recover(id: string, repairTail = false): Promise<Discussion> {
    return this.exclusive(async () => {
      if (this.runtimes.has(id)) throw new AppError('BUSY', 'Wait for cancellation and cleanup before recovering storage.');
      const result = await this.store.recover(id, repairTail);
      if (!result.state) throw new AppError('RECOVERY_UNAVAILABLE', 'No confirmed public history is available.');
      this.storageBlocked.delete(id);
      const state = result.state;
      this.states.set(id, state);
      const v2 = state.v2 ? { ...state.v2, receipts: state.v2.receipts.map(r => r.status === 'retired' ? r : { ...r, status: 'uncertain' as const }) } : undefined;
      await this.commit({ ...state, ...(v2 ? { v2 } : {}), status: 'indeterminate', activity: null,
        pauseReason: 'Storage verified. Explicit session reconstruction is required before continuing.' }, 'recovered', { outcome: result.outcome, backup: result.backup });
      return this.get(id);
    });
  }

  get(id: string): Discussion {
    if (this.store.isDeleted(id)) throw new AppError('DISCUSSION_DELETED', 'Discussion was permanently deleted.', 410);
    const state = this.states.get(id);
    if (!state) throw new AppError('NOT_FOUND', 'Discussion not found.', 404);
    return structuredClone(state);
  }
  list(): Discussion[] { return [...this.states.values()].map((state) => structuredClone(state)); }

  async create(id: string, input: DiscussionInput): Promise<Discussion> {
    return this.exclusive(async () => {
      await this.store.assertAvailable(id);
      const parsed = discussionInputSchema.parse(input);
      parsed.roots = await validateRoots(parsed.roots);
      parsed.roles = { codex: redact(parsed.roles.codex), claude: redact(parsed.roles.claude) };
      parsed.goal = redact(parsed.goal); parsed.constraints = redact(parsed.constraints);
      if (parsed.displayName !== undefined) parsed.displayName = redact(parsed.displayName);
      if (this.states.has(id)) {
        const existing = this.get(id);
        const previousInput = discussionInputSchema.parse({ displayName: existing.displayName, topic: existing.topic, mode: existing.mode, flow: existing.flow, agents: existing.agents, limits: existing.limits,
          backend: existing.backend, kind: existing.kind, roles: existing.roles, research: existing.research, roots: existing.roots,
          behaviorVersion: existing.behaviorVersion, goal: existing.goal, constraints: existing.constraints, focused: existing.focused });
        if (JSON.stringify(previousInput) !== JSON.stringify({ ...parsed, topic: redact(parsed.topic) })) {
          throw new AppError('IDEMPOTENCY_CONFLICT', 'The discussion ID was already used with different settings.');
        }
        return existing;
      }
      const createdAt = new Date().toISOString();
      const topic = redact(parsed.topic);
      const state: Discussion = {
        ...parsed, topic, id,
        status: 'ready', round: 1, nextSpeaker: 'codex', completedInRound: [], sessions: {},
        messages: [{ id: randomUUID(), sender: 'user', recipient: 'both', text: topic, round: 0,
          inReplyTo: null, status: 'completed', createdAt }],
        createdAt, elapsedMs: 0, pauseReason: null, operationIds: [], sequence: 0,
        rolesConfirmed: parsed.kind !== 'debate', activity: null, evidence: [],
      };
      if (parsed.behaviorVersion === 2) {
        state.v2 = initialFocused(topic);
        state.messages[0] = { ...state.messages[0]!, issueId: state.v2.currentIssueId, issueVersion: 1, taskVersion: 1, responseTarget: null };
        state.v2.requests = [{ messageId: state.messages[0]!.id, status: 'unmarked', responseId: null, reason: '' }];
      }
      await this.commit(state, 'created', { backend: state.backend });
      return this.get(id);
    });
  }

  async start(id: string, operationId: string, purpose: Runtime['purpose'] = 'discussion'): Promise<Discussion> {
    const executionId = randomUUID();
    const accepted = this.performance.captureTime();
    let measurement: Measurement | undefined;
    try { return await this.exclusive(async () => {
      assertEditable(this.get(id));
      let state = this.get(id);
      this.assertStorage(id);
      const fingerprint = JSON.stringify({ action: 'start', purpose });
      if (state.operationIds.includes(operationId)) {
        if (state.v2 && state.v2.operationRecords.find(o => o.id === operationId)?.fingerprint !== fingerprint) throw new AppError('IDEMPOTENCY_CONFLICT', 'Operation ID was used with different content.');
        return state;
      }
      measurement = this.performance.begin({ kind: 'execution', discussionId: id, executionId, requestId: null, backend: state.backend,
        provider: null, cliVersion: null, model: null, effort: null, research: state.research && purpose === 'discussion', purpose, session: null,
        characters: null, round: null, position: null }, accepted);
      measurement?.mark('locked');
      if (this.runtimes.size) throw new AppError('BUSY', 'Only one discussion can execute at a time.');
      if (purpose === 'discussion' && state.status === 'indeterminate') throw new AppError('RECONCILIATION_REQUIRED', 'An uncertain turn must be reconciled before resuming.');
      if (purpose === 'discussion' && state.status === 'stopped') throw new AppError('STOPPED', '請以「重建並續談」建立新的 AI 工作階段。');
      if (purpose === 'discussion' && state.v2?.completed) throw new AppError('COMPLETED', 'The overall result was explicitly confirmed. Add input or select a new issue before resuming.');
      if (purpose === 'discussion' && !state.rolesConfirmed) throw new AppError('ROLES_REQUIRED', '請先確認雙方辯論立場。');
      if (purpose === 'roles' && state.kind !== 'debate') throw new AppError('INVALID_STATE', '只有辯論需要提議立場。');
      if (purpose === 'discussion' && state.round > state.limits.maxRounds) throw new AppError('ROUND_LIMIT', 'The discussion reached its round limit. Increase the limit before continuing.');
      this.adaptersFor(state);
      const versions = state.backend === 'live' ? await this.beforeLive?.(state, measurement?.mark) : undefined;
      if (measurement && versions) measurement.record.cliVersions = versions;
      if (purpose === 'discussion' && state.completedInRound.length === 2) {
        if (state.round >= state.limits.maxRounds) throw new AppError('ROUND_LIMIT', 'The discussion reached its round limit.');
        state = { ...state, round: state.round + 1, completedInRound: [], nextSpeaker: state.flow === 'free' ? state.nextSpeaker : other(state.round % 2 === 1 ? 'codex' : 'claude') };
      }
      if (purpose === 'discussion' && state.elapsedMs >= state.limits.maxDurationMs) throw new AppError('TIME_LIMIT', 'The discussion reached its duration limit.');
      const originalStatus = state.status;
      await this.commit({ ...state, status: 'running', pauseReason: null,
        activity: purpose, operationIds: [...state.operationIds, operationId],
        ...(state.v2 ? { v2: { ...state.v2, operationRecords: [...state.v2.operationRecords, { id: operationId, fingerprint }] } } : {}) }, 'state', { status: 'running', purpose });
      const runtime: Runtime = { executionId, versions: versions ?? { codex: null, claude: null }, abort: new AbortController(), pause: false, startedAt: Date.now(), task: Promise.resolve(), purpose, originalStatus };
      this.runtimes.set(id, runtime);
      // Defer work until this state transition releases the lock.
      runtime.task = Promise.resolve().then(() => this.execute(id, runtime));
      // A storage failure still rejects wait(), but cannot become an unhandled process-wide rejection.
      void runtime.task.catch(() => undefined);
      return this.get(id);
    }); } catch (error) { measurement?.end(this.measurementOutcome(error)); throw error; }
    finally { measurement?.end('success'); }
  }

  async rename(id: string, displayName: string, expectedVersion: number): Promise<Discussion> {
    return this.exclusive(async () => {
      assertEditable(this.get(id));
      const state = this.get(id);
      this.assertStorage(id);
      if (this.runtimes.has(id)) throw new AppError('BUSY', 'Pause before renaming the discussion.');
      if ((state.displayVersion ?? 0) !== expectedVersion) throw new AppError('VERSION_CONFLICT', 'Display name changed; refresh before renaming.');
      const name = redact(discussionInputSchema.shape.displayName.unwrap().parse(displayName));
      if ((state.displayName ?? '') === name) return state;
      await this.commit({ ...state, displayName: name, displayVersion: expectedVersion + 1 }, 'state', { displayNameChanged: true });
      return this.get(id);
    });
  }

  async configure(id: string, settings: { mode?: Discussion['mode'] | undefined; flow?: Discussion['flow'] | undefined; roles?: Discussion['roles'] | undefined; limits?: Discussion['limits'] | undefined;
    topic?: string | undefined; goal?: string | undefined; constraints?: string | undefined; focused?: boolean | undefined; expectedVersion?: number | undefined }): Promise<Discussion> {
    return this.exclusive(async () => {
      assertEditable(this.get(id));
      const state = this.get(id);
      if (state.behaviorVersion === 2 && settings.expectedVersion !== state.v2!.configurationVersion) throw new AppError('VERSION_CONFLICT', 'Settings changed; refresh before updating.');
      if (settings.roles && this.runtimes.has(id)) throw new AppError('BUSY', '請先暫停再修改立場。');
      if (settings.flow && this.runtimes.has(id)) throw new AppError('BUSY', '請先暫停再修改發言方式。');
      if (settings.limits && this.runtimes.has(id)) throw new AppError('BUSY', '請先暫停再延長上限。');
      if (settings.roles) settings.roles = { codex: redact(settings.roles.codex), claude: redact(settings.roles.claude) };
      const updated = { ...state, ...(settings.flow ? { flow: settings.flow } : {}), ...(settings.mode ? { mode: settings.mode } : {}), ...(settings.roles ? { roles: settings.roles } : {}), ...(settings.limits ? { limits: settings.limits } : {}), rolesConfirmed: settings.roles ? true : state.rolesConfirmed };
      if (state.behaviorVersion === 2) {
        if (settings.topic !== undefined) updated.topic = redact(settings.topic);
        if (settings.goal !== undefined) updated.goal = redact(settings.goal);
        if (settings.constraints !== undefined) updated.constraints = redact(settings.constraints);
        if (settings.focused !== undefined) updated.focused = settings.focused;
        if (isDeepStrictEqual(updated, state)) return state;
        const taskChanged = updated.topic !== state.topic || updated.goal !== state.goal || updated.constraints !== state.constraints;
        updated.v2 = { ...state.v2!, configurationVersion: state.v2!.configurationVersion + 1, taskVersion: state.v2!.taskVersion + 1, overall: null, completed: false,
          issues: state.v2!.issues.map(i => i.id === state.v2!.currentIssueId && taskChanged ?
            { ...i, version: i.version + 1, title: updated.topic !== state.topic ? updated.topic : i.title, proposal: null, confirmation: null, result: '', unresolved: [] } : i) };
      }
      await this.commit(updated, 'state', { configured: true });
      return this.get(id);
    });
  }

  async fork(id: string, newId: string): Promise<Discussion> {
    assertEditable(this.get(id));
    this.assertStorage(id);
    if (this.states.has(newId)) throw new AppError('IDEMPOTENCY_CONFLICT', 'The new discussion ID is already in use.');
    if (this.runtimes.has(id)) throw new AppError('BUSY', '請先停止或暫停原討論。');
    const previous = this.get(id);
    if (previous.behaviorVersion === 2) throw new AppError('INVALID_STATE', 'Use explicit session rebuilding for a version 2 discussion.');
    await this.create(newId, { ...(previous.displayName !== undefined ? { displayName: previous.displayName } : {}), topic: previous.topic, mode: 'manual', flow: previous.flow, backend: previous.backend, kind: previous.kind,
      agents: previous.agents, limits: previous.limits, roles: previous.roles, research: previous.research, roots: previous.roots,
      behaviorVersion: previous.behaviorVersion, goal: previous.goal, constraints: previous.constraints, focused: previous.focused });
    return this.exclusive(async () => {
      const created = this.get(newId);
      await this.commit({ ...created, messages: previous.messages.filter((message) => message.status === 'completed'), elapsedMs: previous.elapsedMs,
        round: previous.round + 1, nextSpeaker: previous.round % 2 === 1 ? 'claude' : 'codex',
        evidence: previous.evidence, rolesConfirmed: previous.rolesConfirmed }, 'state', { reconstructedFrom: id, newProviderSessions: true });
      return this.get(newId);
    });
  }

  async pause(id: string): Promise<Discussion> {
    return this.exclusive(async () => {
      assertEditable(this.get(id));
      const state = this.get(id);
      this.assertStorage(id);
      if (state.status === 'stopped' || state.status === 'indeterminate') return state;
      const runtime = this.runtimes.get(id);
      if (runtime) runtime.pause = true;
      await this.commit({ ...state, status: state.status === 'ready' ? 'paused' : state.status,
        pauseReason: 'User requested pause after the current answer.' }, 'state', { pauseRequested: true });
      return this.get(id);
    });
  }

  async stop(id: string): Promise<Discussion> {
    return this.exclusive(async () => {
      assertEditable(this.get(id));
      const state = this.get(id);
      // Persist intent before cancellation, so a crash cannot resurrect a stopped discussion.
      await this.commit({ ...state, status: 'stopped', pauseReason: 'Stopped by user.' }, 'state', { status: 'stopped' });
      this.runtimes.get(id)?.abort.abort(new AppError('CANCELLED', 'Stopped by user.'));
      return this.get(id);
    });
  }

  async send(id: string, messageId: string, text: string, recipient: AgentId | 'both', inReplyTo: string | null = null): Promise<Discussion> {
    return this.exclusive(async () => {
      assertEditable(this.get(id));
      const state = this.get(id);
      const sanitized = redact(text);
      const existing = state.messages.find((message) => message.id === messageId);
      if (existing) {
        if (existing.text !== sanitized || existing.recipient !== recipient || existing.sender !== 'user' || existing.inReplyTo !== inReplyTo) {
          throw new AppError('IDEMPOTENCY_CONFLICT', 'Message ID was already used with different content.');
        }
        return state;
      }
      if (state.status === 'stopped' || state.status === 'indeterminate') throw new AppError('INVALID_STATE', 'This discussion cannot accept new input.');
      if (inReplyTo && !state.messages.some(m => m.id === inReplyTo && m.status === 'completed' && (m.recipient === 'both' || recipient !== 'both' && m.recipient === recipient))) throw new AppError('INVALID_REFERENCE', 'Reply reference is unavailable to the selected recipient.');
      const message: Message = { id: messageId, sender: 'user', recipient, text: sanitized,
        round: state.round, inReplyTo, status: 'completed', createdAt: new Date().toISOString(),
        ...(state.v2 ? { issueId: state.v2.currentIssueId, issueVersion: state.v2.issues.find(i => i.id === state.v2!.currentIssueId)?.version ?? null,
          taskVersion: state.v2.taskVersion, responseTarget: inReplyTo } : {}) };
      await this.commit({ ...state, messages: [...state.messages, message], ...(state.v2 ? { v2: { ...state.v2, taskVersion: state.v2.taskVersion + 1,
        completed: false, overall: null, requests: [...state.v2.requests, { messageId, status: 'unmarked' as const, responseId: null, reason: '' }] } } : {}) }, 'message', { message });
      return this.get(id);
    });
  }

  private context(state: Discussion, speaker: AgentId): Message[] {
    const eligible = state.messages.filter((message) => message.status === 'completed' &&
      (message.sender !== 'user' || message.recipient === 'both' || message.recipient === speaker) &&
      message.purpose !== 'roles' &&
      !(state.activity === 'discussion' && state.round === 1 && message.sender !== 'user' && message.round === 1 && message.purpose !== 'summary'));
    if (eligible.reduce((total, message) => total + message.text.length, 0) > MAX_CONTEXT_CHARS) {
      throw new AppError('CONTEXT_LIMIT', 'Complete conversation exceeds the application input limit; no history was omitted.');
    }
    return eligible;
  }

  async rebuild(id: string, operationId: string, expectedVersion: number): Promise<Discussion> {
    return this.exclusive(async () => {
      assertEditable(this.get(id));
      this.assertStorage(id);
      const state = this.get(id);
      const fingerprint = JSON.stringify({ action: 'rebuild', expectedVersion });
      if (state.operationIds.includes(operationId)) {
        if (state.v2?.operationRecords.find(o => o.id === operationId)?.fingerprint !== fingerprint) throw new AppError('IDEMPOTENCY_CONFLICT', 'Operation ID was used with different content.');
        return state;
      }
      if (this.runtimes.has(id)) throw new AppError('BUSY', 'Wait for the current process to close before reconstruction.');
      if (!state.v2 || state.v2.taskVersion !== expectedVersion) throw new AppError('VERSION_CONFLICT', 'Task version changed; refresh before reconstruction.');
      const uncertainBudgetMs = state.v2.calls.filter(c => c.status === 'prepared' && state.v2!.receipts.some(r => r.generation === c.snapshot.generation && r.status !== 'retired')).reduce((sum, c) => sum + c.budgetReservationMs, 0);
      await this.commit({ ...state, status: 'paused', sessions: {}, activity: null, pauseReason: 'Sessions reconstructed from confirmed history on the next explicit start.',
        operationIds: [...state.operationIds, operationId], elapsedMs: state.elapsedMs + uncertainBudgetMs,
        v2: { ...state.v2, uncertainBudgetMs: state.v2.uncertainBudgetMs + uncertainBudgetMs, operationRecords: [...state.v2.operationRecords, { id: operationId, fingerprint }], receipts: state.v2.receipts.map(r => ({ ...r, status: 'retired' })),
          calls: state.v2.calls.map(c => c.status === 'prepared' ? { ...c, status: 'failed', diagnostics: { ...c.diagnostics, failureStage: 'interrupted' } } : c) } }, 'state', { sessionsRebuilt: true });
      return this.get(id);
    });
  }
  async upgrade(id: string, newId: string): Promise<Discussion> {
    assertEditable(this.get(id));
    this.assertStorage(id);
    const previous = this.get(id);
    if (previous.behaviorVersion !== 1) throw new AppError('INVALID_STATE', 'Only legacy discussions need upgrading.');
    if (this.runtimes.has(id)) throw new AppError('BUSY', 'Pause or stop before upgrading.');
    if (this.states.has(newId)) {
      const existing = this.get(newId);
      if (existing.v2?.sourceDiscussionId === id) return existing;
      throw new AppError('IDEMPOTENCY_CONFLICT', 'The destination ID is already used.');
    }
    await this.create(newId, { ...(previous.displayName !== undefined ? { displayName: previous.displayName } : {}), topic: previous.topic, mode: 'manual', flow: previous.flow, backend: previous.backend, kind: previous.kind,
      agents: previous.agents, limits: previous.limits, roles: previous.roles, research: previous.research, roots: previous.roots,
      behaviorVersion: 2, goal: previous.goal, constraints: previous.constraints, focused: true });
    return this.exclusive(async () => {
      const created = this.get(newId), v = created.v2!;
      v.sourceDiscussionId = id;
      const messages = previous.messages.filter(m => m.status === 'completed').map(m => ({ ...m, issueId: v.currentIssueId,
        issueVersion: 1, taskVersion: 1, responseTarget: m.inReplyTo }));
      v.requests = messages.filter(m => m.sender === 'user').map(m => ({ messageId: m.id, status: 'unmarked', responseId: null, reason: '' }));
      await this.commit({ ...created, messages, v2: v, evidence: previous.evidence, elapsedMs: previous.elapsedMs,
        round: previous.round + 1, rolesConfirmed: previous.rolesConfirmed }, 'state', { upgradedFrom: id });
      return this.get(newId);
    });
  }
  async issueAction(id: string, operationId: string, expectedVersion: number, action: 'add' | 'select' | 'skip' | 'dispose', issueId?: string, title?: string): Promise<Discussion> {
    return this.exclusive(async () => {
      assertEditable(this.get(id));
      const state = this.get(id);
      const fingerprint = JSON.stringify({ action, expectedVersion, issueId, title: title === undefined ? undefined : redact(title) });
      if (state.operationIds.includes(operationId)) {
        if (state.v2?.operationRecords.find(o => o.id === operationId)?.fingerprint !== fingerprint) throw new AppError('IDEMPOTENCY_CONFLICT', 'Operation ID was used with different content.');
        return state;
      }
      const v = state.v2;
      if (!v || v.taskVersion !== expectedVersion) throw new AppError('VERSION_CONFLICT', 'Task version changed; refresh before changing issues.');
      let updated = structuredClone(v);
      if (action === 'add') {
        if (!title?.trim()) throw new AppError('INVALID_INPUT', 'Issue title is required.');
        updated.issues.push({ id: issueId ?? randomUUID(), version: 1, title: redact(title.trim()), status: 'pending', source: 'user', proposal: null, confirmation: null, result: '', unresolved: [] });
      } else if (action === 'dispose') {
        const request = updated.requests.find(r => r.messageId === issueId);
        if (!request) throw new AppError('INVALID_REFERENCE', 'Unknown user request.');
        request.status = 'disposed'; request.reason = redact(title ?? 'Disposed by user.');
      } else {
        const issue = updated.issues.find(i => i.id === issueId);
        if (!issue) throw new AppError('INVALID_REFERENCE', 'Unknown issue.');
        updated.queuedIssue = { issueId: issue.id, action };
        if (!this.runtimes.has(id)) updated = applyBoundary(updated);
      }
      if (updated.issues.some((i, index) => updated.issues.findIndex(other => other.id === i.id) !== index)) throw new AppError('IDEMPOTENCY_CONFLICT', 'Issue ID is already used.');
      updated.taskVersion++;
      updated.overall = null; updated.completed = false;
      updated.operationRecords.push({ id: operationId, fingerprint });
      await this.commit({ ...state, v2: updated, operationIds: [...state.operationIds, operationId] }, 'state', { issueAction: action });
      return this.get(id);
    });
  }

  private async execute(id: string, runtime: Runtime): Promise<void> {
    if (this.get(id).behaviorVersion === 2) return executeFocused({
      get: this.get.bind(this), assertStorage: this.assertStorage.bind(this), exclusive: this.exclusive.bind(this),
      commit: this.commit.bind(this), turnMeasurement: this.turnMeasurement.bind(this), measurementOutcome: this.measurementOutcome.bind(this),
      adaptersFor: this.adaptersFor.bind(this), progress: this.progress.bind(this), storageBlocked: this.storageBlocked, runtimes: this.runtimes,
    }, id, runtime);
    let specialAnswers = 0;
    try {
      while (true) {
        const state = this.get(id);
        if (state.status !== 'running') return;
        const speaker = runtime.purpose === 'discussion' ? state.nextSpeaker : specialAnswers === 0 ? 'codex' : 'claude';
        const messageId = randomUUID();
        const measurement = this.turnMeasurement(state, runtime, speaker, { messageId, topic: state.topic, round: state.round,
          settings: state.agents[speaker], session: runtime.purpose === 'discussion' ? state.sessions[speaker] : undefined, context: [],
          signal: runtime.abort.signal, research: state.research && runtime.purpose === 'discussion' });
        measurement?.mark('selectionStart');
        let context: Message[];
        try { context = this.context(state, speaker); }
        catch (error) {
          if (!(error instanceof AppError) || error.code !== 'CONTEXT_LIMIT') { measurement?.end(this.measurementOutcome(error, runtime)); throw error; }
          let outcome = this.measurementOutcome(error, runtime);
          try { await this.exclusive(async () => {
            const current = this.get(id);
            if (current.status === 'running') await this.commit({ ...current, status: pausedStatus(runtime), pauseReason: error.message }, 'state', { status: pausedStatus(runtime), code: error.code });
          }); } catch (commitError) { outcome = this.measurementOutcome(commitError, runtime); throw commitError; }
          finally { measurement?.end(outcome); }
          return;
        }
        measurement?.mark('selectionEnd');
        let partial = '';
        let lastProgressAt = 0;
        let final: { text: string; model: string; continuation?: Message['continuation']; conclusionRef?: string } | undefined;
        const remainingMs = runtime.purpose === 'discussion' ? state.limits.maxDurationMs - state.elapsedMs - (Date.now() - runtime.startedAt) : state.limits.turnTimeoutMs * 2 - (Date.now() - runtime.startedAt);
        if (remainingMs <= 0) {
          let outcome: NonNullable<PerformanceRecord['outcome']> = 'timeout';
          try { await this.exclusive(async () => {
            const current = this.get(id);
            if (current.status === 'running') await this.commit({ ...current, status: pausedStatus(runtime), pauseReason: 'Duration limit reached.' }, 'state', { status: pausedStatus(runtime) });
          }); } catch (commitError) { outcome = this.measurementOutcome(commitError, runtime); throw commitError; }
          finally { measurement?.end(outcome); }
          return;
        }
        const signal = AbortSignal.any([runtime.abort.signal, AbortSignal.timeout(Math.min(state.limits.turnTimeoutMs, remainingMs))]);
        const request: TurnRequest = { messageId, topic: state.topic, round: state.round,
          settings: state.agents[speaker], session: runtime.purpose === 'discussion' ? state.sessions[speaker] : undefined, context, signal,
          autonomous: runtime.purpose === 'discussion' && (state.flow === 'free' || state.mode === 'conclusion'), untilConclusion: runtime.purpose === 'discussion' && state.mode === 'conclusion', purpose: runtime.purpose, role: state.roles[speaker], research: state.research && runtime.purpose === 'discussion', roots: state.roots, evidence: state.evidence };
        const toolIds = new Set<string>();
        if (measurement) { measurement.record.characters = buildPrompt(request).length; request.observePerformance = measurement.mark; }
        try {
          for await (const event of this.adaptersFor(state)[speaker].run(request)) {
            signal.throwIfAborted();
            if (event.type === 'session') {
              if (event.session.backend !== state.backend) throw new AppError('BACKEND_MISMATCH', 'Agent session backend differs from discussion.');
              await this.exclusive(async () => {
                const current = this.get(id);
                if (current.status === 'running') await this.commit({ ...current, sessions: runtime.purpose === 'discussion' ? { ...current.sessions, [speaker]: event.session } : current.sessions }, 'session', { speaker, session: event.session });
              });
            } else if (event.type === 'delta') {
              partial += event.text;
              if (publicPreview(partial).trim()) measurement?.text('stream');
              if (partial.length > MAX_RESPONSE_CHARS) throw new AppError('OUTPUT_LIMIT', 'Agent response exceeded its limit.');
          const preview = redact(publicPreview(partial.slice(0, partial.lastIndexOf('\n') + 1)));
              if (Date.now() - lastProgressAt > 300) { this.progress(id, { speaker, characters: partial.length, preview }); lastProgressAt = Date.now(); }
            } else if (event.type === 'tool') {
              if (measurement && (!event.toolId || !toolIds.has(event.toolId))) { measurement.record.tools++; if (event.toolId) toolIds.add(event.toolId); }
              this.progress(id, { speaker, tool: event.name });
            } else if (event.type === 'evidence') {
              await this.exclusive(async () => {
                const current = this.get(id);
                if (!current.evidence.some((item) => item.source === event.evidence.source && item.sha256 === event.evidence.sha256)) {
                  await this.commit({ ...current, evidence: [...current.evidence, event.evidence].slice(-200) }, 'evidence', { evidence: event.evidence });
                }
              });
            } else if (event.type === 'completed') {
              if (final) throw new AppError('INVALID_PROTOCOL', 'Agent emitted more than one completed result.');
              if (event.text.length > MAX_RESPONSE_CHARS) throw new AppError('OUTPUT_LIMIT', 'Agent response exceeded its limit.');
              final = { text: event.text, model: event.model };
              if (measurement) measurement.record.model = event.model;
              measurement?.usage(event.usage, event.performanceUsage);
              if (publicPreview(event.text).trim()) measurement?.text('final-only');
            }
          }
          signal.throwIfAborted();
          if (final && request.autonomous) {
            const onlyDone = /^\s*\[\[CANDC:done\]\]\s*$/i.test(final.text);
            final = { ...final, ...parseContribution(final.text) };
            // A completed waiting signal is valid without a substantive answer.
            if (onlyDone) final.text = '（沒有新的補充）';
          }
          if (!final || !final.text.trim()) throw new AppError('EMPTY_RESULT', 'Agent ended without a complete public result.');
          await this.exclusive(async () => {
            const current = this.get(id);
            if (current.status !== 'running') return;
            const message: Message = { id: messageId, sender: speaker, recipient: 'both', text: redact(final!.text),
              round: state.round, inReplyTo: context.at(-1)?.id ?? null, status: 'completed', createdAt: new Date().toISOString(), purpose: runtime.purpose,
              ...(runtime.purpose === 'discussion' ? { inputMessageId: context.findLast(item => item.sender === 'user')?.id } : {}),
              ...(request.autonomous ? { continuation: final!.continuation, ...(final!.conclusionRef ? { conclusionRef: final!.conclusionRef } : {}) } : {}) };
            measurement?.mark('answerCommitStart');
            await this.commit({ ...current, messages: [...current.messages, message],
              completedInRound: runtime.purpose === 'discussion' ? [...current.completedInRound, speaker] : current.completedInRound,
              nextSpeaker: runtime.purpose === 'discussion' ? state.flow === 'free' ? chooseNext({ ...current, messages: [...current.messages, message] }, speaker).speaker : other(speaker) : current.nextSpeaker }, 'message', { message });
            measurement?.mark('answerCommitEnd');
            if (measurement) measurement.record.answerSaved = true;
            if (runtime.purpose === 'roles') {
              const cleaned = final!.text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
              try {
                const roles = z.object({ codex: z.string().min(1).max(4_000), claude: z.string().min(1).max(4_000) }).parse(JSON.parse(cleaned));
                await this.commit({ ...this.get(id), roles: { codex: redact(roles.codex), claude: redact(roles.claude) }, rolesConfirmed: false }, 'state', { rolesProposed: true });
              } catch (error) {
                if (error instanceof StorageCommitError) throw error;
                // Keep invalid proposals visible for editing or another request.
              }
            }
          });
          measurement?.end(measurement.record.answerSaved === true ? 'success' : runtime.abort.signal.aborted ? 'cancelled' : 'failed');
          specialAnswers++;
        } catch (error) {
          const outcome = this.measurementOutcome(error, runtime, signal, measurement);
          try {
            if (error instanceof StorageCommitError) throw error;
            await this.exclusive(async () => {
              const current = this.get(id);
              const cancelled = runtime.abort.signal.aborted;
              const message: Message = { id: messageId, sender: speaker, recipient: 'both', text: redact(publicPreview(partial)),
                round: state.round, inReplyTo: context.at(-1)?.id ?? null,
                status: cancelled ? 'cancelled' : 'indeterminate', createdAt: new Date().toISOString(), purpose: runtime.purpose };
              await this.commit({ ...current, status: cancelled ? 'stopped' : runtime.purpose === 'discussion' ? 'indeterminate' : runtime.originalStatus,
                messages: [...current.messages, message], pauseReason: cancelled ? 'Stopped by user.' : safeError(error) }, 'error', {
                code: error instanceof AppError ? error.code : signal.aborted ? 'TIMEOUT' : 'AGENT_FAILURE',
                message: cancelled ? 'Stopped by user.' : safeError(error),
              });
            });
            return;
          } catch (commitError) { measurement?.end(this.measurementOutcome(commitError, runtime, signal, measurement)); throw commitError; }
          finally { measurement?.end(outcome); }
        }
        let keepRunning = false;
        await this.exclusive(async () => {
          const current = this.get(id);
          if (current.status !== 'running') return;
          const roundFinished = current.completedInRound.length === 2;
          const settled = runtime.purpose === 'discussion' && (current.flow === 'free' || current.mode === 'conclusion') && chooseNext(current, current.messages.at(-1)!.sender as AgentId).settled;
          const concluded = runtime.purpose === 'discussion' && current.mode === 'conclusion' && hasConfirmedConclusion(current);
          const limitReached = roundFinished && current.round >= current.limits.maxRounds;
          const specialFinished = runtime.purpose === 'roles' || (runtime.purpose === 'summary' && specialAnswers === 2);
          if (specialFinished || concluded || settled || runtime.pause || (runtime.purpose === 'discussion' && (limitReached || (roundFinished && current.mode === 'manual')))) {
            const status = pausedStatus(runtime);
            await this.commit({ ...current, status, pauseReason: specialFinished ? runtime.purpose === 'roles' ? '請確認雙方立場。' : '雙方已完成結論整理，請查看核對與分歧。' : concluded ? 'Conclusion confirmed by both agents.' : settled ? current.mode === 'conclusion' ? 'No confirmed conclusion; additional input is required.' : 'Both agents are waiting for new input.' : limitReached ? 'Round limit reached.' : runtime.pause ? 'Paused by user.' : 'Round completed.' }, 'state', { status });
          } else {
            if (runtime.purpose === 'discussion' && roundFinished) await this.commit({ ...current, round: current.round + 1, completedInRound: [],
              nextSpeaker: current.flow === 'free' ? current.nextSpeaker : current.round % 2 === 1 ? 'claude' : 'codex' }, 'state', { round: current.round + 1 });
            keepRunning = true;
          }
        });
        if (!keepRunning) return;
      }
    } catch (error) {
      if (this.storageBlocked.has(id)) return;
      await this.exclusive(async () => {
        const current = this.get(id);
        if (current.status === 'running') await this.commit({ ...current, status: 'indeterminate', pauseReason: safeError(error) }, 'error', { message: safeError(error) });
      });
    } finally {
      try {
        await this.exclusive(async () => {
          const current = this.get(id);
          if (this.storageBlocked.has(id)) return;
          await this.commit({ ...current, elapsedMs: current.elapsedMs + Date.now() - runtime.startedAt, activity: null }, 'state', { status: current.status });
        });
      } finally { this.runtimes.delete(id); }
    }
  }

  private progress(id: string, data: Record<string, unknown>) {
    const event: RunEvent = { sequence: 0, discussionId: id, type: 'progress', at: new Date().toISOString(), data };
    for (const listener of this.listeners.get(id) ?? []) { try { listener(event); } catch { /* Ignore disconnected clients. */ } }
  }

  subscribe(id: string, listener: Listener): () => void {
    this.get(id);
    const listeners = this.listeners.get(id) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(id, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(id);
    };
  }
  async events(id: string, after = 0): Promise<RunEvent[]> {
    this.get(id);
    return (await this.store.records(id)).map((record) => record.event).filter((event) => event.sequence > after);
  }
  async wait(id: string): Promise<void> { await this.runtimes.get(id)?.task; }
  async close(): Promise<void> {
    for (const [id, runtime] of this.runtimes) {
      if (this.storageBlocked.has(id)) runtime.abort.abort(); else await this.stop(id);
    }
    try { await Promise.all([...this.runtimes.values()].map((runtime) => runtime.task)); } finally { await this.performance.close(); }
  }
}
