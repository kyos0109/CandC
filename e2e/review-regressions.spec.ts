import { test, expect, choose, choice, createLegacy, closePanel, pick, contrast } from './fixtures';
import type { Page } from '@playwright/test';
import path from 'node:path';

async function capture(page: Page, name: string) {
  if (process.env.CANDC_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CANDC_SCREENSHOT_DIR, name), fullPage: false });
}
async function readyEnvironment(page: Page) {
  await page.route('**/api/environment', route => route.fulfill({ json: {
    ready: true, codex: { ready: true }, claude: { ready: true }, providers: {
      codex: { ready: true, version: 'fixture' }, claude: { ready: true, version: 'fixture' },
    },
  } }));
  await page.route('**/api/models', route => route.fulfill({ json: {
    codex: [{ id: 'fixture-codex', label: 'Fixture Codex', efforts: ['low', 'high'] }], claude: ['sonnet'], error: null,
  } }));
}
const consoleErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
};

for (const width of [1280, 390]) test(`connection checks preserve the complete creation draft at ${width}px`, async ({ page }) => {
  const errors = consoleErrors(page); await page.setViewportSize({ width, height: 900 }); await readyEnvironment(page); await page.goto('/');
  expect(new URL(page.url()).hostname).toBe('127.0.0.1'); await expect(page).toHaveTitle(/CandC/);
  await page.getByRole('textbox', { name: '討論題目', exact: true }).fill('Preserve this unsaved topic.');
  await page.locator('.supplement > summary').click();
  await page.getByLabel('顯示名稱', { exact: true }).fill('Draft name'); await page.getByLabel('期望成果').fill('Draft goal'); await page.getByLabel('限制', { exact: true }).fill('Draft constraint');
  await page.getByLabel('座位 1 名稱').fill('First draft seat'); await pick(page, '座位 1 模型', /Fixture Codex/);
  await page.getByRole('radiogroup', { name: '座位 1 思考程度', exact: true }).getByRole('radio', { name: 'high' }).check(); await pick(page, '座位 2 模型', 'Sonnet');
  await page.getByRole('switch', { name: '啟用獨立主持人' }).check(); await pick(page, '主持人 模型', /Fixture Codex/);
  await choose(page, '討論方式', 'debate'); await page.getByRole('radiogroup', { name: '座位 1 立場方向', exact: true }).getByRole('radio', { name: '支持' }).check(); await page.getByRole('radiogroup', { name: '座位 2 立場方向', exact: true }).getByRole('radio', { name: '反對' }).check();
  await page.getByLabel('座位 1 立場', { exact: true }).fill('Support'); await page.getByLabel('座位 2 立場', { exact: true }).fill('Oppose');
  await page.getByRole('checkbox', { name: '網路研究', exact: true }).check(); await page.getByLabel('可讀取的本機目錄').fill('C:/fixture/read-only');
  await page.locator('.limits > summary').click(); await page.getByLabel('最多輪次', { exact: true }).fill('17');
  const fields = await page.locator('.create-page input,.create-page textarea,.create-page [role=combobox]').evaluateAll(elements => elements.map(element => {
    const field = element as HTMLInputElement; return { label: field.getAttribute('aria-label'), value: field.value ?? field.textContent, checked: field.checked };
  }));
  const before = await (await page.request.get('/api/discussions')).json();
  await page.getByRole('button', { name: '查看連線與重新檢查' }).click(); await expect(page.getByRole('heading', { name: '連線與設定', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重新檢查', exact: true }).first().click();
  await page.getByRole('button', { name: '返回討論', exact: true }).click();
  await expect(page.getByRole('heading', { name: '新討論', exact: true })).toBeVisible();
  expect(await page.locator('.create-page input,.create-page textarea,.create-page [role=combobox]').evaluateAll(elements => elements.map(element => {
    const field = element as HTMLInputElement; return { label: field.getAttribute('aria-label'), value: field.value ?? field.textContent, checked: field.checked };
  }))).toEqual(fields);
  expect(await (await page.request.get('/api/discussions')).json()).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]); await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await capture(page, `fix-creation-draft-${width}.png`);
});

for (const version of [2, 3]) test(`connection navigation preserves v${version} composer text, quote and private recipient`, async ({ page }) => {
  const errors = consoleErrors(page); await page.setViewportSize({ width: version === 3 ? 390 : 1280, height: 900 });
  const topic = `Draft room v${version}`;
  if (version === 2) await createLegacy(page, { input: { topic } });
  else {
    await page.goto('/'); await choose(page, '回覆來源', 'fake'); await page.getByLabel('討論題目', { exact: true }).fill(topic);
    await page.getByRole('button', { name: '建立並開始討論 →' }).click();
  }
  await expect(page.locator('.discussion-notice').first()).toContainText('已暫停', { timeout: 15000 });
  await expect.poll(async () => (await (await page.request.get('/api/discussions')).json()).find((s: any) => s.topic === topic).activity).toBeNull();
  const before = await (await page.request.get('/api/discussions')).json();
  await page.locator('.message:not(.user):not(.pending)').first().getByRole('button', { name: /^引用/ }).click();
  await choose(page, '傳給', 'claude'); await page.getByLabel('加入討論', { exact: true }).fill('Unsent private draft.');
  const quote = await page.locator('.reply-preview').textContent() ?? '';
  if (version === 3) await page.getByRole('button', { name: '開啟討論紀錄' }).click();
  await page.getByRole('button', { name: '連線與設定', exact: true }).click();
  await expect(page.getByRole('heading', { name: '連線與設定', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '閱讀設定', exact: true }).click(); await expect(page.locator('.inspector')).toBeVisible(); await closePanel(page);
  await page.getByRole('button', { name: '返回討論', exact: true }).click();
  await expect(page.getByLabel('加入討論', { exact: true })).toHaveValue('Unsent private draft.');
  await expect(choice(page, '傳給')).toHaveValue('claude'); await expect(page.locator('.reply-preview')).toHaveText(quote);
  expect(await (await page.request.get('/api/discussions')).json()).toEqual(before);
  expect(errors).toEqual([]); await capture(page, `fix-composer-v${version}.png`);
});

for (const version of [2, 3]) test(`connection navigation preserves v${version} scroll following and reading position during background replies`, async ({ page }) => {
  await page.addInitScript(() => {
    const sources: EventSource[] = [];
    (window as unknown as { candcTestSources: EventSource[] }).candcTestSources = sources;
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL, options?: EventSourceInit) { super(url, options); sources.push(this); }
    };
  });
  const errors = consoleErrors(page); await page.setViewportSize({ width: 1280, height: 900 });
  const topic = `Background scroll v${version} ${crypto.randomUUID()}`;
  let id: string;
  if (version === 2) id = await createLegacy(page, { input: { topic } });
  else {
    await page.goto('/'); await choose(page, '回覆來源', 'fake'); await page.getByLabel('討論題目', { exact: true }).fill(topic);
    await page.getByRole('button', { name: '建立並開始討論 →' }).click();
    await expect(page.locator('.discussion-notice').first()).toContainText('已暫停');
    id = (await (await page.request.get('/api/discussions')).json()).find((s: any) => s.topic === topic).id;
  }
  const state = async () => (await page.request.get(`/api/discussions/${id}`)).json();
  await expect.poll(async () => (await state()).activity).toBeNull();
  expect((await page.request.post(`/api/discussions/${id}/messages`, { data: {
    messageId: crypto.randomUUID(), text: 'Long reading context.\n\n'.repeat(160), recipient: version === 2 ? 'both' : 'all',
  } })).ok()).toBe(true);
  await expect(page.locator('.message.user').last()).toContainText('Long reading context.');
  const viewport = page.locator('.messages');
  await viewport.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => viewport.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
  if (version === 3) {
    await page.getByRole('tab', { name: '診斷', exact: true }).click();
    await page.getByRole('tab', { name: '對話', exact: true }).click();
    await expect.poll(() => viewport.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
  }
  const replyWhileHidden = async () => {
    await page.getByRole('button', { name: '連線與設定', exact: true }).click();
    await expect(page.getByRole('heading', { name: '連線與設定', exact: true })).toBeVisible();
    const messageCount = (await state()).messages.length;
    expect((await page.request.post(`/api/discussions/${id}/messages`, { data: {
      messageId: crypto.randomUUID(), text: `New background request ${messageCount}.`, recipient: version === 2 ? 'both' : 'all',
    } })).ok()).toBe(true);
    expect((await page.request.post(`/api/discussions/${id}/start`, { data: { operationId: crypto.randomUUID() } })).ok()).toBe(true);
    await expect.poll(async () => (await state()).activity, { timeout: 15000 }).toBeNull();
    const completed = await state();
    expect(completed.messages.length).toBeGreaterThan(messageCount + 1);
    await page.getByRole('button', { name: '返回討論', exact: true }).click();
    // Backend completion precedes the debounced SSE refresh in the browser.
    await expect(page.locator(`[id="message-${completed.messages.at(-1).id}"]`)).toBeAttached();
    await expect(page.locator('.status')).toContainText('已暫停');
    await expect(page.locator('.message.pending')).toHaveCount(0);
  };
  await replyWhileHidden();
  await expect.poll(() => viewport.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
  await viewport.evaluate(async (element, version) => {
    await new Promise<void>(resolve => requestAnimationFrame(() => {
      element.scrollTop = 100;
      // A panel update commits before the scroll event from this frame. The
      // v3 layout effect must observe the reader's move even with stale state.
      if (version === 3) (document.querySelector('button[aria-label="閱讀設定"]') as HTMLButtonElement).click();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
  }, version);
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBe(100);
  if (version === 3) await closePanel(page);
  await page.getByRole('button', { name: '連線與設定', exact: true }).click();
  await page.getByRole('button', { name: '返回討論', exact: true }).click();
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBe(100);
  const deliverProgress = async (preview: string | null) => {
    expect(await page.evaluate(async ({ id, preview }) => {
      const sources = (window as unknown as { candcTestSources: EventSource[] }).candcTestSources.filter(source => source.url.includes(id) && source.readyState !== EventSource.CLOSED);
      for (const source of sources) source.dispatchEvent(new MessageEvent('progress', { data: JSON.stringify({ data: preview === null ? {} : { preview, characters: preview.length } }) }));
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return sources.length;
    }, { id, preview })).toBeGreaterThan(0);
  };
  // Inactive progress is invisible; receiving/clearing it must not advertise
  // new visible content after the completed response has already been read.
  await deliverProgress('Preview of an already completed response.');
  await expect(page.locator('.message.pending')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '有新內容 · 回到最新訊息 ↓' })).toBeHidden();
  await deliverProgress(null);
  await replyWhileHidden();
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBe(100);
  await expect(page.getByRole('button', { name: '有新內容 · 回到最新訊息 ↓' })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const theme of ['light', 'dark']) test(`${theme} ready and confirmed status chips meet text contrast requirements`, async ({ page }) => {
  const errors = consoleErrors(page); await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(theme => { localStorage.setItem('candc-theme', theme); }, theme); await readyEnvironment(page); await page.goto('/');
  await expect(page.locator('.seat-row .chip.ok').first()).toBeVisible();
  const ready = await contrast(page.locator('.seat-row .chip.ok').first()); expect(ready.ratio).toBeGreaterThanOrEqual(4.5);
  await capture(page, `fix-ready-${theme}.png`);
  await choose(page, '回覆來源', 'fake'); await choose(page, '進行方式', 'conclusion'); await page.getByLabel('討論題目', { exact: true }).fill(`Contrast fixture ${theme}`);
  await page.getByRole('button', { name: '建立並開始討論 →' }).click();
  await expect(page.locator('.room-outcome')).toBeVisible({ timeout: 15000 });
  const confirmed = await contrast(page.locator('.roster-card .chip.ok').first()); expect(confirmed.ratio).toBeGreaterThanOrEqual(4.5);
  expect(errors).toEqual([]); console.log(JSON.stringify({ theme, ready, confirmed })); await capture(page, `fix-confirmed-${theme}.png`);
});

test('a constructor seat can open diagnostics before its first native session exists', async ({ page }) => {
  const errors = consoleErrors(page); await page.goto('/');
  const id = await page.evaluate(async () => {
    const id = crypto.randomUUID();
    const response = await fetch('/api/discussions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, input: {
      behaviorVersion: 3, topic: 'Constructor diagnostics fixture.', participants: ['constructor', 'claude'].map((seat, i) => ({ id: seat, provider: i ? 'claude' : 'codex', role: 'speaker', settings: { model: 'fixture', effort: 'medium' } })),
      limits: { maxRounds: 4, maxDurationMs: 60000, turnTimeoutMs: 10000 },
    } }) });
    if (!response.ok) throw new Error('Fixture create failed.'); localStorage.setItem('candc-discussion', id); return id;
  });
  await page.reload(); await page.getByRole('tab', { name: '診斷', exact: true }).click();
  await expect(page.getByText('尚未建立／已退役')).toHaveCount(2);
  expect((await (await page.request.get(`/api/discussions/${id}`)).json()).room.calls).toHaveLength(0); expect(errors).toEqual([]);
});
