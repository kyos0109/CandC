import { test, expect, choose, createLegacy } from './fixtures';
import type { Page } from '@playwright/test';

async function holdChunk(page: Page, name: string) {
  let release!: () => void, requested!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const request = new Promise<void>(resolve => { requested = resolve; });
  await page.route(`**/assets/${name}-*.js`, async route => {
    requested();
    await gate;
    await route.continue();
  });
  return { release, request };
}

test('new rooms and settings load on demand without losing the mounted composer', async ({ page }) => {
  const chunks: string[] = [], errors: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'script') chunks.push(new URL(request.url()).pathname); });
  page.on('pageerror', error => errors.push(error.message));
  const room = await holdChunk(page, 'RoomView'), connections = await holdChunk(page, 'ConnectionsPage');
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '新討論', exact: true })).toBeVisible();
    expect(chunks.some(url => /\/(RoomView|DiscussionView|ConnectionsPage|timeline)-/.test(url))).toBe(false);
    await choose(page, '回覆來源', 'fake');
    await page.getByRole('textbox', { name: '討論題目', exact: true }).fill('Deferred room fixture.');
    await page.getByRole('button', { name: '建立並開始討論 →' }).click();
    await room.request;
    await expect(page.getByRole('status').filter({ hasText: '正在載入討論室…' })).toBeVisible();
    await expect(page.getByRole('button', { name: '新討論', exact: true })).toBeEnabled();
    room.release();
    await expect(page.locator('.discussion-notice').first()).toContainText('已暫停');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Deferred room fixture.');
    expect(chunks.some(url => /\/DiscussionView-/.test(url))).toBe(false);
    expect(chunks.some(url => /\/ConnectionsPage-/.test(url))).toBe(false);
    const draft = page.getByRole('textbox', { name: '加入討論', exact: true });
    await draft.fill('Unsent draft while settings load.');
    await choose(page, '傳給', 'claude');
    const composer = await draft.elementHandle();
    await page.getByRole('button', { name: '連線與設定', exact: true }).click();
    await connections.request;
    await expect(page.getByRole('status').filter({ hasText: '正在載入連線與設定…' })).toBeVisible();
    expect(await composer!.evaluate(element => element.isConnected)).toBe(true);
    connections.release();
    await expect(page.getByRole('heading', { name: '連線與設定', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回討論', exact: true }).click();
    await expect(draft).toHaveValue('Unsent draft while settings load.');
    await expect(page.getByRole('radiogroup', { name: '傳給', exact: true }).locator('input:checked')).toHaveValue('claude');
    expect(await composer!.evaluate(element => element.isConnected)).toBe(true);
    expect(errors).toEqual([]);
  } finally { room.release(); connections.release(); }
});

test('saved legacy discussions show a loading status before their view arrives', async ({ page }) => {
  const chunks: string[] = [], errors: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'script') chunks.push(new URL(request.url()).pathname); });
  page.on('pageerror', error => errors.push(error.message));
  const legacy = await holdChunk(page, 'DiscussionView');
  try {
    await createLegacy(page, { input: { topic: 'Deferred legacy fixture.' }, start: false });
    await legacy.request;
    await expect(page.getByRole('status').filter({ hasText: '正在載入討論室…' })).toBeVisible();
    legacy.release();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Deferred legacy fixture.');
    await expect(page.getByRole('textbox', { name: '加入討論', exact: true })).toBeVisible();
    expect(chunks.some(url => /\/RoomView-/.test(url))).toBe(false);
    expect(chunks.some(url => /\/ConnectionsPage-/.test(url))).toBe(false);
    expect(errors).toEqual([]);
  } finally { legacy.release(); }
});
