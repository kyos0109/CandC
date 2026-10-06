import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RoomNewDiscussion } from '../web/RoomNewDiscussion.js';
import { ReadingControls } from '../web/ReadingControls.js';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { english } from '../web/locales/en.js';
import { dateLocale, setLocale, translate } from '../web/i18n.js';
import { statusText, reasonText } from '../web/api.js';
import { seatViews } from '../web/seats.js';

afterEach(() => { setLocale('zh-TW'); vi.unstubAllGlobals(); });

it('covers every application message with matching interpolation parameters', async () => {
  const placeholders = (text: string) => [...new Set(text.match(/\{\d+\}/g) ?? [])].sort();
  for (const [source, value] of Object.entries(english)) {
    expect(value.trim(), source).not.toBe('');
    expect(placeholders(value), source).toEqual(placeholders(source));
  }
  async function check(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { await check(file); continue; }
      if (!/\.tsx?$/.test(file) || file.endsWith('i18n.ts')) continue;
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(/translate\(("(?:[^"\\]|\\.)*")/g)) {
        expect(english, `${file}: ${match[1]}`).toHaveProperty(JSON.parse(match[1]!));
      }
    }
  }
  await check('web');
});

it('switches dynamic status and seat labels without translating content', () => {
  const content = '使用者原文 / original content {0}';
  const room = { participants: [{ id: 'codex', provider: 'codex' as const, settings: { model: 'fixture', effort: null }, role: 'speaker' as const, instructions: '', label: content }], moderator: null };
  expect(statusText.paused).toBe('已暫停');
  setLocale('en');
  expect(statusText.paused).toBe('Paused');
  expect(reasonText('Stopped by user.')).toContain('Rebuild');
  expect(seatViews(room).user!.name).toBe('You');
  expect(seatViews(room).codex!.name).toBe(content);
  expect(translate('傳給 {0}', content)).toBe(`Sent to ${content}`);
  expect(translate('私訊給 {0} · 只有它收得到；{1}其他座位{2}都看不到。', 'Speaker', translate('主持人與'), '')).toContain('the moderator and other seats');
  expect(dateLocale()).toBe('en-US');
  setLocale('zh-TW');
  expect(statusText.paused).toBe('已暫停');
  expect(dateLocale()).toBe('zh-TW');
});

it('renders creation and reading controls in English with unchanged stable field values', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('localStorage', { getItem: () => null });
  vi.stubGlobal('document', { documentElement: { dataset: {} } });
  setLocale('en');
  const html = renderToStaticMarkup(<RoomNewDiscussion environment={null} models={{ codex: [], claude: [], error: null }} busy={false} onCreate={async () => {}} onConnection={() => {}}/>);
  for (const label of ['New discussion', 'Three-way review', 'Discussion topic', 'Independent moderator', 'Create and start discussion', 'Manual', 'Live AI']) expect(html).toContain(label);
  expect(html).toContain('value="manual"');
  expect(html).not.toContain('寫下題目');
  const controls = renderToStaticMarkup(<ReadingControls settings readingMode="full" setReadingMode={() => {}}/>);
  expect(controls).toContain('Full conversation'); expect(controls).toContain('value="en" selected');
});
