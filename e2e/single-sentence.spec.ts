import { test, expect, choose, settings, closePanel } from './fixtures';

test('single-sentence mode is fixed at creation, survives reload and covers conclusions in both locales', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await choose(page, '回覆來源', 'fake');
  await expect(page.getByRole('radio', { name: '一般模式', exact: true })).toBeChecked();
  await choose(page, '回覆模式', 'single-sentence');
  await expect(page.getByText('每個 AI 每次只用一句簡短的話回應，結論也適用')).toBeVisible();
  await choose(page, '討論方式', 'selection'); await expect(page.getByRole('radiogroup', { name: '回覆模式' })).toHaveCount(0);
  await choose(page, '討論方式', 'discussion'); await expect(page.getByRole('radio', { name: '一句模式', exact: true })).toBeChecked();
  await choose(page, '進行方式', 'conclusion');
  await page.getByRole('textbox', { name: '討論題目', exact: true }).fill('Single-sentence fixture.');
  await page.getByRole('switch', { name: '啟用獨立主持人' }).check();
  await page.getByRole('button', { name: '建立並開始討論 →' }).click();
  await expect(page.locator('.discussion-heading')).toContainText('一句模式');
  const id = await page.evaluate(() => localStorage.getItem('candc-discussion'));
  const state = async () => (await (await page.request.get(`/api/discussions/${id}`)).json());
  await expect.poll(async () => !!(await state()).room.outcome, { timeout: 15000 }).toBe(true);
  await expect.poll(async () => (await state()).activity).toBeNull();
  const saved = await state(); expect(saved.singleSentence).toBe(true); expect(saved.room.proposal.confirmed).toHaveLength(2);
  expect(saved.room.calls.every((call: any) => call.status === 'completed' && !call.sentenceRewrite)).toBe(true);
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  for (const message of saved.messages.filter((message: any) => message.sender !== 'user' && message.purpose !== 'notice')) {
    expect([...segmenter.segment(message.text)]).toHaveLength(1); expect(message.text).not.toContain('\n');
  }
  await settings(page); await expect(page.getByRole('radiogroup', { name: '回覆模式' })).toHaveCount(0); await closePanel(page);
  const change = await page.request.patch(`/api/discussions/${id}`, { data: { expectedVersion: saved.room.configurationVersion, singleSentence: false } });
  expect(change.status()).toBe(400); expect((await state()).singleSentence).toBe(true);
  await page.reload(); await expect(page.locator('.discussion-heading')).toContainText('一句模式');
  await page.getByRole('tab', { name: /^結論/ }).click(); await expect(page.getByText(saved.room.outcome.result).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('sentence-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('sentence-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.evaluate(() => localStorage.setItem('candc-locale', 'en')); await page.reload();
  await expect(page.locator('.discussion-heading')).toContainText('Single-sentence mode'); expect(errors).toEqual([]);
});
