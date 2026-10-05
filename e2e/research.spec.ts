import { test, expect, pick } from './fixtures';

test('research requires explicit opt-in and submits no roots when disabled', async ({ page, request }) => {
  expect(await (await request.get('/health')).json()).toMatchObject({ application: 'candc', testFixture: true });
  // Intercept creation so testing the live form never starts a provider turn.
  await page.route('**/api/environment', route => route.fulfill({ json: { ready: true, codex: { ready: true }, claude: { ready: true } } }));
  await page.route('**/api/models', route => route.fulfill({ json: { codex: [{ id: 'fixture', label: 'Fixture', efforts: ['medium'] }], claude: ['fixture'], error: null } }));
  const submissions: Array<{ input: { research: boolean; roots: string[] } }> = [];
  await page.route('**/api/discussions', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    submissions.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, json: { message: 'Fixture intercepted creation' } });
  });
  await page.goto('/');
  const research = page.getByRole('checkbox', { name: '網路研究' });
  await expect(research).not.toBeChecked();
  await expect(page.getByLabel('可讀取的本機目錄')).toHaveCount(0);
  await page.getByLabel('討論題目').fill('Research opt-in fixture');
  await pick(page, '座位 1 模型', /Fixture/);
  await pick(page, '座位 2 模型', /Fixture/);
  const submit = page.getByRole('button', { name: '建立並開始討論 →' });
  await submit.click();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0]?.input).toMatchObject({ research: false, roots: [] });
  await research.check();
  await page.getByLabel('可讀取的本機目錄').fill('C:\\fixture\\notes');
  await submit.click();
  await expect.poll(() => submissions.length).toBe(2);
  expect(submissions[1]?.input).toMatchObject({ research: true, roots: ['C:\\fixture\\notes'] });
  await research.uncheck();
  await submit.click();
  await expect.poll(() => submissions.length).toBe(3);
  expect(submissions[2]?.input).toMatchObject({ research: false, roots: [] });
});
