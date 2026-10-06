import { test, expect, createLegacy } from './fixtures';
import type { Page } from '@playwright/test';
import path from 'node:path';

async function history(page: Page) {
  const mobile = (page.viewportSize()?.width ?? 1280) < 768;
  if (mobile && !await page.getByRole('dialog', { name: /討論紀錄|Discussion history/ }).count()) {
    await page.getByRole('button', { name: /開啟討論紀錄|Open discussion history/ }).click();
  }
}
async function folder(page: Page, label: string) { await history(page); await page.locator('.history-folders').getByRole('button', { name: new RegExp('^' + label) }).click(); }
async function createRoom(page: Page, topic: string) {
  await page.goto('/');
  const id = await page.evaluate(async topic => {
    const id = crypto.randomUUID(); const response = await fetch('/api/discussions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, input: {
      behaviorVersion: 3, topic, backend: 'fake', mode: 'manual', participants: ['codex', 'claude'].map(provider => ({ id: provider, provider, role: 'speaker', settings: { model: 'fixture', effort: 'medium' } })),
      limits: { maxRounds: 10, maxDurationMs: 10000, turnTimeoutMs: 2000, maxModeratorCalls: 50 },
    } }) }); if (!response.ok) throw new Error(await response.text()); localStorage.setItem('candc-discussion', id); return id;
  }, topic); await page.reload(); return id;
}

for (const scenario of [
  { locale: 'zh-TW', theme: 'light', width: 1440, height: 900 },
  { locale: 'zh-TW', theme: 'dark', width: 390, height: 844 },
  { locale: 'en', theme: 'dark', width: 1280, height: 720 },
  { locale: 'en', theme: 'light', width: 390, height: 844 },
]) test(`manage version 3: ${scenario.locale} ${scenario.theme} ${scenario.width}`, async ({ page }) => {
  await page.setViewportSize(scenario); await page.addInitScript(({ locale, theme }) => { localStorage.setItem('candc-locale', locale); localStorage.setItem('candc-theme', theme); }, scenario);
  const text = scenario.locale === 'en' ? { active: 'Active', archived: 'Archived', trash: 'Trash', archive: 'Archive', move: 'Move to trash', restore: 'Restore', unarchive: 'Unarchive', del: 'Delete permanently', confirm: 'Confirm permanent deletion', dialog: 'Confirm permanent deletion', search: 'Filter discussion history', manage: 'Manage ', composer: 'Join the discussion', undo: 'Undo' } :
    { active: '一般', archived: '已封存', trash: '垃圾桶', archive: '封存', move: '移到垃圾桶', restore: '還原', unarchive: '取消封存', del: '永久刪除', confirm: '確認永久刪除', dialog: '永久刪除確認', search: '篩選討論紀錄', manage: '管理 ', composer: '加入討論', undo: '撤銷' };
  const topic = `Management content ${scenario.locale} ${scenario.width} ${Date.now()}`, requests: string[] = [], errors: string[] = [];
  page.on('request', request => { if (request.method() === 'GET') requests.push(new URL(request.url()).pathname); }); page.on('pageerror', error => errors.push(error.message));
  const id = await createRoom(page, topic); const original = await (await page.request.get('/api/discussions/' + id)).json();
  await expect(page.getByRole('heading', { name: topic })).toBeVisible();
  await page.getByRole('textbox', { name: text.composer }).fill('Unsent fixture');
  await history(page); await page.getByRole('searchbox', { name: text.search }).fill(topic);
  await page.getByRole('button', { name: text.manage + topic, exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: path.resolve('.cache/management-ui', `${scenario.locale}-${scenario.theme}-${scenario.width}.png`) });
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: text.archive, exact: true }).click();
  expect((await (await page.request.get('/api/discussions/' + id)).json()).management).toBeUndefined();
  await page.getByRole('button', { name: text.manage + topic, exact: true }).click(); page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: text.archive, exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/discussions/' + id)).json()).management?.folder).toBe('archived');
  if (scenario.width < 768) await expect(page.getByRole('dialog', { name: /討論紀錄|Discussion history/ })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: text.composer })).toHaveCount(0);
  await page.getByRole('button', { name: text.undo, exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/discussions/' + id)).json()).management?.folder).toBe('active');
  await expect(page.getByRole('textbox', { name: text.composer })).toHaveValue('');
  await history(page); await page.getByRole('button', { name: text.manage + topic, exact: true }).click(); await page.getByRole('button', { name: text.archive, exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/discussions/' + id)).json()).management?.folder).toBe('archived');
  if (scenario.width < 768) await expect(page.getByRole('dialog', { name: /討論紀錄|Discussion history/ })).toHaveCount(0);
  await folder(page, text.archived);
  await page.getByRole('button', { name: text.manage + topic, exact: true }).click(); await page.getByRole('button', { name: text.move, exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/discussions/' + id)).json()).management?.folder).toBe('trash');
  if (scenario.width < 768) await expect(page.getByRole('dialog', { name: /討論紀錄|Discussion history/ })).toHaveCount(0);
  await folder(page, text.trash);
  await page.getByRole('button', { name: text.manage + topic, exact: true }).click(); await page.locator('.history-menu').getByRole('button', { name: text.restore, exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/discussions/' + id)).json()).management?.folder).toBe('archived');
  if (scenario.width < 768) await expect(page.getByRole('dialog', { name: /討論紀錄|Discussion history/ })).toHaveCount(0);
  const saved = await (await page.request.get('/api/discussions/' + id)).json(); expect(saved.messages).toEqual(original.messages); expect(saved.room.calls).toEqual([]);
  expect((await page.request.get(`/api/discussions/${id}/export?format=json`)).ok()).toBe(true);
  await folder(page, text.archived); await page.getByRole('button', { name: text.manage + topic, exact: true }).click(); await page.getByRole('button', { name: text.move, exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/discussions/' + id)).json()).management?.folder).toBe('trash');
  if (scenario.width < 768) await expect(page.getByRole('dialog', { name: /討論紀錄|Discussion history/ })).toHaveCount(0);
  await folder(page, text.trash); await page.getByRole('button', { name: text.manage + topic, exact: true }).click(); await page.getByRole('button', { name: text.del, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: text.dialog, exact: true }); await expect(dialog).toContainText(topic); await expect(dialog.getByRole('link', { name: 'JSON' })).toBeVisible();
  await page.keyboard.press('Escape'); expect((await page.request.get('/api/discussions/' + id)).ok()).toBe(true);
  await history(page); await page.getByRole('button', { name: text.manage + topic, exact: true }).click(); await page.getByRole('button', { name: text.del, exact: true }).click();
  await page.getByRole('dialog', { name: text.dialog, exact: true }).getByRole('button', { name: text.confirm, exact: true }).click();
  await expect.poll(async () => (await page.request.get('/api/discussions/' + id)).status()).toBe(410);
  await expect.poll(async () => page.evaluate(() => localStorage.getItem('candc-discussion'))).toBeNull();
  expect(requests).not.toContain('/api/discussions'); // Only test creation uses this route; the UI never requests complete history.
  expect(errors).toEqual([]);
});

for (const behaviorVersion of [1, 2]) test(`legacy version ${behaviorVersion} archive discards confirmed drafts and disables editing`, async ({ page }) => {
  const topic = `Legacy management ${behaviorVersion} ${Date.now()}`;
  const id = await createLegacy(page, { input: { behaviorVersion, topic }, start: false });
  const composer = page.getByRole('textbox', { name: '加入討論', exact: true });
  await composer.fill('Draft to discard');
  await page.getByRole('button', { name: '管理 ' + topic, exact: true }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '封存', exact: true }).click();
  await expect(composer).toHaveValue('Draft to discard');
  await page.getByRole('button', { name: '管理 ' + topic, exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '封存', exact: true }).click();
  await expect(composer).toHaveCount(0);
  await expect(page.getByRole('button', { name: '引用', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '更多討論操作', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '顯示名稱', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: '進行方式', exact: true })).toBeDisabled();
  await page.locator('.inspector > header button').click();
  if (behaviorVersion === 2) {
    await page.getByRole('button', { name: '查看議題', exact: true }).click();
    for (const label of ['新增議題', '目前目標', '目前限制']) await expect(page.getByRole('textbox', { name: label, exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '選取議題', exact: true }).first()).toBeDisabled();
    await page.locator('.inspector > header button').click();
  }
  await page.getByRole('button', { name: '撤銷', exact: true }).click();
  await expect(composer).toHaveValue('');
  const state = await (await page.request.get('/api/discussions/' + id)).json();
  expect(state.management.folder).toBe('active');
  expect(state.messages).toHaveLength(1);
  expect(state.status).toBe('ready');
});

test('batch management keeps failed selections and empty-trash confirmation uses a fixed snapshot', async ({ page }) => {
  const topic = 'Batch management ' + Date.now(); const id = await createLegacy(page, { input: { topic }, start: false });
  const other = await page.evaluate(async topic => { const response = await fetch('/api/discussions'); const states = await response.json(); const original = states.find((s: { topic: string }) => s.topic === topic);
    const { id: _, sequence: __, ...unused } = original; void unused;
    const id = crypto.randomUUID(); const create = await fetch('/api/discussions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, input: { behaviorVersion: 2, topic: topic + ' second', agents: original.agents } }) }); if (!create.ok) throw new Error(await create.text()); return id;
  }, topic);
  await page.reload(); await page.getByRole('searchbox', { name: '篩選討論紀錄' }).fill(topic);
  await page.getByRole('button', { name: '管理對話', exact: true }).click(); await page.getByRole('checkbox', { name: '選取本頁', exact: true }).check();
  await page.route(`**/api/discussions/${other}/management`, route => route.fulfill({ status: 409, json: { error: 'VERSION_CONFLICT' } }));
  await page.getByRole('button', { name: '封存', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('版本');
  await expect(page.getByRole('checkbox', { name: '選取 ' + topic + ' second', exact: true })).toBeChecked();
  expect((await (await page.request.get('/api/discussions/' + id)).json()).management.folder).toBe('archived');
  await page.unroute(`**/api/discussions/${other}/management`); await page.getByRole('button', { name: '移到垃圾桶', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/discussions/' + other)).json()).management?.folder).toBe('trash');
  await page.getByRole('button', { name: /^垃圾桶/ }).click(); await page.getByRole('button', { name: '清空垃圾桶', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '永久刪除確認' })).toContainText(topic + ' second');
  const state = await (await page.request.get('/api/discussions/' + id)).json(); await page.request.post(`/api/discussions/${id}/management`, { data: { action: 'trash', operationId: crypto.randomUUID(), expectedSequence: state.sequence } });
  await page.getByRole('button', { name: '確認永久刪除', exact: true }).click();
  await expect.poll(async () => (await page.request.get('/api/discussions/' + other)).status()).toBe(410);
  expect((await (await page.request.get('/api/discussions/' + id)).json()).management.folder).toBe('trash');
});
