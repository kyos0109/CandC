import { randomUUID } from 'node:crypto';
import { DiscussionController } from './controller.js';
import { RoomController, type InitialRoomHistory } from './room-controller.js';
import { AppError, type Discussion, type DiscussionInput, type AgentId, type RunEvent } from './domain.js';
import type { ParticipantId, RoomDiscussion, RoomInput } from './room-contract.js';

export type AnyDiscussion = Discussion | RoomDiscussion;
export class DiscussionService {
  private admission: Promise<unknown> = Promise.resolve();
  constructor(readonly legacy: DiscussionController, readonly rooms: RoomController) {}
  get performance() { return this.legacy.performance; }
  async initialize() { await this.legacy.initialize(); await this.rooms.initialize(); }
  get(id: string): AnyDiscussion { return this.rooms.has(id) ? this.rooms.get(id) : this.legacy.get(id); }
  list(): AnyDiscussion[] { return [...this.legacy.list(), ...this.rooms.list()]; }
  storageIssues() { return [...new Map([...this.legacy.storageIssues(), ...this.rooms.storageIssues()].map(i => [i.id, i])).values()]; }
  private controller(id: string) { return this.rooms.has(id) ? this.rooms : this.legacy; }
  create(id: string, input: DiscussionInput) {
    if (this.rooms.has(id)) throw new AppError('IDEMPOTENCY_CONFLICT', 'Discussion ID belongs to another behavior version.');
    return this.legacy.create(id, input);
  }
  createRoom(id: string, input: RoomInput, history?: InitialRoomHistory) {
    if (this.legacy.list().some(s => s.id === id)) throw new AppError('IDEMPOTENCY_CONFLICT', 'Discussion ID belongs to another behavior version.');
    return this.rooms.create(id, input, history);
  }
  async start(id: string, operationId: string, purpose: 'discussion' | 'roles' | 'summary' = 'discussion') {
    const result = this.admission.then(async () => {
      const otherBusy = this.rooms.has(id) ? this.legacy.busy : this.rooms.busy;
      if (otherBusy || this.list().some(s => s.id !== id && s.activity !== null)) throw new AppError('BUSY', 'Only one discussion can execute at a time, including cancellation cleanup.');
      return this.controller(id).start(id, operationId, purpose);
    }); this.admission = result.catch(() => undefined); return result;
  }
  pause(id: string) { return this.controller(id).pause(id); }
  stop(id: string) { return this.controller(id).stop(id); }
  rename(id: string, name: string, version: number) { return this.controller(id).rename(id, name, version); }
  configure(id: string, patch: Parameters<DiscussionController['configure']>[1] & { maxModeratorCalls?: number | undefined; confirmRoles?: boolean | undefined;
    research?: boolean | undefined; roots?: string[] | undefined; discussionPolicyVersion?: 1 | undefined; moderatorMode?: RoomInput['moderatorMode'] | undefined }) {
    if (!this.rooms.has(id)) {
      if (patch.discussionPolicyVersion || patch.research !== undefined || patch.roots !== undefined || patch.moderatorMode !== undefined) throw new AppError('INVALID_STATE', 'Research/policy configuration here requires a version 3 discussion.');
      return this.legacy.configure(id, patch);
    }
    const { roles: _, focused: __, maxModeratorCalls, ...settings } = patch;
    const s = this.rooms.get(id);
    return this.rooms.configure(id, { ...settings, ...(maxModeratorCalls === undefined ? {} : { limits: { ...s.limits, ...settings.limits, maxModeratorCalls } }) });
  }
  send(id: string, messageId: string, text: string, recipient: ParticipantId | 'both' | 'all', inReplyTo: string | null = null) {
    if (this.rooms.has(id)) return this.rooms.send(id, messageId, text, recipient === 'both' ? 'all' : recipient, inReplyTo);
    if (!['codex', 'claude', 'both'].includes(recipient)) throw new AppError('INVALID_REFERENCE', 'Recipient not supported by legacy discussion.');
    return this.legacy.send(id, messageId, text, recipient as AgentId | 'both', inReplyTo);
  }
  rebuild(id: string, operationId: string, version: number) { return this.controller(id).rebuild(id, operationId, version); }
  recover(id: string, repairTail = false) { return this.controller(id).recover(id, repairTail); }
  fork(id: string, newId: string) { if (this.rooms.has(id)) throw new AppError('INVALID_STATE', 'Rebuild sessions for a version 3 discussion.'); return this.legacy.fork(id, newId); }
  upgrade(id: string, newId: string) { return this.legacy.upgrade(id, newId); }
  async upgradeRoom(id: string, newId: string, moderator: RoomInput['moderator'] = null) {
    const previous = this.get(id); if (previous.behaviorVersion === 3) throw new AppError('INVALID_STATE', 'Already version 3.');
    if (previous.activity !== null || previous.storage) throw new AppError('BUSY', 'Pause and confirm saved storage before upgrading.');
    if (this.rooms.has(newId)) { const existing = this.rooms.get(newId); if (existing.room.sourceDiscussionId === id) return existing; throw new AppError('IDEMPOTENCY_CONFLICT', 'Destination ID already used.'); }
    const completedIds = new Set(previous.messages.filter(m => m.status === 'completed').map(m => m.id));
    return this.createRoom(newId, { behaviorVersion: 3, topic: previous.topic, goal: previous.goal, constraints: previous.constraints,
      ...(previous.displayName === undefined ? {} : { displayName: previous.displayName }), mode: 'manual', flow: previous.flow, backend: previous.backend,
      kind: previous.kind, research: previous.research, roots: previous.roots, moderator,
      participants: (['codex', 'claude'] as const).map(provider => ({ id: provider, provider, role: 'speaker', settings: previous.agents[provider], instructions: previous.roles[provider] })),
      limits: { ...previous.limits, maxModeratorCalls: 500 } }, { sourceDiscussionId: id, elapsedMs: previous.elapsedMs,
      messages: previous.messages.filter(m => m.status === 'completed').map(m => ({ id: m.id, sender: m.sender,
      recipient: m.recipient === 'both' ? 'all' : m.recipient, text: m.text, round: m.round, inReplyTo: m.inReplyTo && completedIds.has(m.inReplyTo) ? m.inReplyTo : null,
      status: m.status, createdAt: m.createdAt, purpose: m.purpose === 'summary' ? 'summary' : 'discussion', taskVersion: 1 })) });
  }
  resolveTopic(id: string, operationId: string, version: number, apply: boolean) { return this.rooms.resolveTopic(id, operationId, version, apply); }
  issueAction(...args: Parameters<DiscussionController['issueAction']>) { if (this.rooms.has(args[0])) throw new AppError('INVALID_STATE', 'Version 3 uses moderator topic control.'); return this.legacy.issueAction(...args); }
  subscribe(id: string, listener: (event: RunEvent) => void) { return this.controller(id).subscribe(id, listener); }
  events(id: string, after = 0) { return this.controller(id).events(id, after); }
  wait(id: string) { return this.controller(id).wait(id); }
  performanceView(id: string) { this.get(id); return this.performance.view(id); }
  performanceBaseline(format: 'json' | 'markdown') { return this.legacy.performanceBaseline(format); }
  async close() { await this.rooms.close(); await this.legacy.close(); }
}
