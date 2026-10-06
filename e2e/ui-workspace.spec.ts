import { test, expect, settings, closePanel, reading, choose, choice, createLegacy } from './fixtures';
import type { Page } from '@playwright/test';
import type { Discussion } from '../src/domain';
import path from 'node:path';
const screenshots = process.env.CANDC_SCREENSHOT_DIR;
async function capture(page: Page, name: string) { if (screenshots) await page.screenshot({ path: path.join(screenshots, name + '.png') }); }
async function create(page: Page, long = false) {
  const id = await createLegacy(page, { input: { topic: '介面驗證：讓討論容易閱讀' + (long ? '\n' + '完整原始題目與條件必須保留。'.repeat(60) : '') } });
  await expect.poll(async () => (await (await page.request.get('/api/discussions/' + id)).json()).activity, { timeout: 20_000 }).toBeNull();
  return id;
}
async function bounds(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('.messages')!.getBoundingClientRect();
    const composer = document.querySelector('.composer')!.getBoundingClientRect();
    return { ratio: viewport.height / innerHeight, height: viewport.height, composerBottom: composer.bottom,
      overflow: document.documentElement.scrollWidth > innerWidth, scroll: document.querySelector('.messages')!.scrollTop,
      font: getComputedStyle(document.querySelector('.markdown')!).fontSize };
  });
}

for (const theme of ['light', 'dark']) for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`${theme} ${size.width}x${size.height}: readable viewport, inspectors, fonts and full content`, async ({ page }) => {
    test.setTimeout(40_000); const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setViewportSize(size); await page.addInitScript(theme => { localStorage.setItem('candc-theme', theme); localStorage.setItem('candc-font-size', '16'); }, theme);
    const id = await create(page, true), state = async (): Promise<Discussion> => (await page.request.get('/api/discussions/' + id)).json();
    const initial = await state();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('介面驗證：讓討論容易閱讀');
    await expect(page.locator('.status')).toContainText('已暫停');
    let measurements = await bounds(page);
    expect(measurements.ratio).toBeGreaterThanOrEqual(size.width < 768 ? .5 : .6);
    expect(measurements.overflow).toBe(false); expect(measurements.composerBottom).toBeLessThanOrEqual(size.height); expect(measurements.font).toBe('16px');
    await page.locator('.messages').evaluate(el => { el.scrollTop = 0; });
    await page.getByLabel('加入討論').fill('尚未送出的草稿');
    await page.getByRole('button', { name: '查看議題' }).click();
    await expect(page.locator('.inspector')).toBeVisible();
    await expect(page.locator('.issue-row')).toContainText('完整原始題目');
    const opened = await bounds(page); expect(opened.height).toBe(measurements.height); expect(opened.scroll).toBe(0);
    expect(opened.overflow).toBe(false);
    await capture(page, `issues-${theme}-${size.width}`);
    if (size.width < 1280) {
      await expect(page.getByRole('dialog', { name: '議題與確認' })).toHaveAttribute('aria-modal', 'true');
      await page.keyboard.press('Shift+Tab'); expect(await page.locator('.inspector').evaluate(el => el.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: '查看議題' })).toBeFocused();
    } else { await expect(page.getByRole('complementary', { name: '議題與確認' })).toBeVisible(); await closePanel(page); }
    await expect(page.getByLabel('加入討論')).toHaveValue('尚未送出的草稿');
    await page.getByLabel('加入討論').fill('');
    await page.locator('.messages').evaluate(el => { el.scrollTop = 0; });
    await page.locator('.message.codex').first().evaluate(el => el.scrollIntoView({ block: 'start' }));
    await capture(page, `workspace-${theme}-${size.width}`);
    for (const font of ['14', '16', '18']) {
      await reading(page); await page.getByLabel('對話字級').selectOption(font); await closePanel(page);
      expect((await bounds(page)).font).toBe(font + 'px'); expect((await bounds(page)).overflow).toBe(false);
    }
    await reading(page); await page.getByLabel('閱讀模式').selectOption('full'); await closePanel(page);
    await expect(page.locator('.public-details').first()).toHaveAttribute('open', '');
    await expect(page.locator('.message.codex')).toContainText('段落 14'); await expect(page.locator('.message.claude')).toContainText('END-claude');
    await expect(page.locator('.markdown table')).toHaveCount(2); await expect(page.locator('.markdown pre')).toHaveCount(2);
    expect(await page.locator('.table-scroll').first().evaluate(el => el.scrollWidth > el.clientWidth)).toBe(size.width === 390);
    expect(await page.locator('.markdown pre').first().evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.locator('.messages').evaluate(el => { el.scrollTop = 0; });
    await page.locator('.message.codex').first().evaluate(el => el.scrollIntoView({ block: 'start' }));
    await capture(page, `full-${theme}-${size.width}`);
    await reading(page); await page.getByLabel('深色模式').click(); await page.getByLabel('對話字級').selectOption('16'); await closePanel(page);
    expect(await state()).toEqual(initial); expect(await (await page.request.get('/api/discussions/' + id + '/export?format=json')).json()).toEqual(initial);
    expect(errors).toEqual([]);
    console.log(JSON.stringify({ theme, ...size, ...measurements }));
  });
}

test('drafts, source focus, recipient scope, name metadata, persistence and scroll freeze', async ({ page }) => {
  test.setTimeout(50_000); const id = await create(page);
  const state = async (): Promise<Discussion> => (await page.request.get('/api/discussions/' + id)).json();
  const before = await state();
  await page.locator('.message.codex').first().getByRole('button', { name: '引用追問' }).click();
  await expect(page.locator('.reply-preview')).toContainText('引用 Codex');
  await page.getByRole('button', { name: '移除引用' }).click(); expect((await state()).v2!.calls).toHaveLength(2);
  await page.locator('.message.codex').first().getByRole('button', { name: '請另一方檢查' }).click();
  await expect(choice(page, '傳給')).toHaveValue('claude');
  await choice(page, '傳給').focus(); await page.keyboard.press('ArrowLeft'); await expect(choice(page, '傳給')).toHaveValue('codex');
  await page.getByRole('button', { name: '移除引用' }).click(); await page.getByLabel('加入討論').fill('');
  await settings(page); await page.getByLabel('顯示名稱').fill('閱讀與回應'); await page.getByRole('button', { name: '儲存名稱' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('閱讀與回應'); await closePanel(page);
  const named = await state(); expect(named.v2).toEqual(before.v2); expect(named.messages).toEqual(before.messages); expect(named.topic).toBe(before.topic);
  await reading(page); await page.getByLabel('對話字級').selectOption('18'); await page.getByLabel('深色模式').click(); await closePanel(page);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.reload(); await expect(page.getByRole('heading', { level: 1 })).toHaveText('閱讀與回應');
  expect((await bounds(page)).font).toBe('18px'); expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
  await reading(page); await page.getByLabel('閱讀模式').selectOption('highlights'); await closePanel(page);
  await page.locator('.message.claude').first().getByRole('button', { name: '回應來源' }).click();
  await expect(page.locator('.message.user').first()).toBeFocused();
  await reading(page); await page.getByLabel('閱讀模式').selectOption('full'); await closePanel(page);
  await page.getByLabel('加入討論').fill('Only Codex should receive this user input.'); await choose(page, '傳給', 'codex');
  // Hold resume until the browser has delivered the scroll event. Otherwise a
  // fast fixture reply can arrive between scrollTop assignment and onScroll.
  let releaseStart!: () => void, startRequested!: () => void;
  const startGate = new Promise<void>(resolve => { releaseStart = resolve; });
  const requested = new Promise<void>(resolve => { startRequested = resolve; });
  await page.route(`**/api/discussions/${id}/start`, async route => { startRequested(); await startGate; await route.continue(); });
  await page.getByRole('button', { name: '送出並續談 ↑' }).click();
  await requested;
  await page.locator('.messages').evaluate(async el => { el.scrollTop = 0; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  expect(await page.locator('.messages').evaluate(el => el.scrollTop)).toBe(0);
  releaseStart();
  await expect(page.getByRole('button', { name: '有新內容 · 回到最新訊息 ↓' })).toBeVisible();
  await expect.poll(async () => (await state()).activity, { timeout: 20_000 }).toBeNull();
  expect(await page.locator('.messages').evaluate(el => el.scrollTop)).toBe(0);
  await expect(page.locator('.message.user').last()).toContainText('傳給 codex');
  await page.getByRole('button', { name: '有新內容 · 回到最新訊息 ↓' }).click();
  expect(await page.locator('.messages').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
  await settings(page); await page.getByRole('button', { name: '查看來源' }).click(); await expect(page.locator('.inspector')).toHaveCount(1); await closePanel(page);
  const exported = await (await page.request.get('/api/discussions/' + id + '/export?format=markdown')).text(); expect(exported).toContain('段落 14'); expect(exported).toContain('END-claude');
});

test('mobile history drawer focus, reduced motion, and old history without migration', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const id = await create(page); const before = await (await page.request.get('/api/discussions/' + id)).json();
  await page.getByRole('button', { name: '開啟討論紀錄' }).click();
  await expect(page.getByRole('dialog', { name: '討論紀錄' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: '開啟討論紀錄' })).toBeFocused();
  expect(await (await page.request.get('/api/discussions/' + id)).json()).toEqual(before);
  const legacy = { ...before, behaviorVersion: 1, v2: undefined, displayName: undefined, displayVersion: undefined, topic: '舊資料第一行\n原始完整題目' };
  await page.route('**/api/discussions/' + legacy.id, async route => route.fulfill({ json: legacy }));
  await page.reload(); await expect(page.getByRole('heading', { level: 1 })).toHaveText('舊資料第一行');
  await page.getByRole('button', { name: '查看議題' }).click(); await expect(page.getByRole('button', { name: '升級為新討論' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('原始完整題目'); await capture(page, 'legacy-mobile');
  expect(await (await page.request.get('/api/discussions/' + id)).json()).toEqual(before);
});

test('four AI presentation fixture labels roles and aligns speech independently of provider enums', async ({ page }) => {
  const id = await create(page); const before = await (await page.request.get('/api/discussions/' + id)).json();
  const participant = (name: string, role: string, symbol: string) => ({ model: 'presentation-only', effort: 'fixture', name, role, symbol });
  const base = before.messages[1];
  const fixture = { ...before, displayName: '四個 AI 呈現 fixture · 不支援執行', agents: { ...before.agents, host: participant('主持人', '主持', 'H'), researcher: participant('研究員', '第三 AI', 'R') }, evidence: [{ source: 'fixture://local-source', sha256: 'a'.repeat(64), retrievedAt: before.createdAt, truncated: false, text: 'Synthetic source evidence; presentation only.' }], messages: [before.messages[0], { ...base, id: 'host-event', sender: 'host', presentation: 'process', text: '呈現 fixture：先比較方案，再核對證據。' }, { ...base, id: 'host-speech', sender: 'host', text: '先確認共同限制，實質發言保留相同閱讀欄。' }, ...before.messages.slice(1), { ...base, id: 'research-speech', sender: 'researcher', text: '這是呈現 fixture；沒有新增 provider 或模型呼叫。' }] };
  await page.route('**/api/discussions/' + fixture.id, route => route.fulfill({ json: fixture }));
  await page.reload(); await expect(page.locator('.process-notice')).toHaveCount(1); await expect(page.locator('.message.host')).toHaveCount(1);
  const left = await page.locator('.message:not(.user)').evaluateAll(els => els.map(el => el.getBoundingClientRect().left)); expect(new Set(left).size).toBe(1);
  await page.getByRole('button', { name: '參與者', exact: true }).click(); await expect(page.locator('.participant-list li')).toHaveCount(5); await expect(page.locator('.participant-list')).toContainText('第三 AI');
  await capture(page, 'four-ai-fixture'); await closePanel(page); await page.locator('.messages').evaluate(el => { el.scrollTop = 0; }); await capture(page, 'four-ai-conversation');
  await settings(page); await page.getByRole('button', { name: '查看來源' }).click(); await page.locator('.evidence > summary').click();
  await expect(page.locator('.evidence')).toContainText('SHA256 ' + 'a'.repeat(64)); await expect(page.locator('.evidence')).toContainText('Synthetic source evidence'); await capture(page, 'sources-fixture'); await closePanel(page);
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: '參與者', exact: true }).click();
  await expect(page.locator('.participant-list li')).toHaveCount(5); await capture(page, 'four-ai-mobile'); await closePanel(page);
  expect((await bounds(page)).overflow).toBe(false);
  expect(await (await page.request.get('/api/discussions/' + id)).json()).toEqual(before);
});
