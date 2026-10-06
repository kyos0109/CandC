import { test, expect } from './fixtures';

for (const shape of ['none', 'downgraded']) test(`a ${shape} rebuttal returns the turn to the invited peer without accepting the proposal`, async ({ page }) => {
  await page.goto('/');
  const id = await page.evaluate(async shape => {
    const id = crypto.randomUUID();
    const input = { behaviorVersion: 3, discussionPolicyVersion: 1, topic: `Review handoff fixture:${shape}`, backend: 'fake', mode: 'auto', flow: 'alternating', moderatorMode: 'facilitator',
      moderator: { id: 'moderator', provider: 'codex', role: 'moderator', settings: { model: 'fixture', effort: 'low' } },
      participants: ['codex', 'claude'].map(id => ({ id, provider: id, role: 'speaker', instructions: '', settings: { model: 'fixture', effort: 'low' } })),
      limits: { maxRounds: 2, maxDurationMs: 30000, turnTimeoutMs: 5000 } };
    for (const [url, data] of [['/api/discussions', { id, input }], [`/api/discussions/${id}/start`, { operationId: crypto.randomUUID() }]] as const) {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!response.ok) throw new Error(await response.text());
    }
    localStorage.setItem('candc-discussion', id); return id;
  }, shape);
  const state = async () => (await (await page.request.get('/api/discussions/' + id)).json());
  await expect.poll(async () => { const s = await state(); return [s.room.contributions, s.status !== 'running', s.activity]; }).toEqual([4, true, null]);
  const before = await state(), speakers = before.room.calls.filter((c: { purpose: string }) => c.purpose === 'discussion');
  expect(speakers.map((c: { participant: string }) => c.participant)).toEqual(['codex', 'claude', 'codex', 'claude']);
  expect(before.room.conclusionRequest).toBeNull(); expect(before.room.proposal.confirmed).toEqual(['codex']);
  expect(before.room.proposal.reviews[0].adequate).toBe(false); expect(before.room.outcome).toBeNull(); expect(before.room.interimResults ?? []).toEqual([]);
  expect(speakers[3].task).toContain('Respond to the public rebuttal.');
  if (shape === 'downgraded') expect(speakers[2].metadataDiagnostics).toContain('control-schema');
  await page.reload(); await page.getByRole('tab', { name: /^結論/ }).click(); await expect(page.locator('.room-outcome')).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem('candc-locale', 'en')); await page.reload();
  await page.getByRole('tab', { name: /^Conclusion/ }).click(); await expect(page.locator('.room-outcome')).toHaveCount(0);
  expect((await state()).room.calls).toEqual(before.room.calls); expect((await state()).room.proposal).toEqual(before.room.proposal);
});

for (const fixture of ['Control fallback fixture.', 'Repair limit fixture.']) test(`${fixture} continues with localized safe diagnostics`, async ({ page }) => {
  await page.goto('/');
  const id = await page.evaluate(async topic => {
    const id = crypto.randomUUID(), fallback = topic.startsWith('Control');
    const input = { behaviorVersion: 3, discussionPolicyVersion: 1, topic, backend: 'fake', mode: 'auto', flow: 'alternating', moderatorMode: 'facilitator',
      moderator: fallback ? { id: 'moderator', provider: 'codex', role: 'moderator', settings: { model: 'fixture', effort: 'low' } } : null,
      participants: ['codex', 'claude'].map(id => ({ id, provider: id, role: 'speaker', instructions: '', settings: { model: 'fixture', effort: 'low' } })),
      limits: { maxRounds: fallback ? 2 : 4, maxDurationMs: 30000, turnTimeoutMs: 5000 } };
    for (const [url, data] of [['/api/discussions', { id, input }], [`/api/discussions/${id}/start`, { operationId: crypto.randomUUID() }]] as const) {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!response.ok) throw new Error(await response.text());
    }
    localStorage.setItem('candc-discussion', id); return id;
  }, fixture);
  const state = async () => (await (await page.request.get('/api/discussions/' + id)).json());
  await expect.poll(async () => (await state()).activity).toBeNull();
  const before = await state(), fallback = fixture.startsWith('Control');
  expect(before.room.contributions).toBe(fallback ? 4 : 8); expect(before.room.outcome).toBeNull();
  expect(before.room.calls.some((c: { controlDiagnostic?: string }) => c.controlDiagnostic)).toBe(false);
  if (fallback) {
    expect(before.room.calls.slice(0, 3).map((c: { participant: string }) => c.participant)).toEqual(['moderator', 'codex', 'claude']);
    expect(before.room.commands.every((c: { action: { type: string } }) => c.action.type === 'observe')).toBe(true);
  }
  await page.reload(); await page.getByRole('tab', { name: '診斷', exact: true }).click();
  await expect(page.getByText(fallback ? '附加資料未採用：控制資料格式無效，已保留發言並採用中性動作' : '附加資料未採用：交付格式修復已達上限，這次提案未採用，討論繼續', { exact: true }).first()).toBeVisible();
  await page.evaluate(() => localStorage.setItem('candc-locale', 'en')); await page.reload();
  await page.getByRole('tab', { name: 'Diagnostics', exact: true }).click();
  await expect(page.getByText(fallback ? 'Additional claims rejected: Invalid control format; public text retained with neutral control' : 'Additional claims rejected: Delivery format repair limit reached; this proposal was not accepted and discussion continues', { exact: true }).first()).toBeVisible();
  expect((await state()).room.calls).toEqual(before.room.calls);
});

for (const mode of ['auto', 'manual'] as const) test(`${mode} retains reviewed stages and localized diagnostics without ending the discussion`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const id = await page.evaluate(async mode => {
    const id = crypto.randomUUID();
    const input = { behaviorVersion: 3, discussionPolicyVersion: 1, topic: 'Discussion revision fixture.', backend: 'fake', mode, moderator: null,
      participants: ['codex', 'claude'].map(id => ({ id, provider: id, role: 'speaker', instructions: '', settings: { model: 'fixture', effort: 'low' } })),
      limits: { maxRounds: 2, maxDurationMs: 30000, turnTimeoutMs: 5000 } };
    for (const [url, data] of [['/api/discussions', { id, input }], [`/api/discussions/${id}/start`, { operationId: crypto.randomUUID() }]] as const) {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!response.ok) throw new Error(await response.text());
    }
    localStorage.setItem('candc-discussion', id); return id;
  }, mode);
  const state = async () => (await (await page.request.get('/api/discussions/' + id)).json());
  await expect.poll(async () => (await state()).activity).toBeNull();
  const before = await state(); expect(before.room.contributions).toBe(mode === 'auto' ? 4 : 2);
  expect(before.room.outcome).toBeNull(); expect(before.room.proposal).toBeNull(); expect(before.room.interimResults).toHaveLength(1);
  expect(before.room.calls[0].metadataDiagnostics).toContain('work-schema');
  await page.reload(); await page.getByRole('tab', { name: /^結論/ }).click();
  const stages = page.getByRole('region', { name: '已審查的階段成果', exact: true });
  await expect(stages).toContainText('A reviewed interim answer {0}.'); await expect(stages).toContainText('A retained objection.');
  await expect(stages).toContainText('An unverified limitation.'); await expect(page.locator('.room-outcome')).toHaveCount(0);
  await page.getByRole('tab', { name: '診斷', exact: true }).click(); await expect(page.getByText('附加資料未採用：工作回報格式無效', { exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('candc-locale', 'en')); await page.reload();
  await page.getByRole('tab', { name: 'Diagnostics', exact: true }).click();
  await expect(page.getByText('Additional claims rejected: Invalid work report format', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /^Conclusion/ }).click();
  await expect(page.getByRole('region', { name: 'Reviewed interim results', exact: true })).toContainText('A reviewed interim answer {0}.');
  expect((await state()).room.calls).toEqual(before.room.calls);
  const exported = await page.request.get('/api/discussions/' + id + '/export?format=markdown');
  expect(await exported.text()).toContain('"interimResults"'); expect(await exported.text()).toContain('A retained objection.');
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (mode === 'manual') {
    expect((await page.request.post('/api/discussions/' + id + '/start', { data: { operationId: crypto.randomUUID() } })).ok()).toBe(true);
    await expect.poll(async () => (await state()).activity).toBeNull();
    expect((await state()).room.contributions).toBe(4); expect((await state()).room.outcome).toBeNull();
  }
  expect(errors).toEqual([]);
});
