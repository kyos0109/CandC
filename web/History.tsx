import { useEffect, useState, type CSSProperties } from 'react';
import { translate, dateLocale } from './i18n.js';
import { discussionName, statusText, type DiscussionIndex } from './api';
import type { DiscussionSummary, Folder, ManagementAction } from '../src/management.js';

export type HistoryAction = ManagementAction | 'delete';
export const folderLabels = () => ({ active: translate('一般'), archived: translate('已封存'), trash: translate('垃圾桶') });
export function History({ index, folder, setFolder, query, setQuery, before, setBefore, setPage, selected, select, busy, act, emptyTrash }: {
  index: DiscussionIndex; folder: Folder; setFolder: (value: Folder) => void; query: string; setQuery: (value: string) => void;
  before: string; setBefore: (value: string) => void; setPage: (value: number) => void; selected: string | null;
  select: (id: string) => void; busy: boolean; act: (action: HistoryAction, items: DiscussionSummary[]) => void; emptyTrash: () => void;
}) {
  const [managing, setManaging] = useState(false), [checked, setChecked] = useState<string[]>([]), [menu, setMenu] = useState<string | null>(null);
  useEffect(() => { setChecked([]); setMenu(null); }, [folder, index.page, query, before]);
  useEffect(() => { setChecked(ids => ids.filter(id => index.items.some(item => item.id === id))); }, [index.items]);
  const labels = folderLabels(), chosen = index.items.filter(item => checked.includes(item.id));
  const actions: Array<[HistoryAction, string]> = folder === 'active' ? [['archive', translate('封存')], ['trash', translate('移到垃圾桶')]] :
    folder === 'archived' ? [['unarchive', translate('取消封存')], ['trash', translate('移到垃圾桶')]] : [['restore', translate('還原')], ['delete', translate('永久刪除')]];
  const day = (iso: string) => { const date = new Date(iso), now = new Date(); const delta = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000);
    return delta < 1 ? translate('今天') : delta < 2 ? translate('昨天') : delta < 7 ? translate('近 7 天') : translate('更早'); };
  const time = (iso: string) => { const date = new Date(iso), label = day(iso); return label === translate('今天') ? date.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', hour12: false }) : label !== translate('更早') ? date.toLocaleDateString(dateLocale(), { weekday: 'short' }) : `${date.getMonth() + 1}/${date.getDate()}`; };
  const groups = new Map<string, DiscussionSummary[]>(); for (const item of index.items) { const label = day(item.lastActivityAt); groups.set(label, [...groups.get(label) ?? [], item]); }
  return <>
    <div className="history-folders" role="group" aria-label={translate('對話分類')}>{(['active', 'archived', 'trash'] as const).map(value => <button key={value} aria-pressed={folder === value} onClick={() => setFolder(value)}>{labels[value]}<small>{index.counts[value]}</small></button>)}</div>
    <input className="history-filter" type="search" aria-label={translate('篩選討論紀錄')} placeholder={translate('篩選討論…')} value={query} onChange={e => setQuery(e.target.value)}/>
    <div className="history-tools"><button aria-pressed={managing} onClick={() => { setManaging(!managing); setChecked([]); if (managing) setBefore(''); }}>{managing ? translate('完成管理') : translate('管理對話')}</button>{folder === 'trash' && <button disabled={busy || !index.counts.trash} onClick={emptyTrash}>{translate('清空垃圾桶')}</button>}</div>
    {managing && <div className="history-bulk"><label><input type="checkbox" aria-label={translate('選取本頁')} checked={!!index.items.length && checked.length === index.items.length} onChange={e => setChecked(e.target.checked ? index.items.map(i => i.id) : [])}/>{translate('選取本頁')}</label>
      <label className="history-date">{translate('活動日期早於')}<input type="date" aria-label={translate('活動日期早於')} value={before} onChange={e => setBefore(e.target.value)}/></label>
      <span>{translate('已選取 {0} 筆', chosen.length)}</span><div className="history-tools">{actions.map(([action, label]) => <button key={action} disabled={busy || !chosen.length} onClick={() => act(action, chosen)}>{label}</button>)}</div></div>}
    <nav aria-label={translate('討論紀錄')}>{!index.items.length ? <div className="empty-history"><strong>{index.counts[folder] ? translate('沒有符合的討論。') : folder === 'active' ? translate('還沒有討論') : folder === 'archived' ? translate('沒有已封存的對話') : translate('垃圾桶是空的')}</strong></div> : [...groups].map(([label, items]) => <div className="history-group" key={label}><div className="sidebar-label">{label}</div>{items.map(item => <div className="history-row" key={item.id}>
      {managing && <input type="checkbox" aria-label={translate('選取 {0}', discussionName(item))} checked={checked.includes(item.id)} onChange={e => setChecked(ids => e.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))}/>}
      <button className={'history-item ' + (selected === item.id ? 'selected' : '')} onClick={() => select(item.id)}><i className={'history-dot ' + (item.storage || item.status === 'indeterminate' ? 'warn' : item.status === 'running' ? 'running' : item.outcome ? 'done' : '')} aria-hidden="true"/><span className="history-topic" title={item.topic}>{discussionName(item)}</span><small>{item.behaviorVersion === 3 && <span className="history-seats" aria-hidden="true">{item.participants.map(p => <i key={p.id} style={{ '--dot': `var(--${p.provider})` } as CSSProperties}/>)}</span>}{item.backend === 'fake' ? translate('示範 · ') : ''}{item.behaviorVersion === 3 ? translate('{0} 座位{1} · ', item.participants.length, item.moderator ? translate(' ＋ 主持') : '') : translate('雙方 · ')}{item.outcome ? item.outcome === 'selection' ? translate('評選完成') : item.outcome === 'moderator' ? translate('主持裁決') : translate('結果已確認') : statusText[item.status]} · {time(item.lastActivityAt)}</small></button>
      <button className="icon-button history-menu-toggle" aria-label={translate('管理 {0}', discussionName(item))} aria-expanded={menu === item.id} onClick={() => setMenu(menu === item.id ? null : item.id)}>···</button>
      {menu === item.id && <div className="history-menu">{actions.map(([action, title]) => <button key={action} disabled={busy || !!item.storage || item.runtime || item.status === 'running'} onClick={() => { setMenu(null); act(action, [item]); }}>{title}</button>)}</div>}
    </div>)}</div>)}</nav>
    {index.total > index.limit && <div className="history-pagination"><button disabled={index.page === 1} aria-label={translate('上一頁')} onClick={() => setPage(index.page - 1)}>‹</button><span>{index.page} / {Math.ceil(index.total / index.limit)}</span><button disabled={index.page * index.limit >= index.total} aria-label={translate('下一頁')} onClick={() => setPage(index.page + 1)}>›</button></div>}
  </>;
}
