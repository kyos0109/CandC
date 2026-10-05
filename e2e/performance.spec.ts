import { test, expect, choose, closePanel, createLegacy } from './fixtures';

test('performance panel polls only while open and exports fake-isolated baselines without model calls', async ({ page }) => {
  let reads = 0;
  page.on('request', r => { if (r.url().endsWith('/performance')) reads++; });
  const id = await createLegacy(page, { input: { topic: 'Performance fixture.' } });
  const state = async () => (await page.request.get(`/api/discussions/${id}`)).json();
  await expect.poll(async () => (await state()).activity).toBeNull();
  const before = await state();
  expect(reads).toBe(0);
  await page.getByRole('button', { name: '更多討論操作', exact: true }).click();
  await page.getByRole('button', { name: '輸入與呼叫診斷', exact: true }).click();
  const panel = page.getByRole('region', { name: 'AI 呼叫效能量測' });
  await expect(panel).toContainText('開始操作 1 次、回合 2 次');
  await expect(panel).toContainText('基準預設只統計 live');
  await panel.locator(':scope > details').nth(1).locator(':scope > summary').click();
  await expect(panel).toContainText('用量未知');
  await expect(panel).toContainText('未知');
  const first = reads;
  await expect.poll(() => reads, { timeout: 7000 }).toBeGreaterThan(first);
  const exportJson = page.waitForEvent('download');
  await panel.getByRole('link', { name: '下載 JSON 基準報表' }).click();
  expect((await exportJson).suggestedFilename()).toBe('candc-performance.json');
  const exportMarkdown = page.waitForEvent('download');
  await panel.getByRole('link', { name: '下載 Markdown 基準報表' }).click();
  expect((await exportMarkdown).suggestedFilename()).toBe('candc-performance.md');
  const report = await page.request.get('/api/performance/report?format=json'); expect((await report.json()).samples).toBe(0);
  await closePanel(page); const closedReads = reads;
  await page.waitForTimeout(5500); expect(reads).toBe(closedReads);
  expect(await state()).toEqual(before);
});

test('incomplete performance measurements display unknown end without implying public storage', async ({ page }) => {
  await createLegacy(page, { input: { topic: 'Incomplete performance fixture.' } });
  await expect(page.locator('.status')).toContainText('已暫停');
  await page.route('**/api/discussions/*/performance', async route => {
    const response = await route.fetch(), view = await response.json();
    const turn = view.records.find((r: { kind: string }) => r.kind === 'turn');
    turn.incomplete = true; turn.boundary = 'begin'; turn.outcome = null; turn.durations.total = null; turn.answerSaved = null; turn.diagnosticsSaved = null; delete turn.offsets.ended;
    await route.fulfill({ json: view });
  });
  await page.getByRole('button', { name: '更多討論操作', exact: true }).click();
  await page.getByRole('button', { name: '輸入與呼叫診斷', exact: true }).click();
  const panel = page.getByRole('region', { name: 'AI 呼叫效能量測' });
  await expect(panel).toContainText('不完整（未觀測結束）');
  await panel.getByText(/不完整（未觀測結束）/).click();
  await expect(panel).toContainText('公開回答正式提交：未確認');
  await expect(panel).toContainText('模型完成不代表正式保存');
});

// Room diagnostics distinguish the execution from individual seat calls and stop reads when hidden.
test('room diagnostics load measurements only while the diagnostics tab is open', async ({ page }) => {
  let reads = 0;
  page.on('request', r => { if (r.url().endsWith('/performance')) reads++; });
  await page.goto('/'); await choose(page, '回覆來源', 'fake'); await page.getByLabel('討論題目').fill('Room performance fixture.');
  await page.getByRole('button', { name: '建立並開始討論 →' }).click();
  await expect(page.locator('.status')).toContainText('已暫停');
  expect(reads).toBe(0);
  await page.getByRole('tab', { name: '診斷' }).click();
  const panel = page.getByRole('region', { name: 'AI 呼叫效能量測' });
  await expect(panel).toContainText('開始操作 1 次、回合 2 次');
  await panel.locator(':scope > details').nth(1).locator(':scope > summary').click();
  await expect(panel).toContainText('一般發言 · 座位 codex');
  await expect(panel).toContainText('CLI 未知');
  const first = reads;
  await expect.poll(() => reads, { timeout: 7000 }).toBeGreaterThan(first);
  await page.getByRole('tab', { name: '對話' }).click(); const closedReads = reads;
  await page.waitForTimeout(5500); expect(reads).toBe(closedReads);
});
