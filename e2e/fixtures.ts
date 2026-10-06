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
    const session = await fetch('/api/session');
    if (!session.ok) throw new Error(`Session bootstrap failed: ${session.status}`);
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
// WCAG contrast of an element's text colour against the backgrounds painted by it and its ancestors.
export async function contrast(chip: Locator) {
  return chip.evaluate(element => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d')!;
    const ancestors: Element[] = []; for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current);
    context.fillStyle = 'white'; context.fillRect(0, 0, 1, 1);
    for (const ancestor of ancestors) { context.fillStyle = getComputedStyle(ancestor).backgroundColor; context.fillRect(0, 0, 1, 1); }
    const background = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    const style = getComputedStyle(element); context.clearRect(0, 0, 1, 1); context.fillStyle = style.color; context.fillRect(0, 0, 1, 1);
    const foreground = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    const luminance = (rgb: number[]) => rgb.map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index]!, 0);
    const a = luminance(foreground), b = luminance(background);
    return { foreground, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), font: style.fontSize };
  });
}
export async function reading(page: Page) { if (await page.getByLabel('閱讀模式').count() === 0) await page.getByRole('button', { name: '閱讀設定', exact: true }).click(); }
