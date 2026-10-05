import { test, expect, choose, pick, settled } from './fixtures';
import type { ProviderId } from '../src/room-contract';
import type { ProviderStatus } from '../src/environment';
import path from 'node:path';

const status = (state: ProviderStatus['state'], reason: string | null, version: string | null = 'fixture'): ProviderStatus => ({
  state, reason, version, ready: state === 'ready', validated: ['ready', 'login-required', 'auth-check-failed'].includes(state), research: state === 'ready', loginCommand: 'fixture login',
});
async function capture(page: import('@playwright/test').Page, name: string) { if (process.env.CANDC_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.CANDC_SCREENSHOT_DIR, name), fullPage: true }); }

test('the connection check lists every provider, and seat controls follow readiness and the model catalog', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => { localStorage.setItem('candc-theme', 'dark'); }); await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/api/environment', route => route.fulfill({ json: { ready: true, codex: { ready: true }, claude: { ready: true }, providers: {
    codex: status('ready', null), claude: status('ready', null), gemini: status('missing', '找不到 CLI；請先安裝，或確認執行路徑，再重新檢查。', null), grok: status('unverified', 'CLI 已找到；尚未完成此版本登入、工具隔離及 session 真實驗證。'),
  } } }));
  await page.route('**/api/models', route => route.fulfill({ json: { codex: [{ id: 'fixture-codex', label: 'Fixture Codex', efforts: ['low', 'high'] }], claude: ['sonnet'], error: null } }));
  await page.goto('/'); expect(new URL(page.url()).hostname).toBe('127.0.0.1'); await expect(page).toHaveTitle(/CandC/);
  await expect(page.getByRole('heading', { name: '新討論' })).toBeVisible();
  // Providers nobody sits on yet still show their readiness, so the reason is visible before a seat is added.
  const check = page.locator('.connection-check');
  await expect(check).toContainText('Codex · 就緒'); await expect(check).toContainText('Claude · 就緒');
  await expect(check).toContainText('Gemini · CLI 未安裝／找不到'); await expect(check).toContainText('Grok · CLI 尚未驗證');
  await page.getByRole('combobox', { name: '座位 1 供應商' }).click(); await expect(page.getByRole('option', { name: /^Gemini.*CLI 未安裝／找不到/ })).toBeVisible(); await page.keyboard.press('Escape');
  const codex = page.locator('.seat-row').first(), effort = page.getByRole('radiogroup', { name: '座位 1 思考程度', exact: true });
  // The effort control is always present, so choosing a model never changes the row's height.
  await expect(effort.getByRole('radio').first()).toBeDisabled(); await settled(codex);
  const height = await codex.evaluate(row => row.getBoundingClientRect().height);
  expect(await codex.evaluate(row => row.scrollWidth <= row.clientWidth)).toBe(true);
  await capture(page, 'cli-hints-desktop.png');
  await pick(page, '座位 1 模型', /Fixture Codex/);
  await expect(effort.getByRole('radio', { name: 'low' })).toBeEnabled(); await expect(effort.getByRole('radio', { name: 'low' })).toBeChecked();
  expect(await codex.evaluate(row => row.getBoundingClientRect().height)).toBe(height);
  await pick(page, '座位 2 模型', 'Sonnet'); await page.getByRole('textbox', { name: '討論題目', exact: true }).fill('Hints fixture.');
  await expect(page.getByRole('button', { name: '建立並開始討論 →' })).toBeEnabled();
  await pick(page, '座位 2 供應商', /^Gemini/);
  await expect(page.getByRole('combobox', { name: '座位 2 模型', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '建立並開始討論 →' })).toBeDisabled();
  await expect(page.locator('.start-bar .why')).toContainText('Gemini：CLI 未安裝／找不到');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await capture(page, 'cli-hints-mobile.png');
  await choose(page, '回覆來源', 'fake'); await expect(page.getByRole('button', { name: '建立並開始討論 →' })).toBeEnabled(); await expect(page.locator('.seat-row .chip.warn')).toHaveCount(0);
  await choose(page, '回覆來源', 'live');
  await page.getByRole('button', { name: '查看連線', exact: true }).click();
  await expect(page.getByRole('heading', { name: '連線與設定' })).toBeVisible(); await expect(page.getByRole('button', { name: '重新檢查' })).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('failed start and login diagnostics give actionable prompts for speakers and the moderator', async ({ page }) => {
  const providers: Record<ProviderId, ProviderStatus> = { codex: status('start-failed', 'CLI 無法啟動或檢查逾時；請確認執行路徑與權限，再重新檢查。', null), claude: status('login-required', '尚未完成官方 CLI 訂閱登入；請登入後重新檢查。'), gemini: status('auth-check-failed', '無法確認 CLI 登入狀態；請確認 CLI 能啟動，再重新檢查。'), grok: status('unverified', '此 CLI 版本尚未通過驗證，不能使用真實 AI。') };
  await page.route('**/api/environment', route => route.fulfill({ json: { ready: false, codex: { ready: false }, claude: { ready: false }, providers } }));
  await page.goto('/');
  const check = page.locator('.connection-check');
  await expect(check).toContainText('Codex · CLI 啟動失敗'); await expect(check).toContainText('Claude · CLI 尚未登入'); await expect(check).toContainText('Gemini · CLI 登入檢查失敗');
  await page.getByRole('switch', { name: '啟用獨立主持人' }).check(); await pick(page, '主持人 供應商', /^Grok/);
  await expect(page.locator('.host-card')).toContainText('Grok · CLI 尚未驗證'); await expect(page.getByRole('combobox', { name: '主持人 模型', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '建立並開始討論 →' })).toBeDisabled();
  // The connections page keeps each reason and the login command next to a recheck.
  await page.getByRole('button', { name: '查看連線與重新檢查' }).click();
  const list = page.getByRole('list', { name: '供應商連線狀態' });
  await expect(page.getByRole('heading', { name: '連線與設定' })).toBeVisible();
  await expect(list).toContainText('CLI 無法啟動或檢查逾時'); await expect(list).toContainText('尚未完成官方 CLI 訂閱登入'); await expect(list).toContainText('fixture login');
});
