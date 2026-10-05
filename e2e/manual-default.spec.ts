import { test, expect, settings, choose, choice } from './fixtures';

test('new discussions default to manual free conversation and pause after one round', async ({ page, request }) => {
  expect(await (await request.get('/health')).json()).toMatchObject({ application: 'candc', testFixture: true });
  await page.goto('/');
  await expect(choice(page, '進行方式')).toHaveValue('manual');
  await expect(choice(page, '發言方式')).toHaveValue('free');
  await choose(page, '回覆來源', 'fake');
  await page.getByLabel('討論題目').fill('Manual default regression');
  const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/discussions') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '建立並開始討論 →' }).click();
  const response = await createdResponse;
  expect(response.request().postDataJSON().input).toMatchObject({ behaviorVersion: 3, mode: 'manual', flow: 'free', backend: 'fake' });
  const { id } = await response.json();
  await expect.poll(async () => (await (await page.request.get(`/api/discussions/${id}`)).json()).status).toBe('paused');
  const state = await (await page.request.get(`/api/discussions/${id}`)).json();
  expect(state.pauseReason).toBe('本輪或執行上限已達，請明確續談。');
  expect(state.messages.filter((message: { purpose?: string; sender: string }) => message.purpose === 'discussion' && message.sender !== 'user')).toHaveLength(2);
  expect(state.room.contributions).toBe(2);
  await page.reload(); await settings(page); await expect(page.getByLabel('進行方式', { exact: true })).toHaveValue('manual');
});
