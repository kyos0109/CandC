import { test, expect, choose, settings, closePanel, settled } from './fixtures';
import type { Page } from '@playwright/test';

const saved = (page: Page, topic: string) => page.evaluate(async (topic: string) => (await (await fetch('/api/discussions')).json()).find((s: any) => s.topic === topic), topic);
const create = async (page: Page, topic: string) => { await page.getByRole('textbox', { name: '討論題目', exact: true }).fill(topic); await page.getByRole('button', { name: '建立並開始討論 →' }).click(); await expect(page.locator('.discussion-notice').first()).toContainText('已暫停', { timeout: 15000 }); };

test('four seats and a moderator run as independent sessions, and private input never reaches the moderator', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '新討論' })).toBeVisible();
  await expect(page.getByRole('switch', { name: '啟用獨立主持人' })).not.toBeChecked();
  await choose(page, '回覆來源', 'fake');
  await page.getByRole('button', { name: '四方＋主持' }).click();
  await expect(page.getByRole('switch', { name: '啟用獨立主持人' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '主持人裁判模式' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: '主持人裁判模式' }).check();
  await create(page, 'Moderator four-provider fixture.');
  const state = await saved(page, 'Moderator four-provider fixture.');
  expect(state.behaviorVersion).toBe(3); expect(state.participants).toHaveLength(4);
  expect(state.messages.filter((m: any) => m.purpose === 'discussion' && m.sender !== 'user')).toHaveLength(4);
  expect(state.room.sessions.codex.id).not.toBe(state.room.sessions.moderator.id);
  // Grants appear as one-line events in the stream; routine monitoring never does.
  await expect(page.locator('.room-event').first()).toContainText('主持人');
  await expect(page.locator('.room-event').filter({ hasText: 'observe' })).toHaveCount(0);
  await expect(page.getByText('獨立主持人 · 可中止發言 · 私訊不可見')).toBeVisible();
  await settings(page); await page.getByRole('combobox', { name: '進行方式', exact: true }).selectOption('auto'); await closePanel(page);
  await choose(page, '傳給', 'gemini');
  await expect(page.locator('.privacy-note')).toContainText('主持人與其他座位');
  await page.getByRole('textbox', { name: '加入討論' }).fill('PRIVATE-ONLY-GEMINI-ROOM'); await page.getByRole('button', { name: '送出並續談 ↑' }).click();
  await expect(page.locator('.private-tag')).toContainText('私訊給 Gemini');
  await expect(page.locator('.room-outcome')).toContainText('主持裁決', { timeout: 15000 });
  const final = await page.evaluate(async (id: string) => (await (await fetch('/api/discussions/' + id)).json()), state.id);
  const privateId = final.messages.find((m: any) => m.text === 'PRIVATE-ONLY-GEMINI-ROOM').id;
  expect(final.room.calls.filter((c: any) => c.participant === 'moderator').some((c: any) => c.messages.includes(privateId))).toBe(false);
  expect(final.room.outcome.authority).toBe('moderator');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('textbox', { name: '加入討論' })).toBeVisible();
  await page.screenshot({ path: '.cache/verification/room-moderator-mobile.png' });
  await page.getByRole('tab', { name: '診斷' }).click(); await expect(page.getByText('呼叫按 agent、session 與任務版本記錄；接收輸入與完成回答分別保存。')).toBeVisible();
});

test('three seats without a moderator keep no moderator session, preserve state after reload and adapt the roster to the window', async ({ page }) => {
  await page.goto('/'); await choose(page, '回覆來源', 'fake'); await page.getByRole('button', { name: '三方會審' }).click();
  await create(page, 'Three-speaker fixture.');
  await page.reload(); await expect(page.locator('.discussion-heading h1')).toHaveText('Three-speaker fixture.');
  const state = await saved(page, 'Three-speaker fixture.');
  expect(state.moderator).toBeNull(); expect(state.room.sessions.moderator).toBeUndefined(); expect(state.room.contributions).toBe(3);
  // On a wide screen the roster stays docked beside the conversation; on a narrow one it is an opt-in drawer.
  await expect(page.getByRole('complementary', { name: '參與者' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('textbox', { name: '加入討論' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('dialog', { name: '參與者' })).toHaveCount(0);
  await page.getByRole('button', { name: '參與者', exact: true }).click(); await expect(page.getByRole('dialog', { name: '參與者' })).toBeVisible(); await closePanel(page);
  await page.screenshot({ path: '.cache/verification/room-mobile.png' });
});

test('two seats on one provider keep separate identities, sessions and private input', async ({ page }) => {
  await page.goto('/'); await choose(page, '回覆來源', 'fake');
  await page.getByRole('button', { name: '同一個 AI 多觀點' }).click();
  await page.getByRole('group', { name: '選擇要重複使用的 AI' }).getByRole('button', { name: 'Codex' }).click();
  await page.getByRole('textbox', { name: '座位 2 名稱' }).fill('Codex · 維運');
  await create(page, 'Same-provider fixture.');
  const state = await saved(page, 'Same-provider fixture.');
  expect(state.participants.map((p: any) => p.id)).toEqual(['codex', 'codex-2']);
  expect(state.participants.map((p: any) => p.label)).toEqual([undefined, 'Codex · 維運']);
  expect(state.room.sessions.codex.id).not.toBe(state.room.sessions['codex-2'].id); expect(state.room.contributions).toBe(2);
  // Later seats of one provider are numbered and outlined, so identity is not only a colour.
  await expect(page.locator('.participants-entry .seat-avatar')).toHaveText(['C1', 'C2']);
  await expect(page.locator('.participants-entry .seat-avatar.alt')).toHaveCount(1);
  await expect(page.getByRole('radiogroup', { name: '傳給' }).getByRole('radio')).toHaveCount(3);
  await choose(page, '傳給', 'codex-2');
  await expect(page.locator('.privacy-note')).toContainText('包含同一個 AI 的另一個 session');
  await page.getByRole('textbox', { name: '加入討論' }).fill('PRIVATE-TO-SECOND-CODEX'); await page.getByRole('button', { name: '送出並續談 ↑' }).click();
  await expect(page.locator('.private-tag')).toContainText('私訊給 Codex · 維運');
  await expect.poll(async () => { const s = await saved(page, 'Same-provider fixture.'); return s.activity === null && s.messages.some((m: any) => m.text === 'PRIVATE-TO-SECOND-CODEX'); }, { timeout: 15000 }).toBe(true);
  const final = await saved(page, 'Same-provider fixture.'), privateId = final.messages.find((m: any) => m.text === 'PRIVATE-TO-SECOND-CODEX').id;
  expect(final.room.calls.filter((c: any) => c.participant === 'codex').some((c: any) => c.messages.includes(privateId))).toBe(false);
  expect(final.room.calls.filter((c: any) => c.participant === 'codex-2').some((c: any) => c.messages.includes(privateId))).toBe(true);
});

test('seat rows keep their height when the discussion form or the reply source changes', async ({ page }) => {
  await page.goto('/');
  const row = page.locator('.seat-row').first(); await settled(row);
  const height = () => row.evaluate(el => el.getBoundingClientRect().height), before = await height();
  await choose(page, '討論方式', 'debate'); expect(await height()).toBe(before);
  await choose(page, '回覆來源', 'fake'); expect(await height()).toBe(before);
  await choose(page, '討論方式', 'discussion'); expect(await height()).toBe(before);
  await choose(page, '回覆來源', 'live'); expect(await height()).toBe(before);
});

test('a debate needs a side for every seat, is confirmed and started by creating it; other discussions never ask for a side', async ({ page }) => {
  await page.goto('/'); await choose(page, '回覆來源', 'fake');
  await expect(page.getByRole('radiogroup', { name: '座位 1 立場方向' })).toHaveCount(0);
  await choose(page, '討論方式', 'debate');
  await page.getByRole('textbox', { name: '討論題目', exact: true }).fill('Debate fixture.');
  await expect(page.getByRole('button', { name: '建立並開始辯論 →' })).toBeDisabled();
  await expect(page.locator('.start-bar .why')).toContainText('每個座位選擇支持或反對');
  const side = (seat: number, name: string) => page.getByRole('radiogroup', { name: `座位 ${seat} 立場方向`, exact: true }).getByRole('radio', { name }).check();
  await side(1, '支持'); await expect(page.getByRole('button', { name: '建立並開始辯論 →' })).toBeDisabled();
  await side(2, '反對'); await expect(page.getByRole('button', { name: '建立並開始辯論 →' })).toBeEnabled();
  await page.getByLabel('座位 1 立場', { exact: true }).fill('Supports the proposal.');
  await page.getByRole('button', { name: '建立並開始辯論 →' }).click();
  // The side is saved as the seat's position, with the optional detail after it.
  await expect.poll(async () => (await (await page.request.get('/api/discussions')).json()).find((d: { topic: string }) => d.topic === 'Debate fixture.')?.participants.map((p: { instructions: string }) => p.instructions)).toEqual(['支持：Supports the proposal.', '反對']);
  // Choosing the sides was the confirmation: no second prompt, and the debate starts without a separate continue.
  await expect.poll(async () => { const d = (await (await page.request.get('/api/discussions')).json()).find((x: { topic: string }) => x.topic === 'Debate fixture.'); return d && d.rolesConfirmed && (d.activity !== null || d.room.contributions > 0); }).toBeTruthy();
  await expect(page.getByText('請先確認所有發言者的立場。')).toHaveCount(0);
});
