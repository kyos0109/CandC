import type { Page } from '@playwright/test';
import { test, expect, createLegacy } from './fixtures';
import { randomUUID } from 'node:crypto';

async function fixture(page: Page) {
  // Control transport state separately from real fixture HTTP responses and browser timers.
  await page.addInitScript(() => {
    const sources: FixtureSource[] = [];
    class FixtureSource extends EventTarget {
      static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSED = 2;
      readyState = 0;
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor(readonly url: string) {
        super(); sources.push(this);
        queueMicrotask(() => { if (this.readyState === 2) return; this.readyState = 1; this.onopen?.(new Event('open')); });
      }
      close() { this.readyState = 2; }
    }
    (window as unknown as { refreshSources: FixtureSource[] }).refreshSources = sources;
    window.EventSource = FixtureSource as unknown as typeof EventSource;
  });
  const id = await createLegacy(page, { start: false });
  const counts = { index: [] as string[], details: 0, storage: 0 };
  const background = '22222222-2222-4222-8222-222222222222';
  let running = false, detailGate: Promise<void> | undefined;
  await page.route('**/api/discussion-index?*', async route => {
    counts.index.push(new URL(route.request().url()).searchParams.get('q') ?? '');
    const response = await route.fetch(), result = await response.json();
    if (running) result.runningIds = [background];
    await route.fulfill({ response, json: result });
  });
  await page.route('**/api/discussions/' + id, async route => { counts.details++; await detailGate; await route.continue(); });
  await page.route('**/api/storage-issues', async route => { counts.storage++; await route.continue(); });
  await page.reload();
  await expect(page.getByRole('button', { name: '開始討論', exact: true })).toBeVisible();
  await expect.poll(() => counts.index.length).toBeGreaterThan(0);
  await page.clock.install(); await page.clock.runFor(500);
  return { id, background, counts, setRunning: () => { running = true; }, blockDetail: () => {
    let release!: () => void; detailGate = new Promise<void>(resolve => { release = resolve; });
    return () => { detailGate = undefined; release(); };
  } };
}

async function transport(page: Page, id: string, event: 'error' | 'open' | 'state') {
  await page.evaluate(({ id, event }) => {
    const sources = (window as unknown as { refreshSources: Array<EventSource> }).refreshSources;
    const source = sources.findLast(source => source.url.includes(id) && source.readyState !== 2);
    if (!source) throw new Error('Missing fixture SSE subscription.');
    if (event === 'error') source.onerror?.(new Event('error'));
    else if (event === 'open') source.onopen?.(new Event('open'));
    else source.dispatchEvent(new MessageEvent('state', { data: '{}' }));
  }, { id, event });
}

test('idle healthy SSE stops polling and debounced history queries fetch only the index', async ({ page }) => {
  const { counts } = await fixture(page), initial = { index: counts.index.length, details: counts.details, storage: counts.storage };
  await page.clock.runFor(6000);
  expect(counts.index).toHaveLength(initial.index); expect(counts.details).toBe(initial.details); expect(counts.storage).toBe(initial.storage);
  const search = page.getByRole('searchbox', { name: '篩選討論紀錄' });
  for (const value of ['F', 'Fi', 'Fixture']) { await search.fill(value); await page.clock.runFor(50); }
  await page.clock.runFor(250);
  await expect.poll(() => counts.index.length).toBe(initial.index + 1);
  expect(counts.index.at(-1)).toBe('Fixture'); expect(counts.details).toBe(initial.details); expect(counts.storage).toBe(initial.storage);
  await page.locator('.history-folders').getByRole('button', { name: /^已封存/ }).click(); await page.clock.runFor(250);
  await expect.poll(() => counts.index.length).toBe(initial.index + 2);
  expect(counts.details).toBe(initial.details); expect(counts.storage).toBe(initial.storage);
});

test('disconnected SSE polls without overlapping slow requests and stops after reconnection', async ({ page }) => {
  const { id, counts, blockDetail } = await fixture(page), initial = counts.details, release = blockDetail();
  try {
    await transport(page, id, 'error'); await page.clock.runFor(2100);
    await expect.poll(() => counts.details).toBe(initial + 1);
    await page.clock.runFor(6000); expect(counts.details).toBe(initial + 1);
  } finally { release(); }
  await expect(page.getByRole('button', { name: '開始討論', exact: true })).toBeVisible();
  await transport(page, id, 'open'); const after = counts.details;
  await page.clock.runFor(6000); expect(counts.details).toBe(after);
});

test('background running discussions stay subscribed and polled while viewing a new discussion', async ({ page }) => {
  const { id, background, counts, setRunning } = await fixture(page);
  setRunning(); await page.getByRole('searchbox', { name: '篩選討論紀錄' }).fill('Fixture'); await page.clock.runFor(250);
  await expect.poll(() => page.evaluate(id => (window as unknown as { refreshSources: EventSource[] }).refreshSources.some(source => source.url.includes(id) && source.readyState !== 2), background)).toBe(true);
  const details = counts.details;
  await transport(page, background, 'state'); await page.clock.runFor(100);
  await expect.poll(() => counts.storage).toBeGreaterThan(1); expect(counts.details).toBe(details);
  // A selected-discussion event must survive a background event within the same debounce window.
  await transport(page, id, 'state'); await transport(page, background, 'state'); await page.clock.runFor(100);
  await expect.poll(() => counts.details).toBe(details + 1);
  await page.getByRole('button', { name: '新討論', exact: true }).click();
  await expect(page.getByRole('heading', { name: '新討論', exact: true })).toBeVisible();
  const index = counts.index.length, detail = counts.details;
  await page.clock.runFor(2100); await expect.poll(() => counts.index.length).toBeGreaterThan(index);
  expect(counts.details).toBe(detail);
  expect(await page.evaluate(id => (window as unknown as { refreshSources: EventSource[] }).refreshSources.some(source => source.url.includes(id) && source.readyState !== 2), background)).toBe(true);
});

for (const background of [false, true]) test(`normal subscription changes never flash reconnect warnings with real delayed SSE (background: ${background})`, async ({ page }) => {
  const tag = randomUUID(), topics = [`Connection A ${tag}`, `Connection B ${tag}`];
  let first: string | undefined;
  // Keep native EventSource networking; delay headers so CONNECTING and partial OPEN states are observable.
  await page.addInitScript(() => {
    const probe = { sources: [] as EventSource[], bannerFrames: 0, errors: 0 };
    (window as unknown as { connectionProbe: typeof probe }).connectionProbe = probe;
    const Native = window.EventSource;
    window.EventSource = class extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init); probe.sources.push(this); this.addEventListener('error', () => probe.errors++);
      }
    };
    const frame = () => {
      if ([...document.querySelectorAll<HTMLElement>('.notice.warning')].some(element =>
        element.textContent?.includes('正在重新連線') && element.getClientRects().length)) probe.bannerFrames++;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.route('**/events', async route => {
    await new Promise(resolve => setTimeout(resolve, background && first && route.request().url().includes(first) ? 50 : 250));
    await route.continue();
  });
  try {
    first = await createLegacy(page, { start: false, input: { topic: topics[0] } });
    if (background) await page.route('**/api/discussion-index?*', async route => {
      const response = await route.fetch(), result = await response.json(); result.runningIds = [first];
      await route.fulfill({ response, json: result });
    });
    const second = await createLegacy(page, { start: false, input: { topic: topics[1] } });
    const waitOpen = async (id: string, count: number) => {
      await page.waitForFunction(({ id, count }) => {
        const sources = (window as unknown as { connectionProbe: { sources: EventSource[] } }).connectionProbe.sources.filter(source => source.readyState !== 2);
        return sources.length === count && sources.every(source => source.readyState === 1) && sources.some(source => source.url.includes(id));
      }, { id, count });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    };
    await expect(page.locator('.discussion-heading h1')).toHaveText(topics[1]!);
    await waitOpen(second, background ? 2 : 1);
    for (let turn = 0; turn < 4; turn++) {
      const chosen = turn % 2;
      await page.evaluate(() => { (window as unknown as { connectionProbe: { bannerFrames: number } }).connectionProbe.bannerFrames = 0; });
      await page.locator('.history-item').filter({ hasText: topics[chosen]! }).click();
      await waitOpen(chosen === 0 ? first : second, background && chosen === 1 ? 2 : 1);
      const probe = await page.evaluate(() => {
        const { bannerFrames, errors } = (window as unknown as { connectionProbe: { bannerFrames: number; errors: number } }).connectionProbe;
        return { bannerFrames, errors };
      });
      expect(probe).toEqual({ bannerFrames: 0, errors: 0 });
    }
    // Real transport failures must still show the warning; the existing cases cover polling/reconnection.
    await page.unroute('**/events');
    await page.route('**/events', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await page.reload();
    await expect(page.getByText('正在重新連線。若連線中斷超過 15 秒，程式會在目前發言完成後暫停。', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { connectionProbe: { errors: number } }).connectionProbe.errors)).toBeGreaterThan(0);
  } finally { await page.unrouteAll({ behavior: 'wait' }); }
});
