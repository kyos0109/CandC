import { useId, useMemo, type CSSProperties } from 'react';
import type { ProviderId } from '../../src/room-contract.js';
import { Icon } from '../Icon.js';
import { SeatAvatar } from '../SeatAvatar.js';
import { PROVIDERS, providerNames, providerSeat } from '../seats.js';
import { useListbox } from './useListbox.js';

type Status = { label: string; ready: boolean };
type Props = { label: string; value: ProviderId; onChange: (provider: ProviderId) => void; status?: ((provider: ProviderId) => Status) | undefined; disabled?: boolean | undefined };

/**
 * Which AI sits in a seat. Same popover and keyboard behaviour as the model picker; when `status` is given each row says whether
 * that provider's CLI is ready, so an unusable choice explains itself before it is made.
 */
export function ProviderPicker({ label, value, onChange, status, disabled = false }: Props) {
  const id = useId(), listId = `${id}-list`, selected = PROVIDERS.indexOf(value);
  const labels = useMemo(() => PROVIDERS.map(p => providerNames[p]), []);
  const box = useListbox({ id, count: PROVIDERS.length, labels, selected, disabled, onCommit: index => { onChange(PROVIDERS[index]!); box.close(); } });
  const current = status?.(value), dot = { '--dot': `var(--${value})` } as CSSProperties;
  return <div className="model-picker pp" ref={box.root}>
    <div className="mp-field">
      <div ref={box.trigger} className={'mp-trigger' + (box.open ? ' open' : '')} role="combobox" tabIndex={disabled ? -1 : 0} aria-label={`${label} 供應商`} aria-haspopup="listbox" aria-expanded={box.open} aria-controls={listId}
        aria-disabled={disabled || undefined} aria-activedescendant={box.open ? box.optionId(box.active) : undefined} onClick={box.toggle} onKeyDown={box.onKeyDown}>
        <span className="mp-dot" style={dot} aria-hidden="true"/>
        <span className="mp-text"><b>{providerNames[value]}</b></span>
        {current && <i className={'pp-status ' + (current.ready ? 'ok' : 'warn')} aria-hidden="true"/>}
        <Icon name="chevron"/>
      </div>
      {box.open && <>
        <div className="mp-scrim" aria-hidden="true" onPointerDown={() => box.close(false)}/>
        <div className={'mp-pop' + (box.up ? ' up' : '')}>
          <ul id={listId} className="mp-list" role="listbox" aria-label={`${label} 供應商清單`}>
            {PROVIDERS.map((provider, index) => { const info = status?.(provider);
              return <li key={provider} id={box.optionId(index)} role="option" aria-selected={index === selected} className={'mp-option pp-option' + (index === box.active ? ' active' : '') + (index === selected ? ' selected' : '')}
                onPointerMove={() => box.setActive(index)} onClick={() => { onChange(provider); box.close(); }}>
                <span className="mp-check">{index === selected && <Icon name="check"/>}</span>
                <SeatAvatar seat={providerSeat(provider)} size="sm"/>
                <span className="mp-opt-text"><b>{providerNames[provider]}</b>{info && <code className={info.ready ? '' : 'warn'}>{info.label}</code>}</span>
              </li>; })}
          </ul>
        </div>
      </>}
    </div>
  </div>;
}
