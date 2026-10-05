import { request, type FullConfig } from '@playwright/test';

// Close only the isolated fixture before Playwright's Windows process cleanup.
// The runner's taskkill fallback cannot reliably reap it under managed permissions.
export default async function teardown(config: FullConfig) {
  const client = await request.newContext({ baseURL: config.projects[0]!.use.baseURL, timeout: 5_000 });
  try {
    const health = await client.get('/health');
    const identity = await health.json();
    if (!health.ok() || identity.application !== 'candc' || identity.testFixture !== true) throw new Error('Refusing to shut down a non-fixture server.');
    await client.get('/api/session');
    const result = await client.post('/api/shutdown');
    if (!result.ok()) throw new Error('Fixture shutdown failed.');
  } finally { await client.dispose(); }
}
