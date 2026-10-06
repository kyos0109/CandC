import { translate, dateLocale, useLocale, systemMessage } from './i18n.js';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, operation, statusText, discussionName, type AnyDiscussion as Discussion, type EnvironmentStatus, type Models } from './api';
import { RoomNewDiscussion } from './RoomNewDiscussion';
import { RoomView } from './RoomView';
import type { RoomInput } from '../src/room-contract';
import { DiscussionView, type Progress } from './DiscussionView';
import { ReadingControls } from './ReadingControls';
import { ConnectionsPage } from './ConnectionsPage';
import { providerAvailability, readyProviders } from './providers';
import { Icon } from './Icon';
import { PROVIDERS } from './seats';
import { Inspector, useNarrow } from './Inspector';

// History is sorted, grouped and timed by last saved activity, so the shown time is never mistaken for a pause time.
const lastActivity = (item: Discussion) => item.messages.at(-1)?.createdAt ?? item.createdAt;
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const daysAgo = (iso: string) => Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86_400_000);
function historyGroups(list: Discussion[]) {
  const groups = new Map<string, Discussion[]>();
  for (const item of list) { const days = daysAgo(lastActivity(item)), label = days < 1 ? translate("今天") : days < 2 ? translate("昨天") : days < 7 ? translate("近 7 天") : translate("更早"); groups.set(label, [...groups.get(label) ?? [], item]); }
  return [...groups];
}
function historyTime(iso: string) {
  const date = new Date(iso), days = daysAgo(iso);
  return days < 1 ? date.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', hour12: false }) : days < 7 ? date.toLocaleDateString(dateLocale(), { weekday: 'short' }) : `${date.getMonth() + 1}/${date.getDate()}`;
}

export function App() {
  useLocale();
  const [list, setList] = useState<Discussion[]>([]), [historyFilter, setHistoryFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem('candc-discussion'));
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  const [models, setModels] = useState<Models>({ codex: [], claude: [], error: null });
  const [readingMode, setReadingMode] = useState<'highlights' | 'full'>(() => localStorage.getItem('candc-reading-mode') === 'full' ? 'full' : 'highlights');
  useEffect(() => { localStorage.setItem('candc-reading-mode', readingMode); }, [readingMode]);
  const [storageIssues, setStorageIssues] = useState<Array<{ id: string; reason: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [connected, setConnected] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const renewingSession = useRef(false);
  const mounted = useRef(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('candc-sidebar-collapsed') === 'true');
  useEffect(() => { localStorage.setItem('candc-sidebar-collapsed', String(sidebarCollapsed)); }, [sidebarCollapsed]);
  const overlayInspector = useNarrow('(max-width: 1279px)');
  const mobile = useNarrow('(max-width: 767px)');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [panel, setPanel] = useState<string | null>(null);
  const [page, setPage] = useState<'main' | 'connections'>('main');
  const toggleHistory = () => mobile ? setHistoryOpen(value => !value) : setSidebarCollapsed(value => !value);
  const selectDiscussion = (id: string | null) => { setSelected(id); setHistoryOpen(false); setPanel(null); setPage('main'); };
  const openConnections = () => { setHistoryOpen(false); setPanel(null); setPage('connections'); };
  const refresh = useCallback(async () => { const states = await api<Discussion[]>('/api/discussions'); const issues = await api<Array<{ id: string; reason: string }>>('/api/storage-issues'); if (mounted.current) setStorageIssues(issues); if (mounted.current) setList(states.sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)))); }, []);
  const check = useCallback(async () => { setChecking(true); try { const result = await api<EnvironmentStatus>('/api/environment'); setEnvironment(result); const catalog = await api<Models>('/api/models'); setModels(catalog); } catch (e) { setError(e instanceof Error ? e.message : translate("無法檢查環境。")); } finally { setChecking(false); } }, []);
  useEffect(() => { mounted.current = true; void (async () => { try { await api('/api/session'); await refresh(); if (mounted.current) setSessionReady(true); void check(); } catch (e) { setError(e instanceof Error ? e.message : translate("無法連線到程式。")); } finally { setLoading(false); } })(); return () => { mounted.current = false; }; }, [refresh, check]);
  useEffect(() => { if (selected) localStorage.setItem('candc-discussion', selected); else localStorage.removeItem('candc-discussion'); }, [selected]);
  // Keep every running conversation subscribed while browsing history, so changing the view does not pause it.
  const state = list.find((item) => item.id === selected);
  const subscribed = [...new Set([...(state ? [state.id] : []), ...list.filter((s) => s.status === 'running').map((s) => s.id)])].sort().join(',');
  useEffect(() => {
    if (!sessionReady) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let renewalTimer: ReturnType<typeof setTimeout> | undefined;
    const sources = subscribed.split(',').filter(Boolean).map((id) => {
      const source = new EventSource(`/api/discussions/${id}/events`);
      source.onopen = () => setConnected(true);
      source.onerror = (event) => {
        if ('data' in event) return;
        setConnected(false);
        if (source.readyState === EventSource.CLOSED && !renewingSession.current && !renewalTimer) {
          renewalTimer = setTimeout(() => {
            renewingSession.current = true;
            void api('/api/session').then(refresh).then(() => {
              if (mounted.current) setSessionGeneration(value => value + 1);
            }).catch(() => setConnected(false)).finally(() => { renewingSession.current = false; });
          }, 1000);
        }
      };
      for (const event of ['created', 'state', 'session', 'message', 'error', 'recovered', 'evidence']) source.addEventListener(event, () => { clearTimeout(timer); timer = setTimeout(() => void refresh().catch(() => setConnected(false)), 60); });
      source.addEventListener('progress', (event) => { if (JSON.parse((event as MessageEvent).data).data.storage) void refresh(); if (id === selected) setProgress(JSON.parse((event as MessageEvent).data).data); });
      return source;
    });
    return () => { clearTimeout(timer); clearTimeout(renewalTimer); sources.forEach((source) => source.close()); };
  }, [subscribed, selected, refresh, sessionReady, sessionGeneration]);
  useEffect(() => {
    // Poll as a fallback for browser hosts that buffer or interrupt SSE.
    if (!selected || (connected && state?.status !== 'running')) return;
    const interval = setInterval(() => void refresh().catch(() => undefined), 2000);
    return () => clearInterval(interval);
  }, [selected, connected, state?.status, refresh]);
  useEffect(() => { if (state?.status !== 'running') setProgress(null); }, [selected, state?.status]);
  const perform = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : translate("操作失敗。")); await refresh().catch(() => undefined); } finally { setBusy(false); } };
  // The sides of a debate were chosen on the creation form, so creating it is the confirmation: confirm them, then start like any other discussion.
  const create = async (input: RoomInput) => perform(async () => { const id = crypto.randomUUID(); const created = await api<Discussion>('/api/discussions', 'POST', { id, input }); setList((current) => [created, ...current]); setSelected(id); setPage('main');
    if (input.kind === 'debate' && created.behaviorVersion === 3) await api(`/api/discussions/${id}`, 'PATCH', { confirmRoles: true, expectedVersion: created.room.configurationVersion });
    await operation(id, 'start'); });
  const needle = historyFilter.trim().toLowerCase(), visibleList = needle ? list.filter(item => `${discussionName(item)} ${item.topic}`.toLowerCase().includes(needle)) : list;
  const history = <><a className="brand" href="#" onClick={e => { e.preventDefault(); selectDiscussion(null); }}>CandC<span>{translate("多 AI 討論室")}</span></a>
    <button className="new-button" onClick={() => selectDiscussion(null)}><Icon name="plus"/>{translate("新討論")}</button>
    {list.length >= 6 && <input className="history-filter" type="search" aria-label={translate("篩選討論紀錄")} placeholder={translate("篩選討論…")} value={historyFilter} onChange={e => setHistoryFilter(e.target.value)}/>}
    <nav aria-label={translate("討論紀錄")}>{list.length === 0 ? <div className="empty-history"><strong>{storageIssues.length ? translate("部分紀錄未確認保存") : translate("還沒有討論")}</strong><span>{storageIssues.length ? translate("請查看復原警示。") : translate("從新討論開始：寫下題目，讓幾個 AI 一起討論。")}</span></div> : visibleList.length === 0 ? <p className="empty-history">{translate("沒有符合的討論。")}</p> : historyGroups(visibleList).map(([label, items]) => <div className="history-group" key={label}><div className="sidebar-label">{label}</div>{items.map(item => <button className={'history-item ' + (selected === item.id ? 'selected' : '')} key={item.id} onClick={() => selectDiscussion(item.id)}><i className={'history-dot ' + (item.storage || item.status === 'indeterminate' ? 'warn' : item.status === 'running' ? 'running' : (item.behaviorVersion === 3 ? item.room.outcome : item.v2?.completed) ? 'done' : '')} aria-hidden="true"/><span className="history-topic" title={item.topic}>{discussionName(item)}</span><small>{item.behaviorVersion === 3 && <span className="history-seats" aria-hidden="true">{item.participants.map((p, i) => <i key={i} style={{ '--dot': `var(--${p.provider})` } as CSSProperties}/>)}</span>}{item.backend === 'fake' ? translate("示範 · ") : ''}{item.behaviorVersion === 3 ? translate("{0} 座位{1} · ", item.participants.length, item.moderator ? translate(" ＋ 主持") : '') : translate("雙方 · ")}{item.behaviorVersion === 3 && item.room.outcome ? (item.room.outcome.authority === 'moderator' ? translate("主持裁決") : translate("結果已確認")) : item.v2?.completed ? translate("整場已確認") : statusText[item.status]} · {historyTime(lastActivity(item))}</small></button>)}</div>)}</nav>
    <button className={'connection-entry' + (page === 'connections' ? ' selected' : '')} aria-label={translate("連線與設定")} aria-current={page === 'connections' ? 'page' : undefined} onClick={openConnections}><span className="conn-dots" aria-hidden="true">{PROVIDERS.map(p => <i key={p} className={providerAvailability(environment, p).ready ? 'ok' : environment ? 'warn' : ''}/>)}</span>{environment ? translate("{0} / {1} 供應商就緒", readyProviders(environment), PROVIDERS.length) : translate("正在檢查連線…")}<span aria-hidden="true">⚙</span></button></>;
  const historyToggle = <button className="icon-button history-toggle" aria-label={mobile ? translate("開啟討論紀錄") : sidebarCollapsed ? translate("展開側欄") : translate("收起側欄")} aria-expanded={mobile ? historyOpen : !sidebarCollapsed} onClick={toggleHistory}>☰</button>;
  const controls = <ReadingControls readingMode={readingMode} setReadingMode={setReadingMode} open={panel === 'reading'} onToggle={() => setPanel(panel === 'reading' ? null : 'reading')}/>;
  return <div className={'app-shell ' + (sidebarCollapsed ? 'sidebar-collapsed ' : '') + (state ? 'chat-open' : '')}>
    {!mobile && !sidebarCollapsed && <aside className="sidebar">{history}</aside>}
    {mobile && historyOpen && <Inspector side="left" title={translate("討論紀錄")} modal onClose={() => setHistoryOpen(false)}>{history}</Inspector>}
    <main className={!state && panel && !overlayInspector ? 'creation-inspector-open' : ''}>
      {error && <div className="error-banner" role="alert"><span>{systemMessage(error)}</span><button aria-label={translate("關閉錯誤訊息")} onClick={() => setError('')}>×</button></div>}
      {storageIssues.filter(issue => !list.some(s => s.id === issue.id)).map(issue => <div key={issue.id} className="notice warning" role="alert">{translate("無法讀取討論")}{" "}{issue.id}：{issue.reason}{translate("。原始檔保留；未確認保存，請核對 journal，不能顯示為正常空白討論。")}<button disabled={busy} onClick={() => void perform(() => api('/api/discussions/' + issue.id + '/recover', 'POST', { repairTail: false }))}>{translate("重新驗證原始 journal")}</button></div>)}
      {!connected && <div className="notice warning">{translate("正在重新連線。若連線中斷超過 15 秒，程式會在目前發言完成後暫停。")}</div>}
      {/* Keep the current workspace mounted during connection checks so unsent input and recipients survive. */}
      <div className="workspace-page" hidden={page !== 'main'}>
        {!state && <header className="creation-header">{historyToggle}<span>{translate("本機工作空間")}</span>{controls}<button className="icon-button" onClick={openConnections}>{translate("連線")}</button></header>}
        {loading ? <div className="loading" role="status">{translate("正在載入討論室…")}</div> : state ? state.behaviorVersion === 3 ? <RoomView visible={page === 'main'} readingMode={readingMode} setReadingMode={setReadingMode} key={state.id} state={state} progress={progress} busy={busy} perform={perform} panel={page === 'main' ? panel : null} setPanel={setPanel} historyToggle={historyToggle} controls={controls}/> : <DiscussionView visible={page === 'main'} readingMode={readingMode} setReadingMode={setReadingMode} key={state.id} state={state} progress={progress} busy={busy} perform={perform} panel={page === 'main' ? panel : null} setPanel={setPanel} historyToggle={historyToggle} controls={controls} onFork={next => { setList(current => [next, ...current]); selectDiscussion(next.id); }}/>: <RoomNewDiscussion environment={environment} models={models} busy={busy} onCreate={create} onConnection={openConnections}/>}
      </div>
      {page === 'connections' && <ConnectionsPage environment={environment} models={models} checking={checking} onCheck={() => void check()} onBack={() => { setPanel(null); setPage('main'); }} historyToggle={historyToggle} controls={controls}/>}
      {(!state || page === 'connections') && panel === 'reading' && <Inspector title={translate("閱讀設定")} modal={overlayInspector} onClose={() => setPanel(null)}><ReadingControls readingMode={readingMode} setReadingMode={setReadingMode} settings/></Inspector>}
    </main></div>;
}
