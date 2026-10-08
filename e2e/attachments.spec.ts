import { test, expect, choose } from './fixtures';
import path from 'node:path';

test('attachment creation, extraction, download and mobile history are usable in both languages', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text()); });
  await page.goto('/'); await expect(page).toHaveTitle(/CandC/i);
  await expect(page.getByRole('heading', { name: '新討論' })).toBeVisible(); await choose(page, '回覆來源', 'fake');
  await page.getByRole('textbox', { name: '討論題目', exact: true }).fill('Attachment browser fixture');
  const file = { name: '背景.txt', mimeType: 'text/plain', buffer: Buffer.from('ATTACHMENT_BROWSER_42 <script>not executable</script>') };
  await page.locator('input[type=file]').setInputFiles([file, { name: 'remove.txt', mimeType: 'text/plain', buffer: Buffer.from('remove me') }]);
  await page.getByRole('button', { name: '移除附件 remove.txt' }).click(); await expect(page.locator('.attachment-picker li')).toHaveCount(1);
  await page.getByRole('button', { name: '建立並開始討論 →' }).click();
  await expect(page.locator('.discussion-notice').first()).toContainText('已暫停', { timeout: 15000 });
  await expect(page.locator('.message:not(.user)').first()).toContainText('ATTACHMENT_BROWSER_42');
  await page.getByRole('button', { name: '提供給 AI 的文字', exact: true }).click();
  await expect(page.locator('.attachment-text')).toHaveText(file.buffer.toString());
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('link', { name: '下載原檔' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(file.name);
  if (process.env.CANDC_ATTACHMENT_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CANDC_ATTACHMENT_SCREENSHOT_DIR, 'attachments-desktop.png') });
  await page.reload(); await expect(page.locator('.attachment-card')).toHaveCount(1);
  const locale = page.getByRole('combobox', { name: 'Language / 語言' });
  if (!await locale.isVisible()) await page.getByRole('button', { name: '閱讀設定', exact: true }).click();
  await locale.selectOption('en');
  await page.locator('.inspector > header button').click();
  await expect(page.getByRole('button', { name: 'Text supplied to AI' })).toBeVisible();
  await page.getByRole('button', { name: 'Text supplied to AI' }).click(); await expect(page.locator('.attachment-text')).toHaveText(file.buffer.toString());
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.attachment-card')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0); expect(errors).toEqual([]);
  if (process.env.CANDC_ATTACHMENT_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CANDC_ATTACHMENT_SCREENSHOT_DIR, 'attachments-mobile.png') });
});

test('keeps failed drafts, supports drop and attachment-only private messages, and deduplicates a lost reply', async ({ page }) => {
  await page.goto('/'); await choose(page, '回覆來源', 'fake');
  await page.getByRole('textbox', { name: '討論題目', exact: true }).fill('Attachment browser fixture retry');
  await page.getByRole('button', { name: '建立並開始討論 →' }).click();
  await expect(page.locator('.discussion-notice').first()).toContainText('已暫停', { timeout: 15000 });
  await page.getByRole('textbox', { name: '加入討論' }).fill('Keep this draft');
  await page.locator('input[type=file]').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await page.getByRole('button', { name: '送出並續談 ↑' }).click();
  await expect(page.getByText(/broken.pdf:.*附件損壞/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: '加入討論' })).toHaveValue('Keep this draft');
  await expect(page.locator('.attachment-picker li')).toContainText('broken.pdf');
  await page.getByRole('button', { name: '移除附件 broken.pdf' }).click();
  await page.getByRole('textbox', { name: '加入討論' }).fill(''); await choose(page, '傳給', 'claude');
  await page.locator('.attachment-picker').evaluate(el => {
    const dataTransfer = new DataTransfer(); dataTransfer.items.add(new File(['PRIVATE_UPLOAD_73'], 'private.txt', { type: 'text/plain' }));
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
  });
  await expect(page.locator('.attachment-picker li')).toContainText('private.txt');
  await page.getByRole('button', { name: '管理 Attachment browser fixture retry', exact: true }).click();
  let draftConfirmation = false;
  page.once('dialog', async dialog => { draftConfirmation = true; await dialog.dismiss(); });
  await page.getByRole('button', { name: '封存', exact: true }).click();
  expect(draftConfirmation).toBe(true);
  await expect(page.locator('.attachment-picker li')).toContainText('private.txt');
  let lost = false;
  await page.route('**/api/discussions/*/messages', async route => {
    if (!lost) { lost = true; await route.fetch(); await route.abort('failed'); } else await route.continue();
  });
  await page.getByRole('button', { name: '送出並續談 ↑' }).click();
  await expect(page.getByRole('button', { name: '送出並續談 ↑' })).toBeEnabled();
  await expect(page.locator('.attachment-picker li')).toContainText('private.txt');
  await page.getByRole('button', { name: '送出並續談 ↑' }).click();
  await expect(page.locator('.attachment-picker li')).toHaveCount(0);
  await expect(page.locator('.attachment-card')).toHaveCount(1);
  await expect(page.locator('.message.user').filter({ hasText: 'private.txt' })).toContainText('私訊給');
  const messages = await page.evaluate(async () => {
    const states = await (await fetch('/api/discussions')).json();
    return states.find((s: { topic: string }) => s.topic === 'Attachment browser fixture retry').messages;
  });
  expect(messages.filter((m: { attachments?: unknown[] }) => m.attachments?.length)).toHaveLength(1);
});
