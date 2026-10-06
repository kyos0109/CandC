import { test, expect, choose } from './fixtures';
import type { Page } from '@playwright/test';

async function language(page: Page, value: 'en' | 'zh-TW') {
  const select = page.getByRole('combobox', { name: 'Language / 語言' });
  if (!await select.isVisible()) await page.getByRole('button', { name: /^(閱讀設定|Reading settings)$/ }).click();
  await select.selectOption(value);
  await expect(page.locator('html')).toHaveAttribute('lang', value);
  await page.locator('.inspector > header button').click();
}

test('English persists and switching preserves drafts, recipients, content and settings', async ({ page }) => {
  await page.goto('/');
  const topic = '原始題目 / original topic';
  await page.getByRole('textbox', { name: '討論題目', exact: true }).fill(topic);
  await language(page, 'en');
  await expect(page.getByRole('heading', { name: 'New discussion', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Discussion topic', exact: true })).toHaveValue(topic);
  await expect(page.getByRole('button', { name: 'Three-way review' })).toBeVisible();
  await choose(page, 'Response source', 'fake');
  await page.getByRole('button', { name: 'Create and start discussion →' }).click();
  await expect(page.locator('.discussion-notice').first()).toContainText('Paused', { timeout: 15000 });
  await choose(page, 'Send to', 'claude');
  const draft = '未送出的草稿 / unsent draft {0}';
  await page.getByRole('textbox', { name: 'Join the discussion' }).fill(draft);
  await language(page, 'zh-TW');
  await expect(page.getByRole('textbox', { name: '加入討論' })).toHaveValue(draft);
  await expect(page.locator('input[name="room-recipient"]:checked')).toHaveValue('claude');
  await language(page, 'en');
  await expect(page.locator('.privacy-note')).toContainText('Private to Claude');
  await expect(page.getByRole('textbox', { name: 'Join the discussion' })).toHaveValue(draft);
  await page.getByRole('button', { name: 'Send and continue ↑' }).click();
  await expect(page.locator('.message.user').filter({ hasText: draft })).toHaveCount(1);
  await expect(page.locator('.discussion-notice').first()).toContainText('Paused');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.discussion-heading h1')).toHaveText(topic);
  await page.getByRole('tab', { name: 'Conclusion', exact: true }).click();
  await expect(page.getByText('Conclusion delivery is incomplete. Saved analysis is shown below.')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const state = await page.evaluate(async () => {
    const id = localStorage.getItem('candc-discussion');
    return (await fetch(`/api/discussions/${id}`)).json();
  });
  expect(state.topic).toBe(topic);
  expect(state.messages.some((message: { text: string }) => message.text === draft)).toBe(true);
});

test('English creation and connection hints are readable', async ({ page }) => {
  await page.goto('/'); await language(page, 'en');
  await expect(page.getByText('Enter a discussion topic.')).toBeVisible();
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connections and settings' })).toBeVisible();
  await expect(page.getByText(/Local only/)).toBeVisible();
});
