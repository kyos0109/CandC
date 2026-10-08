import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function create(page: Page, topic: string, mode: 'manual' | 'conclusion') {
  await page.goto('/');
  const id = await page.evaluate(async ({ topic, mode }) => {
    const id = crypto.randomUUID();
    const input = { behaviorVersion: 3, discussionPolicyVersion: 1, topic, backend: 'fake', mode, flow: 'alternating', moderator: null,
      participants: ['codex', 'claude'].map(id => ({ id, provider: id, role: 'speaker', instructions: '', settings: { model: 'fixture', effort: 'low' } })),
      limits: { maxRounds: 8, maxDurationMs: 30000, turnTimeoutMs: 5000 } };
    for (const [url, data] of [['/api/discussions', { id, input }], [`/api/discussions/${id}/start`, { operationId: crypto.randomUUID() }]] as const) {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!response.ok) throw new Error(await response.text());
    }
    localStorage.setItem('candc-discussion', id); return id;
  }, { topic, mode });
  await expect.poll(async () => (await (await page.request.get(`/api/discussions/${id}`)).json()).status).toBe('paused');
  await page.reload(); return id;
}

test('session rejection preserves answers, explains submission and requires separate rebuild and continuation', async ({ page }) => {
  const id = await create(page, 'Session rejection fixture.', 'manual');
  const state = async () => (await (await page.request.get(`/api/discussions/${id}`)).json());
  const before = await state();
  await page.getByRole('button', { name: '繼續討論', exact: true }).click();
  await expect(page.getByRole('button', { name: '重建工作階段', exact: true })).toBeEnabled();
  const failed = await state(); expect(failed.status).toBe('indeterminate'); expect(failed.messages).toEqual(before.messages);
  await expect(page.locator('.discussion-notice')).toContainText('本次回合尚未送出');
  await page.getByRole('tab', { name: '診斷', exact: true }).click();
  await expect(page.locator('.data-table').first()).toContainText('工作階段被其他程序占用');
  await expect(page.locator('.data-table').first()).toContainText('thread/resume (-32600)');
  await page.evaluate(() => localStorage.setItem('candc-locale', 'en')); await page.reload();
  await expect(page.locator('.discussion-notice')).toContainText('This turn was not submitted');
  await page.getByRole('tab', { name: 'Diagnostics', exact: true }).click();
  await expect(page.locator('.data-table').first()).toContainText('Session is held by another process');
  await page.getByRole('button', { name: 'Rebuild sessions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue discussion', exact: true })).toBeEnabled();
  const rebuilt = await state(); expect(rebuilt.status).toBe('paused'); expect(rebuilt.room.sessions).toEqual({});
  expect(rebuilt.room.calls).toEqual(failed.room.calls); expect(rebuilt.messages).toEqual(before.messages);
  await page.getByRole('button', { name: 'Continue discussion', exact: true }).click();
  await expect.poll(async () => {
    const current = await state();
    return current.status === 'paused' && current.room.calls.length > failed.room.calls.length;
  }).toBe(true);
  const resumed = await state(); expect(resumed.status).toBe('paused'); expect(resumed.room.calls[failed.room.calls.length].sessionId).toBeNull();
  expect(resumed.messages.slice(0, before.messages.length)).toEqual(before.messages);
});

test('review gaps and done speakers pause without inventing a result, with localized notice after reload', async ({ page }) => {
  const id = await create(page, 'Reviewed idle fixture.', 'conclusion');
  const state = await (await page.request.get(`/api/discussions/${id}`)).json();
  expect(state.status).toBe('paused'); expect(state.room.contributions).toBe(4);
  expect(state.room.proposal.confirmed).toEqual(['codex']); expect(state.room.proposal.reviews[0].gaps).toEqual(['Missing fixture evidence.']);
  expect(state.room.proposal.reviews[0].adequate).toBe(false);
  expect(state.room.outcome).toBeNull(); expect(state.room.interimResults ?? []).toEqual([]);
  await expect(page.locator('.discussion-notice')).toContainText('提案尚未通過審查');
  await page.evaluate(() => localStorage.setItem('candc-locale', 'en')); await page.reload();
  await expect(page.locator('.discussion-notice')).toContainText('The proposal has not passed review');
  expect((await (await page.request.get(`/api/discussions/${id}`)).json()).room.calls).toEqual(state.room.calls);
});

test('a contradictory review is clarified by the same reviewer without accepting unresolved gaps', async ({ page }) => {
  const id = await create(page, 'Contradictory idle fixture.', 'conclusion');
  const state = await (await page.request.get(`/api/discussions/${id}`)).json();
  const proposal = state.room.proposal;
  expect(state.status).toBe('paused'); expect(state.room.outcome).toBeNull(); expect(state.room.interimResults ?? []).toEqual([]);
  expect(proposal.confirmed).toEqual(['codex']); expect(proposal.reviews).toHaveLength(1);
  expect(proposal.reviews[0]).toMatchObject({ actor: 'claude', adequate: false, gaps: ['Missing fixture evidence.'] });
  expect(state.room.calls.slice(0, 3).map((call: { participant: string }) => call.participant)).toEqual(['codex', 'claude', 'claude']);
  expect(state.room.calls[2].id).toBe(proposal.reviews[0].callId);
  expect(state.messages.some((message: { sender: string; text: string }) => message.sender === 'claude' &&
    message.text === `Saved clarification by claude for proposal ${proposal.id}, target claude.`)).toBe(true);
  await expect(page.locator('.discussion-notice')).toContainText('提案尚未通過審查');
  await page.evaluate(() => localStorage.setItem('candc-locale', 'en')); await page.reload();
  await expect(page.locator('.discussion-notice')).toContainText('The proposal has not passed review');
  const reloaded = await (await page.request.get(`/api/discussions/${id}`)).json();
  expect(reloaded.room.proposal).toEqual(proposal); expect(reloaded.room.calls).toEqual(state.room.calls); expect(reloaded.room.outcome).toBeNull();
});
