import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, type AgentId, type AgentSession, type Discussion, type Message, type RunEvent } from './domain.js';
import { buildPrompt, type AgentAdapter, type TurnRequest } from './adapters/types.js';
import { redact, safeError } from './redaction.js';
import { chooseNext } from './conversation.js';
import { selectInput, parseFocused, focusedPreview, applyControl, applyBoundary } from './focused.js';
import type { CallRecord } from './v2-contract.js';
import type { Measurement, PerformanceRecord } from './performance.js';
import { pausedStatus, StorageCommitError, type Runtime } from './execution-runtime.js';

const MAX_RESPONSE_CHARS = 500_000;
const other = (id: AgentId): AgentId => id === 'codex' ? 'claude' : 'codex';
type FocusedExecutionHost = {
  get(id: string): Discussion;
  assertStorage(id: string): void;
  exclusive<T>(action: () => Promise<T>): Promise<T>;
  commit(state: Discussion, type: RunEvent['type'], data: Record<string, unknown>): Promise<void>;
  turnMeasurement(state: Discussion, runtime: Runtime, speaker: AgentId, request: TurnRequest): Measurement | undefined;
  measurementOutcome(error: unknown, runtime?: Runtime, signal?: AbortSignal, measurement?: Measurement): NonNullable<PerformanceRecord['outcome']>;
  adaptersFor(state: Discussion): Record<AgentId, AgentAdapter>;
  progress(id: string, data: Record<string, unknown>): void;
  storageBlocked: ReadonlySet<string>;
  runtimes: Map<string, Runtime>;
};

// Selection, delivery, control and execution remain version-specific; the controller owns durable admission and commits.
export async function executeFocused(host: FocusedExecutionHost, id: string, runtime: Runtime): Promise<void> {
  let auxiliaryAnswers = 0;
  try {
    while (true) {
      let state = host.get(id);
      if (state.status !== 'running') return;
      host.assertStorage(id);
      const speaker = runtime.purpose === 'discussion' ? state.nextSpeaker : auxiliaryAnswers ? 'claude' : 'codex';
      const remaining = state.limits.maxDurationMs - state.elapsedMs - (Date.now() - runtime.startedAt);
      if (remaining <= 0) {
        await host.exclusive(async () => {
          const current = host.get(id);
          if (current.status !== 'running') return;
          await host.commit({ ...current, status: pausedStatus(runtime), pauseReason: 'Duration limit reached.' }, 'state', {});
        }); return;
      }
      const signal = AbortSignal.any([runtime.abort.signal, AbortSignal.timeout(Math.min(remaining, state.limits.turnTimeoutMs))]);
      const base: TurnRequest = { messageId: randomUUID(), requestId: randomUUID(), topic: state.topic, round: state.round, settings: state.agents[speaker],
        session: undefined, context: [], signal, purpose: runtime.purpose, role: state.roles[speaker], autonomous: false,
        research: state.research && runtime.purpose === 'discussion', roots: state.roots };
      const measurement = host.turnMeasurement(state, runtime, speaker, base);
      measurement?.mark('selectionStart');
      let selection: ReturnType<typeof selectInput> | null;
      try {
        selection = await host.exclusive(async () => {
          state = host.get(id);
          if (state.status !== 'running') return null;
          const selection = selectInput(state, speaker, base);
          if (measurement) { measurement.record.session = selection.request.session ? 'resumed' : 'new'; measurement.record.characters = selection.call.diagnostics.input.characters; }
          measurement?.mark('selectionEnd');
          measurement?.mark('preparedStart');
          const v = state.v2!;
          await host.commit({ ...state, v2: { ...v, calls: [...v.calls, selection.call],
            receipts: v.receipts.some(r => r.generation === selection.receipt.generation) ? v.receipts : [...v.receipts, selection.receipt] } }, 'state', { preparedRequestId: selection.call.requestId });
          measurement?.mark('preparedEnd');
          return selection;
        });
      } catch (error) {
        let outcome = host.measurementOutcome(error, runtime, signal, measurement);
        try {
          if (host.storageBlocked.has(id)) return;
          await host.exclusive(async () => {
            const current = host.get(id);
            if (current.status !== 'running') return;
            await host.commit({ ...current, status: pausedStatus(runtime), pauseReason: safeError(error) }, 'state', {});
          }); return;
        } catch (commitError) { outcome = host.measurementOutcome(commitError, runtime, signal, measurement); throw commitError; }
        finally { measurement?.end(outcome); }
      }
      if (!selection) { measurement?.end('cancelled'); return; }
      const request = selection.request, call = structuredClone(selection.call);
      if (measurement) request.observePerformance = measurement.mark;
      const toolIds = new Set<string>();
      const started = Date.now();
      let provisional: AgentSession | undefined, partial = '', final: { text: string; model: string } | undefined, lastProgress = 0;
      let evidence: Discussion['evidence'] = [];
      const observe = (phase: keyof CallRecord['diagnostics']['timings']) => { call.diagnostics.timings[phase] ??= Date.now() - started; };
      try {
        for await (const event of host.adaptersFor(state)[speaker].run(request)) {
          signal.throwIfAborted();
          if (event.type === 'stage') observe(event.phase);
          else if (event.type === 'session') {
            if (provisional || event.session.backend !== state.backend || request.session && event.session.id !== request.session.id) throw new AppError('SESSION_MISMATCH', 'Native session does not match the fixed request.');
            provisional = event.session; if (measurement) measurement.record.model = event.session.model; observe('sessionReady'); call.provisionalSessionId = event.session.id; call.resolvedModel = event.session.model;
            await host.exclusive(async () => {
              const current = host.get(id), v = current.v2!;
              await host.commit({ ...current, v2: { ...v, calls: v.calls.map(c => c.requestId === call.requestId ? { ...c, provisionalSessionId: event.session.id, resolvedModel: event.session.model } : c) } }, 'session', { requestId: call.requestId, provisional: true, speaker });
            });
          } else if (event.type === 'delta') {
            partial += event.text;
            if (partial.length > MAX_RESPONSE_CHARS) throw new AppError('OUTPUT_LIMIT', 'Public answer exceeds the transport limit.');
            const preview = redact(focusedPreview(partial.slice(0, partial.lastIndexOf('\n') + 1)));
            if (focusedPreview(partial).trim()) { observe('firstPublicText'); measurement?.text('stream'); }
            if (Date.now() - lastProgress > 300) { host.progress(id, { speaker, characters: preview.length, preview, saved: false }); lastProgress = Date.now(); }
          } else if (event.type === 'tool') { if (measurement && (!event.toolId || !toolIds.has(event.toolId))) { measurement.record.tools++; if (event.toolId) toolIds.add(event.toolId); } host.progress(id, { speaker, tool: event.name }); }
          else if (event.type === 'evidence') evidence.push({ ...event.evidence, source: redact(event.evidence.source), text: redact(event.evidence.text), owner: speaker, generation: call.snapshot.generation });
          else if (event.type === 'completed') {
            if (final) throw new AppError('INVALID_PROTOCOL', 'Multiple completed results.');
            if (event.text.length > MAX_RESPONSE_CHARS) throw new AppError('OUTPUT_LIMIT', 'Public answer exceeds the transport limit.');
            final = event; call.diagnostics.usage = event.usage ?? null; measurement?.usage(event.usage, event.performanceUsage);
            observe('generationComplete');
            if (focusedPreview(event.text).trim()) { observe('firstPublicText'); measurement?.text('final-only'); }
          }
        }
        signal.throwIfAborted();
        if (!provisional || !final) throw new AppError('INVALID_PROTOCOL', 'Successful session and result are required.');
        if (final.model !== provisional.model) throw new AppError('MODEL_MISMATCH', 'Final model differs from the initialized session.');
        const parsed = runtime.purpose === 'discussion' ? parseFocused(final.text) : { text: final.text, control: null, annotation: null, annotationStatus: 'unmarked' as const };
        if (!parsed.text.trim()) {
          if (parsed.control?.continuation === 'done') parsed.text = '（沒有新的補充）';
          else throw new AppError('EMPTY_RESULT', 'No complete public answer.');
        }
        await host.exclusive(async () => {
          signal.throwIfAborted();
          const current = host.get(id), v = current.v2!;
          const privateInput = [...selection.receipt.messages, ...call.snapshot.messages].some(ref => current.messages.some(m => m.id === ref.id && m.recipient !== 'both'));
          const message: Message = { id: request.messageId, sender: speaker, recipient: privateInput ? speaker : 'both', text: redact(parsed.text), round: state.round,
            inReplyTo: call.snapshot.responseTarget, responseTarget: call.snapshot.responseTarget, issueId: call.snapshot.taskCard.issueId,
            issueVersion: call.snapshot.taskCard.issueVersion, taskVersion: call.snapshot.taskCard.version,
            status: 'completed', purpose: runtime.purpose, createdAt: new Date().toISOString(), annotation: parsed.annotationStatus };
          const applied = runtime.purpose === 'discussion' ? applyControl(current, call, message, parsed) : { v2: v, pauseReason: null, controlStatus: 'not-applicable' as const };
          call.status = 'completed'; call.control = applied.controlStatus; call.annotation = message.annotation ?? parsed.annotationStatus;
          const receipt = { ...selection.receipt, sessionId: provisional!.id, status: 'valid' as const,
            configurationVersion: call.snapshot.configurationVersion,
            messages: [...selection.receipt.messages, ...call.snapshot.messages, { id: message.id, version: 1 as const }].filter((ref, index, refs) => refs.findIndex(r => r.id === ref.id) === index),
            evidence: [...selection.receipt.evidence, ...call.snapshot.evidence.map(({ id, version }) => ({ id, version }))].filter((ref, index, refs) => refs.findIndex(r => r.id === ref.id && r.version === ref.version) === index) };
          let nextV = { ...applied.v2, calls: applied.v2.calls.map(c => c.requestId === call.requestId ? call : c),
            receipts: applied.v2.receipts.map(r => r.generation === receipt.generation ? receipt : r) };
          const ordinary = runtime.purpose === 'discussion';
          const messages = [...current.messages, message];
          const sessions = ordinary ? { ...current.sessions, [speaker]: provisional! } : current.sessions;
          const nextSpeaker = ordinary ? current.flow === 'free' ? chooseNext({ ...current, messages, v2: nextV, sessions }, speaker).speaker : other(speaker) : current.nextSpeaker;
          let pauseReason = applied.pauseReason;
          // Auto progression happens only after a valid peer confirmation; manual keeps its pair boundary.
          if (ordinary && current.focused && current.mode !== 'manual' && !nextV.currentIssueId && applied.controlStatus === 'valid' && !nextV.completed) {
            const next = nextV.issues.find(i => i.status === 'pending');
            if (next) nextV = applyBoundary({ ...nextV, queuedIssue: { issueId: next.id, action: 'select' } });
          }
          const elapsedMs = current.elapsedMs + Date.now() - runtime.startedAt;
          measurement?.mark('answerCommitStart');
          await host.commit({ ...current, messages, v2: nextV, evidence: [...current.evidence, ...evidence.filter(e => !current.evidence.some(old => old.source === e.source && old.sha256 === e.sha256 && old.owner === e.owner))],
            sessions,
            completedInRound: ordinary ? [...current.completedInRound, speaker] : current.completedInRound,
            nextSpeaker, elapsedMs, status: pauseReason ? pausedStatus(runtime) : current.status,
            pauseReason: pauseReason ?? current.pauseReason }, 'message', { message, requestId: call.requestId, control: call.control, annotation: call.annotation });
          measurement?.mark('answerCommitEnd');
          if (measurement) measurement.record.answerSaved = true;
          const commitDuration = Date.now() - started;
          // Final commit timing is a separate, confirmed diagnostic update. If it fails the storage barrier still applies.
          const confirmed = host.get(id);
          measurement?.mark('diagnosticCommitStart');
          await host.commit({ ...confirmed, v2: { ...confirmed.v2!, calls: confirmed.v2!.calls.map(c => c.requestId === call.requestId ?
            { ...c, diagnostics: { ...c.diagnostics, timings: { ...c.diagnostics.timings, finalCommit: commitDuration } } } : c) } }, 'state', { committedRequestId: call.requestId });
          measurement?.mark('diagnosticCommitEnd');
          if (measurement) measurement.record.diagnosticsSaved = true;
          if (runtime.purpose === 'roles') {
            try {
              const roles = z.object({ codex: z.string().min(1).max(4_000), claude: z.string().min(1).max(4_000) }).parse(JSON.parse(final!.text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')));
              await host.commit({ ...host.get(id), roles: { codex: redact(roles.codex), claude: redact(roles.claude) }, rolesConfirmed: false }, 'state', { rolesProposed: true });
            } catch (error) { if (error instanceof StorageCommitError) throw error; }
          }
          runtime.startedAt = Date.now();
        });
        measurement?.end('success');
        auxiliaryAnswers++;
      } catch (error) {
        measurement?.mark('failureObserved');
        const outcome = host.measurementOutcome(error, runtime, signal, measurement);
        try {
          if (host.storageBlocked.has(id)) return;
          call.status = 'failed'; call.diagnostics.failureStage = runtime.abort.signal.aborted ? 'CANCELLED' : error instanceof AppError ? error.code : signal.aborted ? 'TIMEOUT' : final ? 'cleanup' : provisional ? 'turn-protocol' : 'session-preparation';
          await host.exclusive(async () => {
            const current = host.get(id), v = current.v2!;
            const message: Message = { id: request.messageId, sender: speaker, recipient: 'both', text: redact(focusedPreview(partial)),
              round: state.round, inReplyTo: call.snapshot.responseTarget, responseTarget: call.snapshot.responseTarget,
              issueId: call.snapshot.taskCard.issueId, issueVersion: call.snapshot.taskCard.issueVersion, taskVersion: call.snapshot.taskCard.version,
              status: runtime.abort.signal.aborted ? 'cancelled' : 'indeterminate', purpose: runtime.purpose, createdAt: new Date().toISOString() };
            await host.commit({ ...current, status: runtime.abort.signal.aborted ? 'stopped' : runtime.purpose === 'discussion' ? 'indeterminate' : runtime.originalStatus,
              messages: [...current.messages, message], pauseReason: safeError(error),
              v2: { ...v, calls: v.calls.map(c => c.requestId === call.requestId ? call : c),
                receipts: v.receipts.map(r => r.generation === call.snapshot.generation ? { ...r, status: 'uncertain' } : r) } }, 'error', { requestId: call.requestId, code: call.diagnostics.failureStage });
          });
          return;
        } catch (commitError) { measurement?.end(host.measurementOutcome(commitError, runtime, signal, measurement)); throw commitError; }
        finally { measurement?.end(outcome); }
      }
      const current = host.get(id);
      if (current.status !== 'running') return;
      const pair = current.completedInRound.length === 2;
      const settled = runtime.purpose === 'discussion' && current.flow === 'free' && chooseNext(current, speaker).settled;
      const special = runtime.purpose === 'roles' || runtime.purpose === 'summary' && auxiliaryAnswers === 2;
      if (runtime.pause || special || settled || runtime.purpose === 'discussion' && pair && (current.mode === 'manual' || current.round >= current.limits.maxRounds)) {
        await host.exclusive(async () => {
          const latest = host.get(id);
          if (latest.status !== 'running') return;
          await host.commit({ ...latest, status: pausedStatus(runtime), pauseReason: special ? runtime.purpose === 'summary' ? '雙方已完成結論整理，請查看核對與分歧。' : '請確認雙方立場。' : runtime.pause ? 'Paused by user.' : settled ? 'Both agents are waiting for new input.' : latest.round >= latest.limits.maxRounds ? 'Round limit reached.' : 'Round completed.' }, 'state', {});
        }); return;
      }
      if (pair && runtime.purpose === 'discussion') await host.exclusive(async () => {
        const latest = host.get(id);
        if (latest.status !== 'running') return;
        await host.commit({ ...latest, round: latest.round + 1,
          completedInRound: [], nextSpeaker: latest.flow === 'free' ? latest.nextSpeaker : latest.round % 2 === 1 ? 'claude' : 'codex' }, 'state', {});
      });
    }
  } finally {
    try {
      if (!host.storageBlocked.has(id)) await host.exclusive(() => {
        const current = host.get(id);
        return host.commit({ ...current, elapsedMs: current.elapsedMs + Date.now() - runtime.startedAt, activity: null }, 'state', {});
      });
    } finally { host.runtimes.delete(id); }
  }
}
