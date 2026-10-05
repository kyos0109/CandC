import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ProviderId } from '../../src/room-contract.js';
import type { Models } from '../api.js';
import { Icon } from '../Icon.js';
import { modelOptions, settingsAfterModel, supportedEfforts, type Effort } from '../providers.js';
import { useListbox } from './useListbox.js';

export type ModelValue = { model: string; effort: Effort | null };
type Props = { provider: ProviderId; label: string; value: ModelValue; models: Models; onChange: (next: ModelValue) => void;
  disabled?: boolean | undefined; disabledReason?: string | undefined; demo?: boolean | undefined; onRetry?: (() => void) | undefined };

/**
 * One model + effort control for every provider, so Codex and Claude look and behave the same.
 * Keyboard and popover behaviour come from useListbox. Providers without a closed catalogue add a "custom id" row.
 * The control keeps one fixed height in every state.
 */
export function ModelPicker({ provider, label, value, models, onChange, disabled = false, disabledReason, demo = false, onRetry }: Props) {
  const { options, custom } = useMemo(() => modelOptions(provider, models), [provider, models]);
  const id = useId(), listId = `${id}-list`;
  const [customMode, setCustomMode] = useState(false), [draft, setDraft] = useState('');
  const customInput = useRef<HTMLInputElement>(null);
  const rows = options.length + (custom ? 1 : 0), selected = options.findIndex(o => o.id === value.model), current = selected >= 0 ? options[selected] : undefined;
  const catalogueMissing = !custom && options.length === 0, unavailable = disabled || demo || catalogueMissing;
  const labels = useMemo(() => [...options.map(o => o.label), ...(custom ? ['自訂模型識別'] : [])], [options, custom]);

  const choose = (model: string) => { onChange(settingsAfterModel(provider, models, value.effort, model)); box.close(); };
  const commit = (index: number) => { if (index < options.length) choose(options[index]!.id); else { setDraft(selected < 0 ? value.model : ''); setCustomMode(true); } };
  const applyCustom = () => { const model = draft.trim(); if (model && model.length <= 160) choose(model); };
  const box = useListbox({ id, count: rows, labels, selected, disabled: unavailable, listVisible: !customMode, onCommit: commit,
    onOpen: () => { setDraft(selected < 0 ? value.model : ''); setCustomMode(options.length === 0 && custom); } });
  useEffect(() => { if (customMode) customInput.current?.focus(); }, [customMode]);

  const efforts = demo ? [] : supportedEfforts(provider, value.model, models);
  // Codex shows disabled placeholders until a model is chosen, so the row never changes height.
  const shown: readonly Effort[] = efforts.length ? efforts : !demo && provider === 'codex' ? ['low', 'medium', 'high'] : [];
  const marked = value.effort ? shown.indexOf(value.effort) : -1;
  const placeholder = disabledReason ?? (catalogueMissing ? '模型清單尚未取得' : '請選擇模型');
  const name = demo ? `demo-${provider}` : current?.label ?? value.model;
  const dot = { '--dot': `var(--${provider})` } as CSSProperties;

  return <div className="model-picker" ref={box.root}>
    <div className="mp-field">
      <div ref={box.trigger} className={'mp-trigger' + (box.open ? ' open' : '')} role="combobox" tabIndex={unavailable ? -1 : 0} aria-label={`${label} 模型`} aria-haspopup="listbox" aria-expanded={box.open} aria-controls={listId}
        aria-disabled={unavailable || undefined} aria-required={unavailable ? undefined : true} aria-activedescendant={box.open && !customMode ? box.optionId(box.active) : undefined} title={disabledReason}
        onClick={box.toggle} onKeyDown={box.onKeyDown}>
        <span className="mp-dot" style={dot} aria-hidden="true"/>
        <span className="mp-text">{name ? <><b>{name}</b>{!demo && current && current.id !== current.label && <code>{current.id}</code>}</> : <em>{placeholder}</em>}</span>
        {demo ? <span className="mp-tag">示範</span> : name && !current && <span className="mp-tag">自訂</span>}
        <Icon name="chevron"/>
      </div>
      {catalogueMissing && onRetry && <button type="button" className="mp-retry" aria-label="重新檢查模型清單" onClick={onRetry}><Icon name="refresh"/></button>}
      {box.open && <>
        <div className="mp-scrim" aria-hidden="true" onPointerDown={() => box.close(false)}/>
        <div className={'mp-pop' + (box.up ? ' up' : '')}>
          {customMode ? <form className="mp-custom" onSubmit={event => { event.preventDefault(); applyCustom(); }}>
            <label htmlFor={`${id}-custom`}>自訂模型識別</label>
            <input id={`${id}-custom`} className="mp-input" ref={customInput} aria-label={`${label} 自訂模型識別`} maxLength={160} value={draft} placeholder="輸入 CLI 可用的完整模型識別" autoComplete="off" spellCheck={false}
              onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (options.length) { setCustomMode(false); box.trigger.current?.focus(); } else box.close(); } }}/>
            <div className="mp-custom-actions">{options.length > 0 && <button type="button" className="mp-ghost" onClick={() => { setCustomMode(false); box.trigger.current?.focus(); }}>回到清單</button>}<button type="submit" className="mp-apply" disabled={!draft.trim()}>套用</button></div>
          </form> : <ul id={listId} className="mp-list" role="listbox" aria-label={`${label} 模型清單`}>
            {options.map((option, index) => <li key={option.id} id={box.optionId(index)} role="option" aria-selected={index === selected} className={'mp-option' + (index === box.active ? ' active' : '') + (index === selected ? ' selected' : '')}
              onPointerMove={() => box.setActive(index)} onClick={() => commit(index)}>
              <span className="mp-check">{index === selected && <Icon name="check"/>}</span>
              <span className="mp-opt-text"><b>{option.label}</b>{option.id !== option.label && <code>{option.id}</code>}</span>
            </li>)}
            {custom && <>
              {options.length > 0 && <li role="presentation" className="mp-sep" aria-hidden="true"/>}
              <li id={box.optionId(options.length)} role="option" aria-selected={false} className={'mp-option custom' + (box.active === options.length ? ' active' : '')} onPointerMove={() => box.setActive(options.length)} onClick={() => commit(options.length)}>
                <span className="mp-check"><Icon name="plus"/></span><span className="mp-opt-text"><b>自訂模型識別…</b></span>
              </li>
            </>}
          </ul>}
        </div>
      </>}
    </div>
    {shown.length === 0 ? <div className="mp-effort static" role="group" aria-label={`${label} 思考程度`}><span>{demo ? value.effort ?? '—' : 'CLI 預設'}</span></div>
      : <div className="mp-effort" role="radiogroup" aria-label={`${label} 思考程度`} data-empty={marked < 0 ? '' : undefined} style={{ '--n': shown.length, '--i': Math.max(0, marked) } as CSSProperties}>
        <span className="mp-thumb" aria-hidden="true"/>
        {shown.map(effort => <label key={effort}><input type="radio" name={`${id}-effort`} value={effort} checked={value.effort === effort} disabled={unavailable || !efforts.length} onChange={() => onChange({ ...value, effort })}/><span>{effort}</span></label>)}
      </div>}
  </div>;
}
