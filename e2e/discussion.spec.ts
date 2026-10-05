import { test, expect, settings, closePanel, createLegacy, choose } from './fixtures';
test.beforeEach(async ({ request }) => {
  const health = await request.get('/health');
  expect(await health.json()).toMatchObject({ application: 'candc', testFixture: true });
});
test('debate side selection preserves optional persona and requires confirmation before inference', async ({ page }) => {
  await createLegacy(page, { input: { kind: 'debate', topic: 'Prefer reliability over initial cost.' } });
  await expect(page.locator('.message')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '開始討論', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '參與者', exact: true }).click();
  await expect(page.getByLabel('Codex 立場方向')).toHaveValue('support');
  await page.getByLabel('Codex 立場方向').selectOption('oppose');
  await expect(page.getByLabel('Claude 立場方向')).toHaveValue('support');
  await page.getByLabel('Codex 立場', { exact: true }).fill('Evidence-focused engineer.');
  await expect(page.getByRole('button', { name: '開始討論', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '確認雙方立場' }).click();
  await page.reload(); await page.getByRole('button', { name: '參與者', exact: true }).click();
  await expect(page.getByLabel('Codex 立場方向')).toHaveValue('oppose');
  await expect(page.getByLabel('Codex 立場', { exact: true })).toHaveValue('Evidence-focused engineer.');
  await page.getByText('雙方立場 · 已確認').click();
  await page.getByLabel('Codex 立場', { exact: true }).fill('Verify every assumption.');
  await expect(page.getByRole('button', { name: '開始討論', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '確認雙方立場' }).click();
  await expect(page.getByRole('button', { name: '開始討論', exact: true })).toBeEnabled();
});
test('IM history preserves full long answers, follows output and exposes a persistent completion notice', async ({ page }) => {
  test.setTimeout(60_000);
  // This case retains the legacy conclusion and resume contract; focused behavior has its own browser suite.
  await createLegacy(page, { input: { behaviorVersion: 1, topic: 'Long reading fixture.', mode: 'conclusion' } });
  await expect(page.locator('.discussion-notice')).toContainText('雙方已確認結論 · 討論已完成', { timeout: 45_000 });
  for (const message of await page.locator('.message:not(.user) .markdown').all()) {
    await expect(message).toContainText('Paragraph 1:');
    await expect(message).toContainText('Paragraph 28:');
    await expect(message).toContainText('END-');
  }
  expect(await page.locator('.messages').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2);
  await page.getByLabel('對話內容').press('Home');
  // Keyboard scrolling is animated; start the next round only once the reader is actually at the top.
  await expect.poll(() => page.locator('.messages').evaluate(el => el.scrollTop)).toBe(0);
  await page.getByRole('button', { name: '繼續交流' }).click();
  await expect(page.getByRole('button', { name: '有新內容 · 回到最新訊息 ↓' })).toBeVisible();
  expect(await page.locator('.messages').evaluate(el => el.scrollTop)).toBe(0);
  await page.getByRole('button', { name: '有新內容 · 回到最新訊息 ↓' }).click();
  expect(await page.locator('.messages').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2);
  await page.getByRole('button', { name: '立即停止' }).click();
  await expect(page.locator('.discussion-notice')).toContainText('討論已停止');
});
test('conclusion mode stops after peer confirmation', async ({ page }) => {
  await createLegacy(page, { input: { topic: 'Conclusion fixture.', mode: 'conclusion' } });
  await expect(page.locator('.discussion-notice')).toContainText('整場結果已由雙方明確確認');
  // Independent proposals, peer confirmation, overall proposal, then overall peer confirmation.
  await expect(page.locator('.message-meta strong')).toHaveCount(6);
  await expect(page.locator('.message:not(.user)').last()).toContainText('Main judgment: confirm-overall.');
  await expect(page.getByLabel('對話內容')).not.toContainText('[[CANDC:');
  await page.reload(); await settings(page); await expect(page.getByLabel('進行方式')).toHaveValue('conclusion');
});
test('free conversation permits consecutive speakers and pauses when both wait', async ({ page }) => {
  await createLegacy(page, { input: { topic: 'Autonomous conversation fixture.', mode: 'auto' } });
  await expect(page.getByText('雙方目前沒有新的補充。你可以加入問題或按「繼續交流」。')).toBeVisible();
  const speakers = await page.locator('.message-meta strong').allTextContents();
  expect(speakers).toEqual(['你', 'Codex', 'Claude', 'Codex', 'Codex', 'Claude', 'Claude']);
  await expect(page.getByLabel('對話內容')).not.toContainText('[[CANDC:');
  await page.reload(); await settings(page); await expect(page.getByLabel('發言方式')).toHaveValue('free');
  await expect(page.getByRole('button', { name: '繼續交流' })).toBeVisible();
});
test('manual discussion, interventions, summary, export, reload and mobile layout', async ({ page }) => {
  const failures: string[] = []; page.on('pageerror', e => failures.push(e.message));
  await createLegacy(page, { input: { topic: 'Compare reliability and cost.', flow: 'alternating', mode: 'manual' } });
  await expect(page.getByRole('button', { name: '開始下一輪' })).toBeVisible();
  await expect(page.locator('.message.codex')).toHaveCount(1);
  await expect(page.locator('.message.claude')).toHaveCount(1);
  await page.getByLabel('加入討論').fill('Focus on recovery time.');
  await choose(page, '傳給', 'codex');
  await page.getByRole('button', { name: '送出並續談 ↑' }).click();
  await expect(page.locator('.message.user').last()).toContainText('傳給 codex');
  await expect(page.locator('.message.codex')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '開始下一輪' })).toBeVisible();
  await settings(page); await page.getByRole('button', { name: '整理結論' }).click();
  await expect(page.getByText('雙方已完成結論整理，請查看核對與分歧。')).toBeVisible();
  await expect(page.locator('.message-meta').filter({ hasText: '結論整理' })).toHaveCount(2);
  await page.getByText('匯出 ↓').click();
  const download = page.waitForEvent('download'); await page.getByRole('link', { name: 'JSON', exact: true }).click(); expect((await download).suggestedFilename()).toMatch(/\.json$/);
  await page.reload(); await expect(page.locator('.message.codex')).toHaveCount(3);
  if (process.env.CANDC_SCREENSHOT_DIR) await page.screenshot({ path: process.env.CANDC_SCREENSHOT_DIR + '/desktop-discussion.png', fullPage: true });
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByLabel('加入討論')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CANDC_SCREENSHOT_DIR) await page.screenshot({ path: process.env.CANDC_SCREENSHOT_DIR + '/mobile-discussion.png', fullPage: true });
  expect(failures).toEqual([]);
});
test('debate positions, auto stop, fresh sessions and editable limits', async ({page}) => {
  await createLegacy(page, { input: { kind: 'debate', topic: 'Choose stability or rapid iteration.' } });
  await page.getByRole('button', { name: '參與者', exact: true }).click(); await expect(page.getByLabel('Codex 立場方向')).toHaveValue('support');
  await expect(page.getByLabel('Claude 立場方向')).toHaveValue('oppose');
  await page.getByRole('button',{name:'確認雙方立場'}).click();
  await expect(page.getByRole('button',{name:'開始討論',exact:true})).toBeEnabled();
  await closePanel(page); await settings(page); await page.getByLabel('進行方式',{exact:true}).selectOption('auto'); await closePanel(page);
  await page.getByRole('button',{name:'開始討論',exact:true}).click();
  await expect(page.getByRole('button',{name:'立即停止'})).toBeVisible();
  await page.getByRole('button',{name:'立即停止'}).click();
  await expect(page.getByRole('button',{name:'重建工作階段並續談'})).toBeVisible();
  await page.getByRole('button',{name:'重建工作階段並續談'}).click();
  await expect(page.getByRole('button',{name:'繼續交流',exact:true})).toBeVisible();
  await settings(page);
  await page.getByLabel('調整最多輪次').fill('60');
  await page.getByRole('button',{name:'更新上限'}).click();
  await page.reload();
  await settings(page);
  await expect(page.getByLabel('調整最多輪次')).toHaveValue('60');
});

test('formatted answers and opinions remain readable, and sending resumes paused discussion', async ({ page }) => {
  await createLegacy(page, { input: { topic: 'Markdown rendering fixture.', mode: 'manual' } });
  await expect(page.locator('.status')).toContainText('已暫停');
  await expect(page.locator('.markdown table')).toHaveCount(2);
  await expect(page.locator('.markdown del')).toHaveCount(2);
  await page.getByLabel('加入討論').fill('C:\\temp\\log\n*Please keep both lines*');
  await expect(page.getByLabel('加入討論')).toHaveValue('C:\\temp\\log\n*Please keep both lines*');
  await page.getByRole('button', { name: '送出並續談 ↑' }).click();
  await expect(page.locator('.message:not(.user)')).toHaveCount(4);
  await expect(page.locator('.message.user').last()).toContainText('*Please keep both lines*');
  await expect(page.locator('.message.user').last().locator('em')).toHaveCount(0);
  await expect(page.locator('.message:not(.user)').last()).toContainText('Received opinion:');
  await expect(page.getByLabel('加入討論')).toHaveValue('');
});
