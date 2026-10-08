import { useState, type ReactNode } from 'react';
import type { RoomDiscussion } from '../src/room-contract.js';
import type { Progress } from './DiscussionView.js';
import { api, operation, discussionName, reasonText, statusText } from './api.js';
import { translate, useLocale } from './i18n.js';
import { RoomDiagnostics } from './RoomDiagnostics.js';
import { seatViews } from './seats.js';

export function SelectionView({ state, busy, perform, historyToggle, controls, progress }: {
  state: RoomDiscussion; busy: boolean; perform: (action: () => Promise<unknown>) => Promise<void>;
  historyToggle: ReactNode; controls: ReactNode; progress: Progress | null;
}) {
  useLocale();
  const [diagnostics, setDiagnostics] = useState(false);
  const [duration, setDuration] = useState(Math.ceil(state.limits.maxDurationMs / 60_000));
  const selection = state.room.selection!, set = selection.optionSet, complete = selection.phase === 'complete';
  const readOnly = state.management !== undefined && state.management.folder !== 'active';
  const active = state.status === 'running', terminal = ['stopped', 'indeterminate'].includes(state.status);
  const locked = readOnly || busy || !!state.storage || state.activity !== null;
  const name = (id: string) => state.participants.find(p => p.id === id)?.label ?? id;
  const command = (action: string) => perform(() => operation(state.id, action));
  return <section className="discussion room-discussion selection-shell">
    <header className="discussion-heading">{historyToggle}<div className="heading-name"><h1>{discussionName(state)}</h1><small>{translate('選項評選')}{state.backend === 'fake' ? translate(' · 示範') : ''}</small></div><div className="header-controls">{controls}</div></header>
    {!readOnly && <div className="selection-actions">
          {active ? <><button disabled={busy} onClick={() => void command('pause')}>{translate('暫停')}</button><button disabled={busy} onClick={() => void command('stop')}>{translate('停止')}</button></> :
            !complete && !terminal && <button className="primary" disabled={locked} onClick={() => void command('start')}>{translate('繼續未完成評選')}</button>}
          {terminal && !state.storage && <button disabled={locked} onClick={() => void perform(() => api(`/api/discussions/${state.id}/rebuild`, 'POST', { operationId: crypto.randomUUID(), expectedVersion: state.room.taskVersion }))}>{translate('重建工作階段')}</button>}
          {state.storage && <><button disabled={busy} onClick={() => void perform(() => api(`/api/discussions/${state.id}/recover`, 'POST', { repairTail: false }))}>{translate('驗證保存並復原')}</button><button disabled={busy} onClick={() => void perform(() => api(`/api/discussions/${state.id}/recover`, 'POST', { repairTail: true }))}>{translate('修復殘缺尾端並驗證（保留備份）')}</button></>}
        </div>}
    <div className="room-page"><div className="room-page-inner">
      <section className="surface-card padded" aria-label={translate('評選進度')}>
        <h2>{complete ? translate('AI 評選結果') : set ? translate('獨立評分中') : translate('產生選項與標準')}</h2>
        <p role="status">{translate('已完成 {0}／{1} 位評審', selection.ratings.length, state.participants.length)}</p>
        <p>{translate('三項標準等權，各評審等權，0～10 分。結果是模型評估，不代表已證實的最佳答案或全體共識。')}</p>
        {!complete && <p>{translate('所有評審完成前，不公布最終排名。')}</p>}
        <ul>{state.participants.map(p => <li key={p.id}>{name(p.id)} · {p.provider} · {p.settings.model} — {selection.ratings.some(r => r.actor === p.id) ? translate('完成') : translate('待評分')}</li>)}</ul>
        {state.storage ? <p role="alert">{translate('未確認保存 · 已停止所有 AI 排程')}</p> : !complete && <p>{statusText[state.status]} · {reasonText(state.pauseReason)}</p>}
        {active && progress?.preview && <details><summary>{translate('生成中的回覆（尚未確認保存）')}</summary><p>{progress.preview}</p></details>}
        {!complete && !readOnly && <details><summary>{translate('調整評選時間上限')}</summary><form onSubmit={e => { e.preventDefault(); void perform(() => api(`/api/discussions/${state.id}`, 'PATCH', { expectedVersion: state.room.configurationVersion, limits: { maxRounds: state.limits.maxRounds, turnTimeoutMs: state.limits.turnTimeoutMs, maxDurationMs: duration * 60_000 } })); }}>
          <label>{translate('總時間（分鐘）')}<input type="number" min={1} max={1440} required value={duration} onChange={e => setDuration(e.target.valueAsNumber)}/></label><button disabled={locked}>{translate('儲存')}</button>
        </form></details>}
      </section>
      {complete && selection.result && <section className="surface-card padded" aria-label={translate('最終排名')}>
        <h2>{translate('最高分選項')}</h2><p>{selection.result.filter(r => r.rank === 1).map(r => set!.options.find(o => o.id === r.optionId)!.title).join(' / ')}</p>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>{translate('名次')}</th><th>{translate('選項')}</th><th>{translate('平均分數')}</th></tr></thead><tbody>{selection.result.map(r => <tr key={r.optionId}><td>{r.rank}</td><td>{set!.options.find(o => o.id === r.optionId)!.title}</td><td>{r.average.toFixed(2)} / 10</td></tr>)}</tbody></table></div>
        <p>{translate('同分並列，不額外決勝。')}</p>
      </section>}
      {set && <>
        <section className="surface-card padded"><h2>{translate('共同評分標準')}</h2><ol>{set.criteria.map(c => <li key={c.id}><strong>{c.title}</strong><p>{c.description}</p></li>)}</ol></section>
        <section className="surface-card padded"><h2>{translate('候選選項')}</h2>{set.options.map(o => <article key={o.id}><h3>{o.title}</h3><p>{o.description}</p></article>)}</section>
        <section className="surface-card padded"><h2>{translate('各評審分數與理由')}</h2><div className="table-wrap"><table className="data-table"><thead><tr><th>{translate('選項')}</th>{state.participants.map(p => <th key={p.id}>{name(p.id)}</th>)}</tr></thead><tbody>{set.options.map(o => <tr key={o.id}><th>{o.title}</th>{state.participants.map(p => { const rating = selection.ratings.find(r => r.actor === p.id); return <td key={p.id}>{rating ? (rating.scores.filter(s => s.optionId === o.id).reduce((sum, s) => sum + s.score, 0) / 3).toFixed(2) : '—'}</td>; })}</tr>)}</tbody></table></div>
          {selection.ratings.map(r => <details key={r.actor}><summary>{name(r.actor)}</summary>{set.options.map(o => <article key={o.id}><h3>{o.title}</h3><ul>{r.scores.filter(s => s.optionId === o.id).map(s => <li key={s.criterionId}><strong>{set.criteria.find(c => c.id === s.criterionId)!.title}: {s.score} / 10</strong><p>{s.reason}</p></li>)}</ul></article>)}{r.limitations.length > 0 && <><h3>{translate('限制與不確定性')}</h3><ul>{r.limitations.map((text, i) => <li key={i}>{text}</li>)}</ul></>}</details>)}
        </section>
      </>}
      <section className="surface-card padded"><a href={`/api/discussions/${state.id}/export?format=markdown`}>{translate('匯出 Markdown')}</a>{' · '}<a href={`/api/discussions/${state.id}/export?format=json`}>{translate('匯出 JSON')}</a></section>
      <details className="surface-card padded"><summary>{translate('已保存回覆')}</summary>{state.messages.map(m => <article key={m.id}><h3>{name(m.sender)}</h3><p>{m.text}</p></article>)}</details>
      <button onClick={() => setDiagnostics(value => !value)} aria-expanded={diagnostics}>{translate('診斷')}</button>
      {diagnostics && <RoomDiagnostics state={state} seats={seatViews(state)}/>}
    </div></div>
  </section>;
}
