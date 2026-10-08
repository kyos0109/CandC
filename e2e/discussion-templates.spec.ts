import { test, expect, choose, choice, pick, contrast, settled } from './fixtures';
import type { Page } from '@playwright/test';
import path from 'node:path';

const scenarios = [
  ['Decision Lab', 'conclusion'], ['Engineering Review', 'conclusion'], ['Research Council', 'conclusion'],
  ['Incident War Room', 'manual'], ['Code Review Board', 'conclusion'], ['Simulation Arena', 'manual'],
] as const;
const card = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) });
async function language(page: Page, value: 'en' | 'zh-TW') {
  await page.getByRole('button', { name: /^(閱讀設定|Reading settings)$/ }).click();
  await page.getByRole('combobox', { name: 'Language / 語言' }).selectOption(value);
  await page.locator('.inspector > header button').click();
  await expect(page.locator('html')).toHaveAttribute('lang', value);
}

for (const [name, mode] of scenarios) test(`${name} prefills editable fields and submits through the existing room input`, async ({ page }) => {
  await page.goto('/'); await choose(page, '回覆來源', 'fake');
  await page.getByLabel('討論題目', { exact: true }).fill(`Scenario fixture: ${name}`);
  const writes: string[] = []; page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await card(page, name).click(); await expect(card(page, name)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('期望成果')).toBeVisible();
  const goal = await page.getByLabel('期望成果').inputValue(); expect(goal).not.toBe('');
  const labels = await page.locator('.seat-name').evaluateAll(elements => elements.map(el => (el as HTMLInputElement).value));
  const instructions = await page.locator('.seat-stance').evaluateAll(elements => elements.map(el => (el as HTMLInputElement).value));
  expect(labels.every(Boolean)).toBe(true); expect(instructions.every(Boolean)).toBe(true);
  await expect(choice(page, '進行方式')).toHaveValue(mode);
  expect(writes).toEqual([]);
  await page.getByLabel('座位 1 名稱').fill('My reviewer');
  const submitted = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/discussions');
  await page.getByRole('button', { name: '建立並開始討論 →' }).click();
  const { input, id } = (await submitted).postDataJSON();
  expect(input).toMatchObject({ topic: `Scenario fixture: ${name}`, goal, kind: 'discussion', mode, backend: 'fake', moderator: null, research: false });
  expect(input.participants.map((s: { label: string }) => s.label)).toEqual(['My reviewer', labels[1]]);
  expect(input.participants.map((s: { instructions: string }) => s.instructions)).toEqual(instructions);
  expect(input.templateId).toBeUndefined(); expect(input.templateOrigins).toBeUndefined();
  await expect(page.locator('.discussion-heading')).toContainText(`Scenario fixture: ${name}`);
  const saved = await (await page.request.get(`/api/discussions/${id}`)).json();
  expect(saved.goal).toBe(goal); expect(saved.participants[0].label).toBe('My reviewer'); expect(saved.templateId).toBeUndefined();
});

test('manual edits and intentional clearing survive switching, reapplying and connection navigation', async ({ page }) => {
  await page.goto('/'); await card(page, 'Decision Lab').click();
  await page.getByLabel('期望成果').fill(''); await page.getByLabel('座位 1 名稱').fill('Custom reviewer'); await page.getByLabel('座位 2 立場', { exact: true }).fill('');
  await choose(page, '討論方式', 'debate'); await choose(page, '進行方式', 'auto'); await choose(page, '進行方式', 'manual');
  await card(page, 'Engineering Review').click(); await card(page, 'Engineering Review').click();
  await expect(page.getByLabel('期望成果')).toHaveValue(''); await expect(page.getByLabel('座位 1 名稱')).toHaveValue('Custom reviewer');
  await expect(page.getByLabel('座位 2 名稱')).toHaveValue('SRE／維運'); await expect(page.getByLabel('座位 2 立場', { exact: true })).toHaveValue('');
  await expect(choice(page, '討論方式')).toHaveValue('debate'); await expect(choice(page, '進行方式')).toHaveValue('manual');
  await page.getByRole('button', { name: '查看連線與重新檢查' }).click();
  await expect(page.getByRole('heading', { name: '連線與設定', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回討論', exact: true }).click(); await card(page, 'Research Council').click();
  await expect(page.getByLabel('期望成果')).toHaveValue(''); await expect(page.getByLabel('座位 1 名稱')).toHaveValue('Custom reviewer');
  await expect(page.getByLabel('座位 2 立場', { exact: true })).toHaveValue(''); await expect(choice(page, '進行方式')).toHaveValue('manual');
});

test('explicitly selecting the already checked manual mode protects it from templates', async ({ page }) => {
  await page.goto('/'); await page.getByRole('radiogroup', { name: '進行方式', exact: true }).getByRole('radio', { name: '手動', exact: true }).click();
  await card(page, 'Decision Lab').click(); await expect(choice(page, '進行方式')).toHaveValue('manual');
});

test('effort changes preserve template role ownership and reset undo', async ({ page }) => {
  await page.route('**/api/environment', route => route.fulfill({ json: { ready: true, codex: { ready: true }, claude: { ready: true } } }));
  await page.route('**/api/models', route => route.fulfill({ json: { codex: [{ id: 'fixture-codex', label: 'Fixture Codex', efforts: ['low', 'high'] }], claude: ['sonnet'], error: null } }));
  await page.goto('/'); await pick(page, '座位 1 模型', /Fixture Codex/);
  const effort = page.getByRole('radiogroup', { name: '座位 1 思考程度', exact: true });
  await effort.getByRole('radio', { name: 'high' }).check(); await card(page, 'Decision Lab').click();
  await expect(page.getByLabel('座位 1 名稱')).toHaveValue('方案分析');
  await expect(page.getByLabel('座位 1 立場', { exact: true })).toHaveValue('比較可行選項、成立條件與主要取捨。');
  await expect(page.getByRole('region', { name: '目前情境設定' })).toContainText('範本欄位尚未手動修改。');
  await effort.getByRole('radio', { name: 'low' }).check(); await card(page, 'Research Council').click();
  await expect(page.getByLabel('座位 1 名稱')).toHaveValue('主張與證據整理');
  await expect(page.getByLabel('座位 1 立場', { exact: true })).toHaveValue('對照研究問題、各項主張與支持依據。');
  await page.getByLabel('座位 1 名稱').fill('My reviewer');
  await page.getByRole('button', { name: '重設為範本預設', exact: true }).click();
  await effort.getByRole('radio', { name: 'high' }).check();
  await page.getByRole('button', { name: '復原重設', exact: true }).click();
  await expect(page.getByLabel('座位 1 名稱')).toHaveValue('My reviewer');
  await expect(effort.getByRole('radio', { name: 'high' })).toBeChecked();
  await card(page, 'Decision Lab').click();
  await expect(page.getByLabel('座位 1 名稱')).toHaveValue('My reviewer');
  await expect(page.getByLabel('座位 1 立場', { exact: true })).toHaveValue('比較可行選項、成立條件與主要取捨。');
});

test('scenario application waits for pending seat removal before assigning roles', async ({ page }) => {
  await page.goto('/'); await card(page, 'Research Council').click();
  await page.getByRole('button', { name: '加一個座位', exact: true }).click();
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  try {
    await page.getByRole('button', { name: '移除座位 1', exact: true }).dispatchEvent('click');
    for (const [name] of scenarios) await expect(card(page, name)).toBeDisabled();
    await expect(page.getByRole('button', { name: '重設為範本預設', exact: true })).toBeDisabled();
    await card(page, 'Decision Lab').dispatchEvent('click');
    await expect(card(page, 'Research Council')).toHaveAttribute('aria-pressed', 'true');
    await page.clock.runFor(179); await expect(page.locator('.seat-row')).toHaveCount(3);
    await page.clock.runFor(1); await expect(page.locator('.seat-row')).toHaveCount(2);
  } finally { await page.clock.resume(); }
  await expect(card(page, 'Decision Lab')).toBeEnabled(); await card(page, 'Decision Lab').click();
  await expect(page.getByLabel('座位 1 名稱')).toHaveValue('方案分析');
  await expect(page.getByLabel('座位 2 名稱')).toHaveValue('假設與反例審查');
  await expect(page.getByLabel('座位 1 立場', { exact: true })).toHaveValue('比較可行選項、成立條件與主要取捨。');
});

test('seat additions, removals and presets never transfer edits to another UID', async ({ page }) => {
  await page.goto('/'); await card(page, 'Decision Lab').click();
  await page.getByLabel('座位 2 名稱').fill('Keep this seat'); await page.getByRole('button', { name: '加一個座位', exact: true }).click();
  await expect(page.getByLabel('座位 3 名稱')).toHaveValue(''); await card(page, 'Engineering Review').click();
  await expect(page.getByLabel('座位 2 名稱')).toHaveValue('Keep this seat'); await expect(page.getByLabel('座位 3 名稱')).toHaveValue('安全審查員');
  await page.getByRole('button', { name: '移除座位 1', exact: true }).click(); await expect(page.locator('.seat-row')).toHaveCount(2);
  await card(page, 'Engineering Review').click(); await expect(page.getByLabel('座位 1 名稱')).toHaveValue('Keep this seat');
  await expect(page.getByLabel('座位 2 名稱')).toHaveValue('SRE／維運');
  await page.getByRole('button', { name: '加一個座位', exact: true }).click(); await card(page, 'Engineering Review').click();
  await expect(page.getByLabel('座位 3 名稱')).toHaveValue('安全審查員');
  await page.getByRole('button', { name: '四方＋主持', exact: true }).click();
  await expect(page.locator('.seat-row')).toHaveCount(4); await expect(page.getByLabel('座位 1 名稱')).toHaveValue('');
  await card(page, 'Engineering Review').click(); await expect(page.getByLabel('座位 1 名稱')).toHaveValue('軟體／系統架構師');
  await expect(page.getByLabel('座位 4 名稱')).toHaveValue('效能／成本審查員');
});

test('locale changes translate controls but preserve inserted text and same-template snapshots', async ({ page }) => {
  await page.goto('/'); await card(page, 'Decision Lab').click(); const goal = await page.getByLabel('期望成果').inputValue();
  await language(page, 'en'); await expect(page.getByRole('heading', { name: 'Discussion scenario (optional)' })).toBeVisible();
  await expect(page.getByLabel('Desired outcome')).toHaveValue(goal); await expect(page.getByLabel('Seat 1 name')).toHaveValue('方案分析');
  await card(page, 'Decision Lab').click(); await expect(page.getByLabel('Desired outcome')).toHaveValue(goal);
  await card(page, 'Research Council').click(); await expect(page.getByLabel('Seat 1 name')).toHaveValue('Claims and Evidence');
  const englishGoal = await page.getByLabel('Desired outcome').inputValue(); expect(englishGoal).not.toMatch(/[\u3400-\u9fff]/);
  await language(page, 'zh-TW'); await card(page, 'Research Council').click(); await expect(page.getByLabel('期望成果')).toHaveValue(englishGoal);
  await expect(page.getByLabel('座位 1 名稱')).toHaveValue('Claims and Evidence');
  await choose(page, '討論方式', 'selection'); await language(page, 'en');
  await expect(page.locator('#scenario-help')).toHaveText('Set Discussion format to Collaborative analysis or Debate before applying a scenario template.');
  await expect(page.getByRole('radio', { name: 'Collaborative analysis', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Debate', exact: true })).toBeVisible();
});

test('templates preserve providers, models, effort, moderator authority, research, limits and attachments', async ({ page }) => {
  await page.route('**/api/environment', route => route.fulfill({ json: { ready: true, codex: { ready: true }, claude: { ready: true }, providers: { codex: { ready: true }, claude: { ready: true } } } }));
  await page.route('**/api/models', route => route.fulfill({ json: { codex: [{ id: 'fixture-codex', label: 'Fixture Codex', efforts: ['low', 'high'] }], claude: ['sonnet'], error: null } }));
  await page.goto('/'); await page.getByLabel('討論題目', { exact: true }).fill('Keep topic'); await page.locator('.supplement > summary').click();
  await page.getByLabel('限制', { exact: true }).fill('Keep constraints'); await page.getByLabel('顯示名稱', { exact: true }).fill('Keep display name');
  await pick(page, '座位 1 模型', /Fixture Codex/); await pick(page, '座位 2 模型', 'Sonnet');
  await page.getByRole('radiogroup', { name: '座位 1 思考程度', exact: true }).getByRole('radio', { name: 'high' }).check();
  await page.getByRole('switch', { name: '啟用獨立主持人' }).check(); await pick(page, '主持人 模型', /Fixture Codex/);
  await page.getByRole('checkbox', { name: '主持人裁判模式' }).check(); await page.getByRole('checkbox', { name: '網路研究', exact: true }).check();
  await page.getByLabel('可讀取的本機目錄').fill('C:/fixture/read-only'); await choose(page, '回覆模式', 'single-sentence');
  await page.locator('.limits > summary').click(); await page.getByLabel('最多輪次', { exact: true }).fill('17');
  await page.getByLabel('總時間（分鐘）', { exact: true }).fill('31'); await page.getByLabel('單次回覆（分鐘）', { exact: true }).fill('2');
  await page.getByLabel('主持人最多呼叫次數', { exact: true }).fill('23');
  await page.locator('input[type=file]').setInputFiles({ name: 'evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('Template evidence') });
  const fields = () => page.locator('.create-page input,.create-page textarea,.create-page [role=combobox]').evaluateAll(elements => elements.filter(element => {
    const field = element as HTMLInputElement;
    return field.name !== 'room-kind' && field.name !== 'room-mode' && field.getAttribute('aria-label') !== '期望成果' && !field.classList.contains('seat-name') && !field.classList.contains('seat-stance');
  }).map(element => { const field = element as HTMLInputElement; return { label: field.getAttribute('aria-label'), value: field.value ?? field.textContent, checked: field.checked }; }));
  const before = await fields(); for (const [name] of scenarios) {
    await card(page, name).click();
    if (name === 'Decision Lab') {
      await expect(page.getByLabel('座位 1 名稱')).toHaveValue('方案分析');
      await expect(page.getByLabel('座位 1 立場', { exact: true })).toHaveValue('比較可行選項、成立條件與主要取捨。');
    }
  }
  expect(await fields()).toEqual(before);
  await expect(page.locator('.attachment-picker li')).toContainText('evidence.txt');
  const goal = await page.getByLabel('期望成果').inputValue();
  const roles = await page.locator('.seat-name,.seat-stance').evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value));
  await choose(page, '討論方式', 'selection'); await expect(page.getByText('請先將討論形式改為共同分析或正反辯論，再套用情境範本。')).toBeVisible();
  await expect(page.getByLabel('期望成果')).toHaveValue(goal);
  expect(await page.locator('.seat-name,.seat-stance').evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value))).toEqual(roles);
  for (const [name] of scenarios) await expect(card(page, name)).toBeDisabled();
  await choose(page, '討論方式', 'discussion'); expect(await fields()).toEqual(before);
});

test('a customized template debate retains explicit sides and creates through the existing confirmation flow', async ({ page }) => {
  await page.goto('/'); await choose(page, '回覆來源', 'fake'); await card(page, 'Decision Lab').click(); await choose(page, '討論方式', 'debate');
  await page.getByLabel('討論題目', { exact: true }).fill('Template debate fixture.'); await choose(page, '進行方式', 'manual');
  await page.getByRole('radiogroup', { name: '座位 1 立場方向', exact: true }).getByRole('radio', { name: '支持' }).check();
  await page.getByRole('radiogroup', { name: '座位 2 立場方向', exact: true }).getByRole('radio', { name: '反對' }).check();
  await card(page, 'Code Review Board').click(); await expect(choice(page, '討論方式')).toHaveValue('debate');
  const submitted = page.waitForRequest(r => r.method() === 'POST' && new URL(r.url()).pathname === '/api/discussions');
  await page.getByRole('button', { name: '建立並開始辯論 →' }).click(); const { input, id } = (await submitted).postDataJSON();
  expect(input.kind).toBe('debate'); expect(input.mode).toBe('manual');
  expect(input.participants[0].instructions).toMatch(/^支持：/); expect(input.participants[1].instructions).toMatch(/^反對：/);
  await expect.poll(async () => (await (await page.request.get(`/api/discussions/${id}`)).json()).rolesConfirmed).toBe(true);
});

test('template creation preserves attachment submission and single-sentence mode together', async ({ page }) => {
  await page.goto('/'); await choose(page, '回覆來源', 'fake'); await choose(page, '回覆模式', 'single-sentence');
  await page.getByLabel('討論題目', { exact: true }).fill('Attachment browser fixture: templates');
  await page.locator('input[type=file]').setInputFiles({ name: 'scenario.txt', mimeType: 'text/plain', buffer: Buffer.from('SCENARIO_ATTACHMENT_21') });
  await card(page, 'Decision Lab').click(); await page.getByLabel('期望成果').fill('Keep my attachment goal.'); await card(page, 'Incident War Room').click();
  await page.getByRole('button', { name: '建立並開始討論 →' }).click();
  await expect(page.locator('.attachment-card')).toHaveCount(1);
  const id = await page.evaluate(() => localStorage.getItem('candc-discussion'));
  const saved = await (await page.request.get(`/api/discussions/${id}`)).json();
  expect(saved.singleSentence).toBe(true); expect(saved.goal).toBe('Keep my attachment goal.'); expect(saved.mode).toBe('manual');
  expect(saved.messages.flatMap((m: { attachments?: { name: string }[] }) => m.attachments ?? []).map((a: { name: string }) => a.name)).toEqual(['scenario.txt']);
  await page.getByRole('button', { name: '提供給 AI 的文字', exact: true }).click();
  await expect(page.locator('.attachment-text')).toHaveText('SCENARIO_ATTACHMENT_21');
});

test('scenario summary tracks current settings, explicit same-value choices and every missing seat or moderator setting', async ({ page }) => {
  await page.route('**/api/environment', route => route.fulfill({ json: { ready: true, codex: { ready: true }, claude: { ready: true } } }));
  await page.route('**/api/models', route => route.fulfill({ json: { codex: [{ id: 'fixture-codex', label: 'Fixture Codex', efforts: ['low', 'high'] }], claude: ['sonnet'], error: null } }));
  await page.goto('/'); await card(page, 'Decision Lab').click();
  const summary = page.getByRole('region', { name: '目前情境設定' });
  await expect(summary).toContainText('有結論就停'); await expect(summary).toContainText('範本欄位尚未手動修改。');
  await expect(summary.locator('.scenario-missing li')).toHaveCount(2);
  await page.getByRole('radiogroup', { name: '討論方式', exact: true }).getByRole('radio', { name: '共同分析', exact: true }).click();
  await expect(summary).toContainText('已自訂：討論形式');
  await page.getByRole('switch', { name: '啟用獨立主持人' }).check(); await expect(summary.locator('.scenario-missing li')).toHaveCount(3);
  await pick(page, '座位 1 模型', /Fixture Codex/); await pick(page, '座位 2 模型', 'Sonnet');
  await expect(summary.locator('.scenario-missing li')).toHaveCount(1); await expect(summary).toContainText('主持人：請選擇模型與思考程度');
  await pick(page, '主持人 模型', /Fixture Codex/); await expect(summary.locator('.scenario-missing')).toHaveCount(0);
  await choose(page, '進行方式', 'auto'); await expect(summary).toContainText('自動');
  await page.getByRole('radiogroup', { name: '討論方式', exact: true }).getByRole('radio', { name: '共同分析', exact: true }).focus();
  await page.keyboard.press('ArrowRight'); await expect(choice(page, '討論方式')).toHaveValue('debate');
  await expect(summary).toContainText('正反辯論需要每個座位選擇支持或反對。');
  await page.keyboard.press('ArrowLeft'); await expect(choice(page, '討論方式')).toHaveValue('discussion');
  await expect(summary.locator('.scenario-missing')).toHaveCount(0);
  await language(page, 'en'); await expect(page.getByRole('region', { name: 'Current scenario settings' })).toContainText('Customized:');
  await expect(page.getByLabel('Seat 1 name')).toHaveValue('方案分析');
  await page.getByRole('button', { name: 'Go to seats and moderator' }).click(); await expect(page.getByLabel('Seat 1 name')).toBeFocused();
});

test('reset and undo preserve the original draft, its edit ownership and all unmanaged settings across locale changes', async ({ page }) => {
  await page.goto('/'); await choose(page, '回覆來源', 'fake'); await card(page, 'Engineering Review').click();
  await page.getByLabel('討論題目', { exact: true }).fill('Keep this topic'); await page.getByLabel('限制', { exact: true }).fill('Keep constraints');
  await choose(page, '回覆模式', 'single-sentence'); await page.getByRole('switch', { name: '啟用獨立主持人' }).check();
  await page.getByLabel('期望成果').fill(''); await page.getByLabel('座位 1 名稱').fill('My reviewer'); await page.getByLabel('座位 2 立場', { exact: true }).fill('');
  await choose(page, '討論方式', 'debate'); await choose(page, '進行方式', 'auto');
  await page.locator('input[type=file]').setInputFiles({ name: 'keep.txt', mimeType: 'text/plain', buffer: Buffer.from('Keep attachment') });
  await language(page, 'en');
  const writes: string[] = []; page.on('request', r => { if (r.method() === 'POST') writes.push(r.url()); });
  await page.getByRole('button', { name: 'Reset to template defaults', exact: true }).click();
  await expect(choice(page, 'Discussion approach')).toHaveValue('discussion'); await expect(choice(page, 'Run mode')).toHaveValue('conclusion');
  await expect(page.getByLabel('Desired outcome')).not.toHaveValue(''); await expect(page.getByLabel('Seat 1 name')).toHaveValue('軟體／系統架構師');
  await expect(page.getByLabel('Seat 2 stance', { exact: true })).not.toHaveValue('');
  await page.getByLabel('Discussion topic', { exact: true }).fill('Topic changed after reset');
  await page.getByRole('button', { name: 'Reset to template defaults', exact: true }).click();
  await language(page, 'zh-TW'); await page.getByRole('button', { name: '復原重設', exact: true }).click();
  await expect(page.getByLabel('期望成果')).toHaveValue(''); await expect(page.getByLabel('座位 1 名稱')).toHaveValue('My reviewer');
  await expect(page.getByLabel('座位 2 立場', { exact: true })).toHaveValue('');
  await expect(choice(page, '討論方式')).toHaveValue('debate'); await expect(choice(page, '進行方式')).toHaveValue('auto');
  await expect(page.getByRole('button', { name: '重設為範本預設', exact: true })).toBeFocused();
  await card(page, 'Incident War Room').click();
  await expect(page.getByLabel('期望成果')).toHaveValue(''); await expect(page.getByLabel('座位 1 名稱')).toHaveValue('My reviewer');
  await expect(choice(page, '討論方式')).toHaveValue('debate'); await expect(choice(page, '進行方式')).toHaveValue('auto');
  await expect(page.getByLabel('討論題目', { exact: true })).toHaveValue('Topic changed after reset'); await expect(page.getByLabel('限制', { exact: true })).toHaveValue('Keep constraints');
  await expect(choice(page, '回覆模式')).toHaveValue('single-sentence'); await expect(page.getByRole('switch', { name: '啟用獨立主持人' })).toBeChecked();
  await expect(page.locator('.attachment-picker li')).toContainText('keep.txt'); expect(writes).toEqual([]);
});

for (const action of ['goal', 'role', 'kind', 'mode', 'add', 'remove', 'preset', 'scenario'] as const) test(`undo cannot overwrite newer edits or seat ownership after ${action}`, async ({ page }) => {
  await page.goto('/'); await card(page, 'Decision Lab').click();
  if (action === 'remove') await page.getByRole('button', { name: '加一個座位', exact: true }).click();
  await page.getByLabel('期望成果').fill('Original draft'); await page.getByRole('button', { name: '重設為範本預設', exact: true }).click();
  await expect(page.getByRole('button', { name: '復原重設', exact: true })).toBeVisible();
  if (action === 'goal') await page.getByLabel('期望成果').fill('New draft');
  if (action === 'role') await page.getByLabel('座位 1 名稱').fill('New role');
  if (action === 'kind') await page.getByRole('radiogroup', { name: '討論方式', exact: true }).getByRole('radio', { name: '共同分析', exact: true }).click();
  if (action === 'mode') await page.getByRole('radiogroup', { name: '進行方式', exact: true }).getByRole('radio', { name: '有結論就停', exact: true }).click();
  if (action === 'add') await page.getByRole('button', { name: '加一個座位', exact: true }).click();
  if (action === 'remove') await page.getByRole('button', { name: '移除座位 3', exact: true }).click();
  if (action === 'preset') await page.getByRole('button', { name: '雙人', exact: true }).click();
  if (action === 'scenario') await card(page, 'Engineering Review').click();
  await expect(page.getByRole('button', { name: '復原重設', exact: true })).toHaveCount(0);
  await choose(page, '討論方式', 'selection'); await expect(page.getByRole('button', { name: '重設為範本預設', exact: true })).toBeDisabled();
});

for (const locale of ['zh-TW', 'en'] as const) for (const theme of ['light', 'dark'] as const) for (const [width, height] of [[1440, 900], [1280, 720], [390, 844]]) {
  test(`scenario cards render and support keyboard selection: ${locale} ${theme} ${width}`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    // The existing contrast helper itself triggers Chrome's canvas readback performance advisory.
    page.on('console', message => { if ((message.type() === 'error' || message.type() === 'warning') && !message.text().startsWith('Canvas2D: Multiple readback operations')) errors.push(message.text()); });
    await page.setViewportSize({ width: width!, height: height! });
    await page.addInitScript(({ locale, theme }) => { localStorage.setItem('candc-locale', locale); localStorage.setItem('candc-theme', theme); localStorage.setItem('candc-font-size', '18'); }, { locale, theme });
    await page.goto('/'); await expect(page).toHaveTitle(/CandC/); expect(new URL(page.url()).hostname).toBe('127.0.0.1');
    await expect(page.getByRole('heading', { name: locale === 'en' ? 'New discussion' : '新討論', exact: true })).toBeVisible();
    await expect(page.locator('.scenario-card')).toHaveCount(6); await expect(page.locator('.scenario-card[aria-pressed=true]')).toHaveCount(0);
    const selected = card(page, 'Engineering Review'); await selected.focus(); await expect(selected).toBeFocused(); await page.keyboard.press('Enter');
    await expect(selected).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('.supplement')).toHaveAttribute('open', '');
    await expect(page.locator('.seat-name').first()).toHaveValue(locale === 'en' ? 'Software / System Architect' : '軟體／系統架構師');
    await settled(selected);
    const selectedStyle = await selected.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, border: getComputedStyle(element).borderTopColor }));
    await selected.hover();
    await expect(selected).toHaveCSS('background-color', selectedStyle.background); await expect(selected).toHaveCSS('border-top-color', selectedStyle.border);
    await page.mouse.move(0, 0);
    expect((await contrast(selected.locator('strong'))).ratio).toBeGreaterThanOrEqual(4.5);
    expect((await contrast(selected.locator('span'))).ratio).toBeGreaterThanOrEqual(4.5);
    const boxes = await page.locator('.scenario-card').evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    if (width! < 768) expect(boxes.every(b => Math.abs(b.x - boxes[0]!.x) < 1)).toBe(true);
    else { expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x); expect(boxes[1]!.y).toBe(boxes[0]!.y); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0); expect(errors).toEqual([]);
    // Tab from the second card through the remaining cards and actions. Native focus
    // must clear the sticky launch bar before any screenshot can change scrolling.
    for (let step = 0; step < 6; step++) await page.keyboard.press('Tab');
    const reset = page.getByRole('button', { name: locale === 'en' ? 'Reset to template defaults' : '重設為範本預設', exact: true });
    await expect(reset).toBeFocused();
    expect(await reset.evaluate(element => { const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
    if (process.env.CANDC_TEMPLATE_SCREENSHOT_DIR) {
      await page.locator('.scenario-summary').screenshot({ path: path.join(process.env.CANDC_TEMPLATE_SCREENSHOT_DIR, `summary-${locale}-${theme}-${width}.png`) });
      await page.locator('.scenario-picker').screenshot({ path: path.join(process.env.CANDC_TEMPLATE_SCREENSHOT_DIR, `templates-${locale}-${theme}-${width}.png`) });
    }
    // Lower cards remain reachable while the existing launch bar stays sticky on small screens.
    await card(page, 'Simulation Arena').click(); await expect(card(page, 'Simulation Arena')).toHaveAttribute('aria-pressed', 'true');
  });
}
