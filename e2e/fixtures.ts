import type { Locator, Page } from '@playwright/test';
import { test as base, expect } from '@playwright/test';
import { defaultDebateRoles } from '../web/DebateRoles';

export { expect };
export const test = base.extend<{ cleanupDiscussions: void }>({
  cleanupDiscussions: [async ({ request }, use) => {
    expect(await (await request.get('/health')).json()).toMatchObject({ application: 'candc', testFixture: true });
    try { await use(); }
    finally {
      await request.get('/api/session');
      const states = await (await request.get('/api/discussions')).json() as Array<{ id: string; status: string; activity: string | null }>;
      for (const state of states) {
        if (state.status !== 'running' && state.activity === null) continue;
        expect((await request.post(`/api/discussions/${state.id}/stop`, { data: {} })).ok()).toBe(true);
        await expect.poll(async () => (await (await request.get(`/api/discussions/${state.id}`)).json()).activity, { timeout: 10_000 }).toBeNull();
      }
    }
  }, { auto: true }],
});

export async function settings(page: Page) { await page.getByRole('button', { name: '更多討論操作' }).click(); }
export async function closePanel(page: Page) { await page.locator('.inspector > header button').click(); }
// The two-agent creation form was removed: new discussions are multi-seat. Version 1/2 discussions still exist in saved history,
// so their runtime and display stay covered by creating them through the API, then opening them like any saved discussion.
export async function createLegacy(page: Page, options: { input?: Record<string, unknown>; start?: 'start' | 'roles' | false } = {}) {
  const { input = {}, start = 'start' } = options;
  await page.goto('/');
  const id = await page.evaluate(async ({ input, start, debate }) => {
    const kind = (input.kind as string | undefined) ?? 'discussion', id = crypto.randomUUID();
    const body = { behaviorVersion: 2, goal: '', constraints: '', focused: true, topic: 'Fixture topic.', backend: 'fake', kind, mode: 'manual', flow: 'free', roles: kind === 'debate' ? debate : { codex: '', claude: '' }, research: false, roots: [],
      agents: { codex: { model: 'demo-codex', effort: 'medium' }, claude: { model: 'demo-claude', effort: 'medium' } }, limits: { maxRounds: 50, maxDurationMs: 14_400_000, turnTimeoutMs: 600_000 }, ...input };
    const post = async (path: string, data: unknown) => { const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (!response.ok) throw new Error(`${path} ${response.status} ${await response.text()}`); };
    await post('/api/discussions', { id, input: body });
    // A debate waits for both positions to be confirmed; every other discussion starts as soon as it is created.
    if (start && kind !== 'debate') await post(`/api/discussions/${id}/${start}`, { operationId: crypto.randomUUID() });
    localStorage.setItem('candc-discussion', id);
    return id;
  }, { input, start, debate: defaultDebateRoles });
  await page.reload();
  return id;
}
// Model and provider pickers are select-only comboboxes: open one, then click an option by its accessible name.
export async function pick(page: Page, combobox: string, option: string | RegExp) { await page.getByRole('combobox', { name: combobox, exact: true }).click(); await page.getByRole('option', { name: option }).click(); }
// Entrance animations scale cards slightly; measure geometry only after they have finished.
export async function settled(locator: Locator) { await locator.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished))); }
// Segmented controls are native radio groups named by aria-label.
export function choice(page: Page, label: string) { return page.getByRole('radiogroup', { name: label, exact: true }).locator('input:checked'); }
export async function choose(page: Page, label: string, value: string) { await page.getByRole('radiogroup', { name: label, exact: true }).locator(`input[value="${value}"]`).check(); }
export async function reading(page: Page) { if (await page.getByLabel('閱讀模式').count() === 0) await page.getByRole('button', { name: '閱讀設定', exact: true }).click(); }
