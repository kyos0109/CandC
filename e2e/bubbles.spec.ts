import { test, expect, choose, reading, closePanel, contrast } from './fixtures';
import type { Locator, Page } from '@playwright/test';

// One speaker reply is made long after the room is saved, so the stream shows how a reply that would fill the pane is handled.
const paragraph = (n: number) => `第 ${n} 段：` + '這是用來確認長訊息會折疊的內容，完整文字仍然保存。'.repeat(3) + (n === 12 ? ' [說明連結](https://example.com/folded)' : '');
const LONG = Array.from({ length: 14 }, (_, i) => paragraph(i + 1)).join('\n\n');

async function createRoom(page: Page, template: string, topic: string) {
  await page.goto('/'); await choose(page, '回覆來源', 'fake');
  await page.getByRole('button', { name: template }).click();
  if (template === '同一個 AI 多觀點') await page.getByRole('group', { name: '選擇要重複使用的 AI' }).getByRole('button', { name: 'Codex' }).click();
  await page.getByRole('textbox', { name: '討論題目', exact: true }).fill(topic);
  await page.getByRole('button', { name: '建立並開始討論 →' }).click();
  await expect(page.locator('.discussion-notice').first()).toContainText('已暫停', { timeout: 15000 });
  return page.evaluate(async (topic: string) => (await (await fetch('/api/discussions')).json()).find((s: any) => s.topic === topic), topic);
}
// Shows the saved room with its first Codex reply replaced by the long text.
async function show(page: Page, state: any) {
  const first = state.messages.find((m: any) => m.sender === 'codex' && m.purpose === 'discussion');
  const shown = { ...state, messages: state.messages.map((m: any) => m === first ? { ...m, text: LONG } : m) };
  await page.route('**/api/discussions', route => route.fulfill({ json: [shown] }));
  await page.reload();
  await expect(page.locator('.message.prov-codex').first()).toBeVisible();
}
const paint = (message: Locator) => message.evaluate(el => ({ seat: getComputedStyle(el).getPropertyValue('--seat').trim(), band: getComputedStyle(el.querySelector('.message-meta')!).backgroundColor, avatar: getComputedStyle(el.querySelector('.seat-avatar')!).color }));

test('a long reply starts folded, unfolds on demand and keeps its full text', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await show(page, await createRoom(page, '同一個 AI 多觀點', 'Long reply fold fixture.'));
  const message = page.locator('.message.prov-codex').first(), clip = message.locator('.clip');
  await expect(clip).toHaveClass(/folded/);
  expect((await clip.boundingBox())!.height).toBeLessThanOrEqual(381);
  await expect(page.locator('.clip.folded')).toHaveCount(1);
  await expect(clip).toContainText('第 14 段');
  const expand = message.getByRole('button', { name: /^展開全文 · 約 \d+ 字$/ });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expand.click();
  await expect(clip).not.toHaveClass(/folded/);
  expect((await clip.boundingBox())!.height).toBeGreaterThan(400);
  await message.getByRole('button', { name: '收合', exact: true }).click();
  await expect(clip).toHaveClass(/folded/);
  await expect.poll(() => message.evaluate(el => el.getBoundingClientRect().top - document.querySelector('.messages')!.getBoundingClientRect().top)).toBeGreaterThanOrEqual(-1);
  // Focus moving into folded text unfolds it instead of scrolling hidden content.
  await message.getByRole('link', { name: '說明連結' }).focus();
  await expect(clip).not.toHaveClass(/folded/);
});

for (const theme of ['light', 'dark']) test(`${theme}: seats have their own colours, the header stays pinned and bubble text meets contrast`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(theme => { localStorage.setItem('candc-theme', theme); }, theme);
  await show(page, await createRoom(page, '同一個 AI 多觀點', `Seat colour fixture ${theme}.`));
  const first = page.locator('.message.prov-codex').first(), second = page.locator('.message.seat-alt').first();
  const [a, b] = [await paint(first), await paint(second)];
  expect(a.seat).not.toBe(''); expect(b.seat).not.toBe(a.seat); expect(b.band).not.toBe(a.band); expect(b.avatar).not.toBe(a.avatar);
  await first.getByRole('button', { name: /^展開全文/ }).click();
  const pinned = await first.evaluate(async el => {
    const box = document.querySelector('.messages')!; box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top + 330;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const top = box.getBoundingClientRect().top;
    return { meta: el.querySelector('.message-meta')!.getBoundingClientRect().top - top, avatar: el.querySelector('.seat-avatar')!.getBoundingClientRect().top - top };
  });
  expect(Math.abs(pinned.meta)).toBeLessThanOrEqual(1); expect(Math.abs(pinned.avatar - 8)).toBeLessThanOrEqual(1);
  for (const message of [first, second]) for (const part of ['.message-meta strong', '.message-meta time', '.actions button', '.markdown p']) {
    expect((await contrast(message.locator(part).first())).ratio, `${theme} ${part}`).toBeGreaterThanOrEqual(4.5);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.messages').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('every provider and the moderator get a different bubble colour, and the moderator a different shape', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await show(page, await createRoom(page, '四方＋主持', 'Moderator bubble fixture.'));
  const seats = await Promise.all(['.prov-codex', '.prov-claude', '.prov-gemini', '.prov-grok', '.speaker-moderator'].map(async selector => (await paint(page.locator(`.message${selector}`).first())).seat));
  expect(new Set(seats).size).toBe(5);
  const radius = (selector: string) => page.locator(`.message${selector} .message-meta`).first().evaluate(el => getComputedStyle(el).borderTopLeftRadius);
  expect(await radius('.speaker-moderator')).not.toBe(await radius('.prov-codex'));
  expect((await page.locator('.message.speaker-moderator .message-main').first().boundingBox())!.width).toBeLessThanOrEqual(561);
});

test('compact density is a reading setting that persists and tightens the stream', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await createRoom(page, '三方會審', 'Density fixture.');
  const gap = () => page.locator('.message').first().evaluate(el => parseFloat(getComputedStyle(el).marginBottom));
  const comfortable = await gap();
  await reading(page); await page.getByLabel('對話密度').selectOption('compact'); await closePanel(page);
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  expect(await gap()).toBeLessThan(comfortable);
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await reading(page); await page.getByLabel('對話密度').selectOption('comfortable'); await closePanel(page);
  await expect(page.locator('html')).toHaveAttribute('data-density', 'comfortable'); expect(await gap()).toBe(comfortable);
});
