import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelPicker } from '../web/ui/ModelPicker.js';
import type { Models } from '../web/api.js';
import type { ProviderId } from '../src/room-contract.js';

const models: Models = { codex: [{ id: 'gpt-x', label: 'GPT X', efforts: ['low', 'medium', 'high'] }], claude: ['sonnet', 'opus'], gemini: [], grok: [], error: null };
type Options = { model?: string; effort?: 'low' | 'medium' | 'high' | 'max' | null; models?: Models; demo?: boolean; disabled?: boolean; disabledReason?: string; onRetry?: () => void };
const render = (provider: ProviderId, o: Options = {}) => renderToStaticMarkup(<ModelPicker provider={provider} label="座位 1" models={o.models ?? models}
  value={{ model: o.model ?? '', effort: o.effort ?? null }} demo={o.demo} disabled={o.disabled} disabledReason={o.disabledReason} onRetry={o.onRetry} onChange={() => {}}/>);
const classes = (html: string) => [...new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap(m => m[1]!.split(' ')))].sort();

describe('shared model picker', () => {
  it('gives Codex and Claude the same control, so the two providers cannot drift apart again', () => {
    const codex = render('codex', { model: 'gpt-x', effort: 'medium' }), claude = render('claude', { model: 'sonnet', effort: 'medium' });
    for (const html of [codex, claude]) {
      expect(html).toContain('role="combobox"'); expect(html).toContain('aria-label="座位 1 模型"'); expect(html).toContain('role="radiogroup"'); expect(html).toContain('aria-label="座位 1 思考程度"');
      expect(html).not.toContain('<select'); expect(html).not.toContain('<datalist');
    }
    expect(classes(codex)).toEqual(classes(claude));
    expect(codex).toContain('<b>GPT X</b><code>gpt-x</code>'); expect(claude).toContain('<b>Sonnet</b><code>sonnet</code>');
  });
  it('shows disabled placeholder efforts for Codex before a model is chosen, and stays disabled without a catalogue', () => {
    const html = render('codex');
    expect(html).toContain('請選擇模型'); expect(html).toContain('data-empty=""'); expect(html.match(/type="radio"/g)).toHaveLength(3); expect(html.match(/disabled=""/g)).toHaveLength(3);
    const empty = render('codex', { models: { ...models, codex: [] }, onRetry: () => {} });
    expect(empty).toContain('模型清單尚未取得'); expect(empty).toContain('aria-disabled="true"'); expect(empty).toContain('aria-label="重新檢查模型清單"');
  });
  it('marks custom ids, hides the effort row for providers without a verified control and explains disabled seats', () => {
    expect(render('claude', { model: 'my-private-id', effort: 'low' })).toContain('自訂');
    for (const provider of ['gemini', 'grok'] as const) { const html = render(provider, { model: 'x-1' }); expect(html).toContain('CLI 預設'); expect(html).not.toContain('type="radio"'); }
    const blocked = render('claude', { disabled: true, disabledReason: 'CLI 尚未就緒' });
    expect(blocked).toContain('aria-disabled="true"'); expect(blocked).toContain('CLI 尚未就緒'); expect(blocked).toContain('tabindex="-1"');
  });
  it('renders demonstration mode as a read-only trigger with the fixed demo model', () => {
    const html = render('codex', { demo: true, effort: 'medium' });
    expect(html).toContain('demo-codex'); expect(html).toContain('示範'); expect(html).toContain('aria-disabled="true"'); expect(html).not.toContain('type="radio"'); expect(html).toContain('medium');
  });
});
