import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AgentId, Discussion, Message } from '../src/domain.js';
import { applyControl, CONTROL_START, CONTROL_END, parseFocused, selectInput } from '../src/focused.js';
import type { Control } from '../src/v2-contract.js';
import { input, request, setup } from './helpers.js';

function turn(state: Discussion, agent: AgentId, action: Control['action']) {
  const selection = selectInput(state, agent, request({ purpose: 'discussion' }));
  const card = selection.call.snapshot.taskCard;
  const message: Message = { id: selection.call.messageId, sender: agent, recipient: 'both', text: 'Public decision, conditions and reasoning.',
    round: state.round, inReplyTo: card.responseTarget, responseTarget: card.responseTarget, issueId: card.issueId,
    issueVersion: card.issueVersion, taskVersion: card.version, status: 'completed', purpose: 'discussion', createdAt: state.createdAt };
  const parsed = parseFocused(`${message.text}\n${CONTROL_START}\n${JSON.stringify({ version: 2, issueId: card.issueId, issueVersion: card.issueVersion, taskVersion: card.version, continuation: 'yield', action })}\n${CONTROL_END}`);
  const applied = applyControl(state, selection.call, message, parsed);
  const native = `native-${agent}-${selection.receipt.generation}`;
  const receipt = { ...selection.receipt, status: 'valid' as const, sessionId: native, messages: [...selection.receipt.messages, ...selection.call.snapshot.messages, { id: message.id, version: 1 as const }].filter((r, i, all) => all.findIndex(ref => ref.id === r.id) === i) };
  const next: Discussion = { ...state, messages: [...state.messages, message], sessions: { ...state.sessions, [agent]: { id: native, model: state.agents[agent].model, backend: 'fake' } },
    v2: { ...applied.v2, receipts: [...applied.v2.receipts.filter(r => r.generation !== receipt.generation), receipt], calls: [...applied.v2.calls, { ...selection.call, status: 'completed', control: applied.controlStatus }] } };
  return { state: next, applied, call: selection.call, parsed, message };
}
const proposal = (blocking = false): Control['action'] => ({ type: 'propose', outcome: 'blocked', result: 'Missing an observation; other work is possible.', conditions: 'Supplied facts only.', unresolved: ['Observation'], blocking });
describe('versioned issue and whole-discussion actions', () => {
  it('invalidates old proposal confirmations and applies no outdated configuration action', async () => {
    const ctx = await setup();
    try {
      let state = await ctx.controller.create(randomUUID(), input({ behaviorVersion: 2 })); state.round = 2;
      state = turn(state, 'codex', proposal()).state;
      const old = state.v2!.issues[0]!.proposal!;
      state = turn(state, 'codex', proposal()).state;
      expect(state.v2!.issues[0]!.proposal!.version).toBe(old.version + 1);
      const rejected = turn(state, 'claude', { type: 'confirm', proposalId: old.id, proposalVersion: old.version });
      expect(rejected.applied.controlStatus).toBe('invalid'); expect(rejected.state.v2!.issues[0]!.confirmation).toBeNull();
      const snapshot = turn(state, 'claude', { type: 'none' });
      const changed = structuredClone(state);
      changed.v2!.configurationVersion++; changed.v2!.taskVersion++;
      const stale = applyControl(changed, snapshot.call, snapshot.message, snapshot.parsed);
      expect(stale.controlStatus).toBe('stale'); expect(stale.pauseReason).toBeNull();
    } finally { await ctx.cleanup(); }
  });
  it('does not pause for optional missing information but preserves a distinct unresolved blocked issue', async () => {
    const ctx = await setup();
    try {
      let state = await ctx.controller.create(randomUUID(), input({ behaviorVersion: 2 })); state.round = 2;
      state = turn(state, 'codex', proposal(false)).state;
      const p = state.v2!.issues[0]!.proposal!;
      const confirmed = turn(state, 'claude', { type: 'confirm', proposalId: p.id, proposalVersion: p.version });
      expect(confirmed.applied.pauseReason).toBeNull(); expect(confirmed.state.v2!.issues[0]!.status).toBe('blocked');
      expect(confirmed.state.v2!.currentIssueId).toBe(p ? state.v2!.issues[0]!.id : null);
      expect(confirmed.state.v2!.completed).toBe(false);
    } finally { await ctx.cleanup(); }
  });
  it('requires explicit peer agreement on the whole result, completed issues and disposed user requirements', async () => {
    const ctx = await setup();
    try {
      let state = await ctx.controller.create(randomUUID(), input({ behaviorVersion: 2 })); state.round = 2;
      state = turn(state, 'codex', { type: 'propose', outcome: 'disagreed', result: 'Each position and reason are recorded; no deciding observation exists.', conditions: 'Missing deciding evidence.', unresolved: [], blocking: false }).state;
      const p = state.v2!.issues[0]!.proposal!;
      state = turn(state, 'claude', { type: 'confirm', proposalId: p.id, proposalVersion: p.version }).state;
      expect(state.v2!.currentIssueId).toBeNull();
      expect(turn(state, 'codex', { type: 'overall', result: 'Premature overall result' }).applied.controlStatus).toBe('invalid');
      state.v2!.requests[0]!.status = 'disposed'; state.v2!.requests[0]!.reason = 'User accepted the disposition.';
      state = turn(state, 'codex', { type: 'overall', result: 'Overall result with disagreement and limitations.' }).state;
      const overall = state.v2!.overall!;
      expect(state.v2!.completed).toBe(false);
      expect(turn(state, 'codex', { type: 'confirm-overall', messageId: overall.messageId, version: overall.version }).applied.controlStatus).toBe('invalid');
      const final = turn(state, 'claude', { type: 'confirm-overall', messageId: overall.messageId, version: overall.version });
      expect(final.applied.controlStatus).toBe('valid'); expect(final.state.v2!.completed).toBe(true);
      const pending = structuredClone(state);
      pending.v2!.issues.push({ id: randomUUID(), version: 1, title: 'Still pending', status: 'pending', source: 'user', proposal: null, confirmation: null, result: '', unresolved: [] });
      expect(turn(pending, 'claude', { type: 'confirm-overall', messageId: overall.messageId, version: overall.version }).applied.controlStatus).toBe('invalid');
      pending.v2!.issues.pop(); pending.v2!.requests[0]!.status = 'unmarked';
      expect(turn(pending, 'claude', { type: 'confirm-overall', messageId: overall.messageId, version: overall.version }).applied.controlStatus).toBe('invalid');
    } finally { await ctx.cleanup(); }
  });
});
