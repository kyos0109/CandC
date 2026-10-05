import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DiscussionInput } from '../src/domain.js';
import type { AgentAdapter, TurnRequest } from '../src/adapters/types.js';
import { FakeAdapter } from '../src/adapters/fake.js';
import { DiscussionController } from '../src/controller.js';
import { DiscussionStore, type StorageFault } from '../src/store.js';

export const input = (overrides: Partial<DiscussionInput> = {}): DiscussionInput => ({
  behaviorVersion: 1, goal: '', constraints: '', focused: true,
  topic: 'Compare reliability and cost using only the supplied facts.', mode: 'manual', flow: 'alternating',
  backend: 'fake', kind: 'discussion', roles: { codex: '', claude: '' }, research: false, roots: [],
  agents: { codex: { model: 'fixture-codex', effort: 'medium' }, claude: { model: 'fixture-claude', effort: 'medium' } },
  limits: { maxRounds: 3, maxDurationMs: 30_000, turnTimeoutMs: 2_000 }, ...overrides,
});

export async function setup(adapters: Record<'codex' | 'claude', AgentAdapter> = {
  codex: new FakeAdapter('codex'), claude: new FakeAdapter('claude'),
}, fault?: StorageFault) {
  const directory = await mkdtemp(path.resolve('.cache/test-'));
  const store = new DiscussionStore(directory, fault);
  const controller = new DiscussionController(store, adapters);
  await controller.initialize();
  return { controller, store, directory, cleanup: async () => {
    await controller.close();
    // This exact directory was created by this test within the workspace cache.
    await rm(directory, { recursive: true, force: true });
  } };
}

export const request = (overrides: Partial<TurnRequest> = {}): TurnRequest => ({
  messageId: randomUUID(), topic: 'Harmless fixture question.', round: 1,
  settings: { model: 'fixture-model', effort: 'medium' }, session: undefined, context: [],
  signal: new AbortController().signal, ...overrides,
});

export async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Condition was not observed before timeout.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
