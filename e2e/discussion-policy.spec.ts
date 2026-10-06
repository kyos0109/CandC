import { test, expect, choose, closePanel, settings } from './fixtures';
import type { Page } from '@playwright/test';
import path from 'node:path';

const snapshot = (page: Page) => page.evaluate(async () => { const states = await (await fetch('/api/discussions')).json(); return states.find((s: any) => s.topic === 'Active discussion fixture.'); });
test('active policy preserves stage results and a nonblocking question across reload, continuation and mobile layout', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/'); await choose(page, '回覆來源', 'fake'); await page.getByRole('textbox', { name: '討論題目', exact: true }).fill('Active discussion fixture.');
  await page.getByRole('button', { name: '建立並開始討論 →' }).click(); await expect.poll(async () => { const state = await snapshot(page); return state?.room.contributions >= 2 && state.activity === null; }).toBe(true);
  await expect(page.getByRole('button', { name: '查看階段成果' })).toBeVisible(); await page.getByRole('button', { name: '查看階段成果' }).click();
  const stage = page.getByRole('region', { name: '階段成果' }); await expect(stage).toContainText('個人預算待補充不阻塞分析'); await expect(stage.getByText('你的預算範圍？', { exact: true })).toHaveCount(1); await expect(stage).toContainText('研究未啟用');
  let state = await snapshot(page); expect(state.discussionPolicyVersion).toBe(1); expect(state.room.contributions).toBe(2); expect(state.room.workflow.questions).toHaveLength(1); expect(state.room.outcome).toBeNull();
  await page.reload(); await page.getByRole('tab', { name: '結論', exact: true }).click(); await expect(stage).toContainText('你的預算範圍？');
  await stage.getByRole('button', { name: /來源發言/ }).first().click(); await expect(page.getByRole('tab', { name: '對話', exact: true })).toHaveAttribute('aria-selected', 'true');
  await settings(page); await page.getByRole('combobox', { name: '進行方式', exact: true }).selectOption('auto'); await closePanel(page);
  await page.getByRole('button', { name: '繼續討論', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).room.workflow.tasks.find((t: any) => t.key === 'compare-scenarios').status, { timeout: 15000 }).toBe('completed');
  await expect.poll(async () => { const s = await snapshot(page); return [s.room.contributions > 2, s.status !== 'running', s.activity]; }).toEqual([true, true, null]);
  state = await snapshot(page); expect(state.room.workflow.questions).toHaveLength(1); expect(state.room.contributions).toBeGreaterThan(2);
  await page.getByRole('textbox', { name: '加入討論' }).fill('預算已提供，請依原任務繼續。'); await page.getByRole('button', { name: '送出並續談 ↑' }).click(); await expect.poll(async () => (await snapshot(page)).room.workflow.questions[0].status).toBe('answered'); await expect.poll(async () => (await snapshot(page)).activity).toBeNull();
  await page.getByRole('tab', { name: '結論', exact: true }).click(); await expect(stage.getByText('你的預算範圍？', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '繼續討論', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.room-page')).toHaveCSS('opacity', '1');
  if (process.env.CANDC_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CANDC_SCREENSHOT_DIR, 'active-discussion-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('old rooms enable policy explicitly and idle live rooms can change research without starting an AI call', async ({ page }) => {
  await page.goto('/');
  const create = async (backend: 'fake' | 'live') => page.evaluate(async backend => {
    const id = crypto.randomUUID(); const input = { behaviorVersion: 3, topic: 'Policy configuration fixture.', backend, participants: ['codex', 'claude'].map(id => ({ id, provider: id, role: 'speaker', instructions: '', settings: { model: 'fixture', effort: 'medium' } })), moderator: null, limits: { maxRounds: 5, maxDurationMs: 30000, turnTimeoutMs: 5000, maxModeratorCalls: 20 } };
    const response = await fetch('/api/discussions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, input }) }); if (!response.ok) throw new Error(await response.text()); localStorage.setItem('candc-discussion', id); return id;
  }, backend);
  const oldId = await create('fake'); await page.reload(); await settings(page); await page.getByRole('button', { name: '啟用主動討論' }).click(); await expect(page.getByText('已啟用：優先研究、分析及核對，待補充問題集中保存。')).toBeVisible();
  let old = await page.evaluate(async id => (await fetch('/api/discussions/' + id)).json(), oldId); expect(old.room.workflow.version).toBe(1); expect(old.room.calls).toHaveLength(0);
  await closePanel(page); const liveId = await create('live'); await page.reload(); await settings(page); await page.getByRole('checkbox', { name: '啟用討論研究' }).check(); await expect(page.getByRole('textbox', { name: '調整研究目錄' })).toBeVisible();
  const get = () => page.evaluate(async id => (await fetch('/api/discussions/' + id)).json(), liveId);
  await expect.poll(async () => (await get()).research).toBe(true); expect((await get()).activity).toBeNull(); expect((await get()).room.calls).toHaveLength(0);
  await page.getByRole('checkbox', { name: '啟用討論研究' }).uncheck(); await expect.poll(async () => (await get()).research).toBe(false); expect((await get()).roots).toEqual([]); expect((await get()).room.calls).toHaveLength(0);
});
