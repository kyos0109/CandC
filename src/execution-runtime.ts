import type { Discussion } from './domain.js';

export type Runtime = { executionId: string; versions: { codex: string | null; claude: string | null }; abort: AbortController; pause: boolean; startedAt: number; task: Promise<void>; purpose: 'discussion' | 'roles' | 'summary'; originalStatus: Discussion['status'] };
export class StorageCommitError extends Error {}
export const pausedStatus = (runtime: Runtime): Discussion['status'] => runtime.purpose !== 'discussion' &&
  ['stopped', 'indeterminate'].includes(runtime.originalStatus) ? runtime.originalStatus : 'paused';
