import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import path from 'node:path';

async function create(page: Page, mode: string, manual = false) {
  await page.goto('/');
  const id = await page.evaluate(async ({ mode, manual }) => {
    const id = crypto.randomUUID();
    const input = { behaviorVersion: 3, discussionPolicyVersion: 1, topic: 'Delivery fixture:' + mode, backend: 'fake', mode: manual ? 'manual' : 'conclusion', moderator: null,
      participants: ['codex', 'claude'].map(id => ({ id, provider: id, role: 'speaker', settings: { model: 'fixture', effort: 'low' }, instructions: '' })),
      limits: { maxRounds: 6, maxDurationMs: 30000, turnTimeoutMs: 5000 } };
    for (const [url, data] of [['/api/discussions', { id, input }], [`/api/discussions/${id}/start`, { operationId: crypto.randomUUID() }]] as const) {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!response.ok) throw new Error(await response.text());
    }
    localStorage.setItem('candc-discussion', id); return id;
  }, { mode, manual });
  await expect.poll(async () => (await (await page.request.get('/api/discussions/' + id)).json()).activity).toBeNull();
  await page.reload(); await page.getByRole('tab', { name: /^結論/ }).click(); return id;
}

test('a work-list draft is rejected and manual revision becomes a reviewed interim answer across reload and mobile', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const id = await create(page, 'revision', true);
  await expect(page.getByText('這份文字只有未來工作，沒有交付使用者要求的答案。', { exact: true })).toBeVisible();
  await expect(page.getByText('請補齊實際運作方式。', { exact: true })).toBeVisible();
  await expect(page.locator('.room-outcome')).toHaveCount(0);
  expect((await (await page.request.post('/api/discussions/' + id + '/start', { data: { operationId: crypto.randomUUID() } })).json()).status).toBe('running');
  await expect.poll(async () => (await (await page.request.get('/api/discussions/' + id)).json()).activity).toBeNull();
  await page.reload(); await page.getByRole('tab', { name: /^結論/ }).click();
  const result = page.getByRole('region', { name: '已審查的階段成果' });
  await expect(result.getByText('階段共識 · 討論仍可繼續', { exact: false })).toBeVisible();
  await expect(result).toContainText('讓每個質疑都有可追溯的回覆'); await expect(result).toContainText('依據與說明');
  await expect(page.locator('.room-outcome')).toHaveCount(0);
  const saved = await (await page.request.get('/api/discussions/' + id)).json();
  expect(saved.room.outcome).toBeNull(); expect(saved.room.interimResults).toHaveLength(1);
  expect(saved.room.interimResults[0].reviews).toHaveLength(1); expect(saved.room.contributions).toBe(4);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.CANDC_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CANDC_SCREENSHOT_DIR, 'conclusion-delivery-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});

for (const [mode, title] of [['partial', '暫定結果 · 結論交付尚未完成'], ['undetermined', '已完成結論 · 目前無法定論'], ['disagreement', '已完成分歧結論']]) {
  test(`delivery status remains explicit for ${mode}`, async ({ page }) => {
    const id = await create(page, mode!);
    await expect(page.getByRole('heading', { name: title!, exact: true })).toBeVisible();
    const s = await (await page.request.get('/api/discussions/' + id)).json();
    expect(s.room.outcome.delivery.status).toBe(mode === 'partial' ? 'partial' : 'complete');
    if (mode === 'partial') { await expect(page.getByRole('tab', { name: '結論 暫定結果' })).toBeVisible(); await expect(page.getByRole('region', { name: '共識結果' })).toContainText('第二部分的答案仍缺少'); }
    if (mode === 'disagreement') await expect(page.getByRole('region', { name: '共識結果' })).toContainText('雙方立場不同');
  });
}
