// Native release smoke test. Uses only temporary data, fake providers, and an isolated build.
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { install, manage, stopServer, runtimeStatus } from './install.mjs';
import { packageRelease } from './package-release.mjs';

await mkdir('.cache', { recursive: true });
const artifacts = await mkdtemp(path.resolve('.cache/release-smoke-'));
// The application must not resolve undeclared dependencies from the repository's node_modules.
const parent = await mkdtemp(path.join(tmpdir(), 'candc-release-smoke-'));
const root = path.join(parent, '安裝 with spaces');
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
// Never inspect the current user's provider credentials, even if future smoke steps change.
process.env.CANDC_CODEX_PATH = path.join(parent, 'missing-codex');
process.env.CANDC_CLAUDE_PATH = path.join(parent, 'missing-claude');
process.env.CANDC_GEMINI_PATH = path.join(parent, 'missing-gemini');
process.env.CANDC_GROK_PATH = path.join(parent, 'missing-grok');
process.env.CANDC_CODEX_HOME = path.join(parent, 'provider-home');
delete process.env.CANDC_DATA_DIR;
delete process.env.CANDC_PORT;
let complete = false;
try {
  const output = await packageRelease({ build: path.resolve(process.env.CANDC_VERIFY_DIR ?? '.cache/verification'), output: path.join(artifacts, 'package') });
  const version = JSON.parse(await readFile('package.json', 'utf8')).version;
  const options = { archive: path.join(output, `candc-v${version}.tar.gz`), 'install-dir': root, port, 'no-start': true };
  await install(options);
  await manage(root, ['start', '--no-browser']);
  const url = `http://127.0.0.1:${port}`;
  const session = await fetch(`${url}/api/session`, { signal: AbortSignal.timeout(5_000) });
  const cookie = session.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const api = async (route, body) => {
    const response = await fetch(url + route, { headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5_000) });
    assert(response.ok, `API ${route}: ${response.status}`); return response.json();
  };
  const page = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  assert(page.ok); assert((await page.text()).includes('<html'));
  let id;
  const browser = await chromium.launch({ ...(process.env.CANDC_BROWSER_PATH ? { executablePath: process.env.CANDC_BROWSER_PATH } : {}) });
  try {
    const tab = await browser.newPage();
    const failures = [];
    tab.on('pageerror', error => failures.push(error.message));
    await tab.goto(url);
    await tab.getByRole('heading', { name: '新討論', exact: true }).waitFor();
    await tab.getByRole('radiogroup', { name: '回覆來源', exact: true }).locator('input[value="fake"]').check();
    await tab.getByRole('textbox', { name: '討論題目', exact: true }).fill('Release installation demo');
    const created = tab.waitForResponse(response => response.url().endsWith('/api/discussions') && response.request().method() === 'POST');
    await tab.getByRole('button', { name: '建立並開始討論 →', exact: true }).click();
    const response = await created; assert.equal(response.status(), 201); id = (await response.json()).id;
    await tab.locator('.discussion-heading h1').filter({ hasText: 'Release installation demo' }).waitFor();
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && (await api(`/api/discussions/${id}`)).status === 'running') await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(failures, []);
  } finally { await browser.close(); }
  assert(id, 'Browser did not create a discussion.');
  let state; const deadline = Date.now() + 10_000;
  do { state = await api(`/api/discussions/${id}`); if (state.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < deadline);
  assert.equal(state.status, 'paused'); assert(state.messages.some(message => message.sender === 'codex'));
  assert(state.messages.some(message => message.sender === 'claude')); assert.equal(state.backend, 'fake');
  await manage(root, ['stop']);
  await install(options); // Reinstall a stopped version without moving history or CLI workspaces.
  await manage(root, ['start', '--no-browser']);
  const restoredSession = await fetch(`${url}/api/session`);
  const restoredCookie = restoredSession.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const restored = await fetch(`${url}/api/discussions/${id}`, { headers: { Cookie: restoredCookie } });
  assert(restored.ok); assert.equal((await restored.json()).messages.length, state.messages.length);
  await manage(root, ['doctor']);
  await manage(root, ['stop']);
  console.log('Release smoke passed: install, static UI, Demo round, stop, reinstall, history reload and compiled doctor.');
  complete = true;
} finally {
  const status = await runtimeStatus(root, port);
  if (status.health && status.running?.instanceId === status.health.instanceId) await stopServer(root);
  if (complete) {
    assert.equal(path.dirname(parent), path.resolve(tmpdir()));
    assert(path.basename(parent).startsWith('candc-release-smoke-'));
    await rm(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    assert.equal(path.dirname(artifacts), path.resolve('.cache'));
    await rm(artifacts, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } else console.error(`Smoke failure artifacts preserved: ${parent}\nPackage artifacts: ${artifacts}`);
}
