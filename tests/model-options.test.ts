import { describe, expect, it } from 'vitest';
import { modelOptions, settingsAfterModel, supportedEfforts, validModelSettings } from '../web/providers.js';
import type { Models } from '../web/api.js';

const models: Models = {
  codex: [{ id: 'gpt-x', label: 'GPT X', efforts: ['low', 'medium', 'high', 'xhigh'] }, { id: 'gpt-mini', label: 'GPT Mini', efforts: ['low', 'high'] }, { id: 'odd', label: 'Odd', efforts: ['turbo'] }],
  claude: ['sonnet', 'opus'], gemini: [], grok: [], error: null,
};

describe('model choices behind the shared picker', () => {
  it('treats Codex as a closed catalogue and the others as suggestions plus a custom id', () => {
    expect(modelOptions('codex', models)).toEqual({ custom: false, options: [
      { id: 'gpt-x', label: 'GPT X', efforts: ['low', 'medium', 'high', 'xhigh'] }, { id: 'gpt-mini', label: 'GPT Mini', efforts: ['low', 'high'] }, { id: 'odd', label: 'Odd', efforts: [] }] });
    const claude = modelOptions('claude', models);
    expect(claude.custom).toBe(true); expect(claude.options.map(o => [o.id, o.label])).toEqual([['sonnet', 'Sonnet'], ['opus', 'Opus']]);
    for (const provider of ['gemini', 'grok'] as const) expect(modelOptions(provider, models)).toEqual({ options: [], custom: true });
  });
  it('reads efforts per model for Codex, a fixed set without xhigh for Claude and none for unverified providers', () => {
    expect(supportedEfforts('codex', 'gpt-mini', models)).toEqual(['low', 'high']);
    expect(supportedEfforts('codex', 'missing', models)).toEqual([]);
    expect(supportedEfforts('claude', 'anything-custom', models)).toEqual(['low', 'medium', 'high', 'max']);
    expect(supportedEfforts('gemini', 'g', models)).toEqual([]); expect(supportedEfforts('grok', 'g', models)).toEqual([]);
  });
  it('keeps a still-supported effort, otherwise prefers medium, then the first supported one', () => {
    expect(settingsAfterModel('codex', models, 'high', 'gpt-x')).toEqual({ model: 'gpt-x', effort: 'high' });
    expect(settingsAfterModel('codex', models, 'xhigh', 'gpt-mini')).toEqual({ model: 'gpt-mini', effort: 'low' });
    expect(settingsAfterModel('codex', models, null, 'gpt-x')).toEqual({ model: 'gpt-x', effort: 'medium' });
    expect(settingsAfterModel('claude', models, 'max', 'my-custom-id')).toEqual({ model: 'my-custom-id', effort: 'max' });
    expect(settingsAfterModel('claude', models, 'xhigh', 'sonnet')).toEqual({ model: 'sonnet', effort: 'medium' });
    expect(settingsAfterModel('gemini', models, 'medium', 'g-1')).toEqual({ model: 'g-1', effort: null });
  });
  it('applies the creation rules: a model is required, Codex must come from the catalogue and Claude needs a supported effort', () => {
    expect(validModelSettings('codex', models, { model: 'gpt-x', effort: 'xhigh' })).toBe(true);
    expect(validModelSettings('codex', models, { model: 'gpt-mini', effort: 'medium' })).toBe(false);
    expect(validModelSettings('codex', models, { model: 'invented', effort: 'low' })).toBe(false);
    expect(validModelSettings('claude', models, { model: 'sonnet', effort: 'medium' })).toBe(true);
    expect(validModelSettings('claude', models, { model: 'sonnet', effort: null })).toBe(false);
    expect(validModelSettings('claude', models, { model: 'sonnet', effort: 'xhigh' })).toBe(false);
    expect(validModelSettings('gemini', models, { model: ' ', effort: null })).toBe(false);
    expect(validModelSettings('grok', models, { model: 'grok-4', effort: null })).toBe(true);
  });
});
