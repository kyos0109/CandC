import { test, expect } from './fixtures';

test('creates an evaluation, shows independent scores, exports and reloads in both locales', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('radio', { name: '示範', exact: true }).check();
  await page.getByRole('switch', { name: '啟用獨立主持人' }).check();
  await page.getByRole('checkbox', { name: '主持人裁判模式' }).check();
  const draft = () => page.locator('.cf-seats input, .cf-seats select, .host-settings input, .host-settings select').evaluateAll(elements => elements.map(element => {
    const field = element as HTMLInputElement; return { label: field.getAttribute('aria-label'), value: field.value, checked: field.checked };
  }));
  const before = await draft();
  await page.getByRole('radio', { name: '選項評選', exact: true }).check();
  await expect(page.locator('.host-card')).toHaveCount(0);
  await page.getByRole('radio', { name: '共同分析', exact: true }).check();
  await expect(page.getByRole('switch', { name: '啟用獨立主持人' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '主持人裁判模式' })).toBeChecked();
  expect(await draft()).toEqual(before);
  await page.getByRole('radio', { name: '選項評選', exact: true }).check();
  await expect(page.getByRole('switch', { name: '啟用獨立主持人' })).toHaveCount(0);
  await expect(page.getByRole('radiogroup', { name: '進行方式' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: '網路研究' })).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: '選項數量' })).toHaveValue('4');
  await page.getByRole('textbox', { name: '討論題目', exact: true }).fill('Choose a practical option.');
  await page.getByRole('button', { name: '建立並開始評選 →' }).click();
  await expect(page.getByRole('heading', { name: 'AI 評選結果' })).toBeVisible();
  await expect(page.getByRole('region', { name: '最終排名' })).toContainText('9.00 / 10');
  await expect(page.getByText('已完成 2／2 位評審')).toBeVisible();
  const id = await page.evaluate(() => localStorage.getItem('candc-discussion'));
  const state = await (await page.request.get('/api/discussions/' + id)).json();
  expect(state.room.calls).toHaveLength(3); expect(state.room.outcome).toBeNull();
  expect(state.moderator).toBeNull(); expect(state.moderatorMode).toBeUndefined();
  const markdown = await (await page.request.get(`/api/discussions/${id}/export?format=markdown`)).text();
  expect(markdown).toContain('AI option evaluation'); expect(markdown).toContain('9.00/10');
  expect((await (await page.request.get(`/api/discussions/${id}/export?format=json`)).json()).room.selection).toEqual(state.room.selection);
  await page.reload(); await expect(page.getByRole('heading', { name: 'AI 評選結果' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('selection-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('selection-mobile.png'), fullPage: true });
  await page.evaluate(() => localStorage.setItem('candc-locale', 'en')); await page.reload();
  await expect(page.getByRole('heading', { name: 'AI evaluation results' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Final ranking' })).toContainText('示範選項 1');
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
  await expect(page.getByText('Generate options and criteria', { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('incomplete evaluation keeps saved scores without ranking and supports explicit retry', async ({ page }) => {
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const id = crypto.randomUUID(), input = { behaviorVersion: 3, kind: 'selection', mode: 'conclusion', topic: 'Selection retry fixture.', backend: 'fake',
      selection: { version: 1, optionCount: 2 }, participants: ['codex', 'claude'].map(id => ({ id, provider: id, role: 'speaker', settings: { model: 'fixture', effort: 'low' } })),
      limits: { maxRounds: 1, maxDurationMs: 30000, turnTimeoutMs: 5000 } };
    for (const [url, data] of [['/api/discussions', { id, input }], [`/api/discussions/${id}/start`, { operationId: crypto.randomUUID() }]] as const) {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (!r.ok) throw new Error(await r.text());
    }
    localStorage.setItem('candc-discussion', id); return id;
  });
  await expect.poll(async () => (await (await page.request.get('/api/discussions/' + id)).json()).activity).toBeNull();
  await page.reload(); await expect(page.getByText('已完成 1／2 位評審')).toBeVisible();
  await expect(page.getByRole('region', { name: '最終排名' })).toHaveCount(0);
  await page.getByText('調整評選時間上限', { exact: true }).click();
  await page.getByRole('spinbutton', { name: '總時間（分鐘）' }).fill('2');
  await page.getByRole('button', { name: '儲存', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/discussions/' + id)).json()).limits.maxDurationMs).toBe(120000);
  await page.getByRole('button', { name: '繼續未完成評選' }).click();
  await expect(page.getByRole('heading', { name: 'AI 評選結果' })).toBeVisible();
  expect((await (await page.request.get('/api/discussions/' + id)).json()).room.calls).toHaveLength(4);
});
