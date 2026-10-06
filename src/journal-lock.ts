import path from 'node:path';

// Stores for different behavior versions share files within this process.
const writers = new Map<string, Promise<unknown>>();
export async function withJournalLock<T>(file: string, action: () => Promise<T>): Promise<T> {
  const resolved = path.resolve(file);
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const previous = writers.get(key) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(action);
  writers.set(key, result);
  try { return await result; }
  finally { if (writers.get(key) === result) writers.delete(key); }
}
