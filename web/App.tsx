import { translate, useLocale, systemMessage } from './i18n.js';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api, operation, statusText, discussionName, type AnyDiscussion as Discussion, type EnvironmentStatus, type Models, type DiscussionIndex } from './api';
import { RoomNewDiscussion } from './RoomNewDiscussion';
import type { RoomInput } from '../src/room-contract';
import type { Progress } from './DiscussionView';
import { ReadingControls } from './ReadingControls';
import { providerAvailability, readyProviders } from './providers';
import { Icon } from './Icon';
import { PROVIDERS } from './seats';
import { Inspector, useNarrow } from './Inspector';
import { History, folderLabels, type HistoryAction } from './History';
import type { Folder } from '../src/management';

const RoomView = lazy(() => import('./RoomView').then(module => ({ default: module.RoomView })));
const DiscussionView = lazy(() => import('./DiscussionView').then(module => ({ default: module.DiscussionView })));
const ConnectionsPage = lazy(() => import('./ConnectionsPage').then(module => ({ default: module.ConnectionsPage })));

type ManagementTarget = { id: string; sequence: number; topic: string; displayName?: string | undefined; exportable?: boolean };
const emptyIndex: DiscussionIndex = { items: [], total: 0, page: 1, limit: 50, counts: { active: 0, archived: 0, trash: 0 }, runningIds: [], pendingDeletions: [] };

export function App() {
  useLocale();
  const [index, setIndex] = useState<DiscussionIndex>(emptyIndex), [historyFilter, setHistoryFilter] = useState('');
  const [detail, setDetail] = useState<Discussion | null>(null), [folder, setFolder] = useState<Folder>('active'), [historyPage, setHistoryPage] = useState(1), [before, setBefore] = useState('');
  const [confirmation, setConfirmation] = useState<ManagementTarget[] | null>(null), [resultNotice, setResultNotice] = useState('');
  const [undo, setUndo] = useState<{ action: HistoryAction; items: ManagementTarget[] } | null>(null), [draftEpoch, setDraftEpoch] = useState(0);
  const refreshGeneration = useRef(0);
  const detailGeneration = useRef(0), polling = useRef(false);
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem('candc-discussion'));
  const queryRef = useRef({ selected, folder, historyFilter, historyPage, before });
  queryRef.current = { selected, folder, historyFilter, historyPage, before };
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
  const selectDiscussion = (id: string | null) => { queryRef.current.selected = id; setSelected(id); setHistoryOpen(false); setPanel(null); setPage('main'); };
  const openConnections = () => { setHistoryOpen(false); setPanel(null); setPage('connections'); };
  const refreshIndex = useCallback(async () => {
    const generation = ++refreshGeneration.current, query = { ...queryRef.current };
    const params = new URLSearchParams({ folder: query.folder, q: query.historyFilter, page: String(query.historyPage), ...(query.before ? { before: new Date(query.before + 'T00:00:00').toISOString() } : {}) });
    const nextIndex = await api<DiscussionIndex>('/api/discussion-index?' + params);
    if (!mounted.current || generation !== refreshGeneration.current ||
      query.folder !== queryRef.current.folder || query.historyFilter !== queryRef.current.historyFilter ||
      query.historyPage !== queryRef.current.historyPage || query.before !== queryRef.current.before) return;
    setIndex(nextIndex);
    if (nextIndex.page !== query.historyPage) setHistoryPage(nextIndex.page);
  }, []);
  const refreshDetail = useCallback(async () => {
    const generation = ++detailGeneration.current, query = { ...queryRef.current };
    let nextDetail: Discussion | null = null;
    if (query.selected) {
      try { nextDetail = await api<Discussion>('/api/discussions/' + query.selected); }
      catch (error) { if (!(error instanceof Error) || ![translate('此對話已永久刪除。'), 'Discussion not found.'].includes(error.message)) throw error; }
    }
    if (!mounted.current || generation !== detailGeneration.current || query.selected !== queryRef.current.selected) return;
    setDetail(nextDetail);
    if (query.selected && !nextDetail) { queryRef.current.selected = null; setSelected(null); }
  }, []);
  const refreshStorage = useCallback(async () => {
    const issues = await api<Array<{ id: string; reason: string }>>('/api/storage-issues');
    if (mounted.current) setStorageIssues(issues);
  }, []);
  const refresh = useCallback(async () => { await Promise.all([refreshIndex(), refreshDetail(), refreshStorage()]); }, [refreshIndex, refreshDetail, refreshStorage]);
  const check = useCallback(async () => { setChecking(true); try { const result = await api<EnvironmentStatus>('/api/environment'); setEnvironment(result); const catalog = await api<Models>('/api/models'); setModels(catalog); } catch (e) { setError(e instanceof Error ? e.message : translate("無法檢查環境。")); } finally { setChecking(false); } }, []);
  useEffect(() => { mounted.current = true; void (async () => { try { await api('/api/session'); if (mounted.current) setSessionReady(true); void check(); } catch (e) { setError(e instanceof Error ? e.message : translate("無法連線到程式。")); } finally { setLoading(false); } })(); return () => { mounted.current = false; }; }, [check]);
  useEffect(() => { if (selected) localStorage.setItem('candc-discussion', selected); else localStorage.removeItem('candc-discussion'); }, [selected]);
  // Keep every running conversation subscribed while browsing history, so changing the view does not pause it.
  const state = detail?.id === selected ? detail : undefined;
  useEffect(() => { if (sessionReady) void refreshDetail().catch(e => setError(e instanceof Error ? e.message : translate("操作失敗。"))); }, [selected, sessionReady, refreshDetail]);
  useEffect(() => { if (sessionReady) void refreshStorage().catch(e => setError(e instanceof Error ? e.message : translate("操作失敗。"))); }, [sessionReady, refreshStorage]);
  useEffect(() => {
    if (!sessionReady) return;
    const timer = setTimeout(() => void refreshIndex().catch(e => setError(e instanceof Error ? e.message : translate("操作失敗。"))), 200);
    return () => clearTimeout(timer);
  }, [folder, historyFilter, historyPage, before, sessionReady, refreshIndex]);
  const subscribed = [...new Set([...(selected ? [selected] : []), ...index.runningIds])].sort().join(',');
  useEffect(() => {
    if (!sessionReady) return;
    if (!subscribed) { setConnected(true); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let refreshSelected = false;
    let renewalTimer: ReturnType<typeof setTimeout> | undefined;
    const ids = subscribed.split(','), opened = new Set<EventSource>();
    // Normal subscription changes are not transport failures.
    const sources = ids.map((id) => {
      const source = new EventSource(`/api/discussions/${id}/events`);
      const update = async (includeDetail = id === queryRef.current.selected) => { await Promise.all([refreshIndex(), refreshStorage(), ...(includeDetail ? [refreshDetail()] : [])]); };
      source.onopen = () => { opened.add(source); if (opened.size === ids.length) setConnected(true); };
      source.onerror = (event) => {
        if ('data' in event) return;
        opened.delete(source); setConnected(false);
        if (source.readyState === EventSource.CLOSED && !renewingSession.current && !renewalTimer) {
          renewalTimer = setTimeout(() => {
            renewingSession.current = true;
            void api('/api/session').then(refresh).then(() => {
              if (mounted.current) setSessionGeneration(value => value + 1);
            }).catch(() => setConnected(false)).finally(() => { renewingSession.current = false; });
          }, 1000);
        }
      };
      for (const event of ['created', 'state', 'session', 'message', 'error', 'recovered', 'evidence']) source.addEventListener(event, () => {
        refreshSelected ||= id === queryRef.current.selected;
        clearTimeout(timer); timer = setTimeout(() => {
          const includeDetail = refreshSelected; refreshSelected = false;
          void update(includeDetail).catch(() => setConnected(false));
        }, 60);
      });
      source.addEventListener('progress', (event) => { if (JSON.parse((event as MessageEvent).data).data.storage || JSON.parse((event as MessageEvent).data).data.deleted) void update().catch(() => setConnected(false)); if (id === selected) setProgress(JSON.parse((event as MessageEvent).data).data); });
      return source;
    });
    return () => { clearTimeout(timer); clearTimeout(renewalTimer); sources.forEach((source) => source.close()); };
  }, [subscribed, selected, refresh, refreshIndex, refreshDetail, refreshStorage, sessionReady, sessionGeneration]);
  useEffect(() => {
    // Poll as a fallback for browser hosts that buffer or interrupt SSE.
    if (!sessionReady || (!selected && !index.runningIds.length) || (connected && state?.status !== 'running' && !index.runningIds.length)) return;
    const interval = setInterval(() => {
      if (polling.current) return;
      polling.current = true;
      void refresh().catch(() => undefined).finally(() => { polling.current = false; });
    }, 2000);
    return () => clearInterval(interval);
  }, [selected, connected, state?.status, index.runningIds.join(","), sessionReady, refresh]);
  useEffect(() => { if (state?.status !== 'running') setProgress(null); }, [selected, state?.status]);
  const perform = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : translate("操作失敗。")); await refresh().catch(() => undefined); } finally { setBusy(false); } };
  // The sides of a debate were chosen on the creation form, so creating it is the confirmation: confirm them, then start like any other discussion.
  const create = async (input: RoomInput) => perform(async () => { const id = crypto.randomUUID(); const created = await api<Discussion>('/api/discussions', 'POST', { id, input }); setDetail(created); queryRef.current.selected = id; setSelected(id); setFolder("active"); setPage('main');
    if (input.kind === 'debate' && created.behaviorVersion === 3) await api(`/api/discussions/${id}`, 'PATCH', { confirmRoles: true, expectedVersion: created.room.configurationVersion });
    await operation(id, 'start'); });
  const runActions = async (action: HistoryAction, items: ManagementTarget[]) => {
    setBusy(true); setError(''); setConfirmation(null); setUndo(null);
    const succeeded: ManagementTarget[] = [], failures: string[] = [];
    for (const item of items) {
      if (item.id === queryRef.current.selected && ['archive', 'trash'].includes(action)) {
        const draft = document.querySelector<HTMLTextAreaElement>('.composer textarea');
        if (draft?.value.trim() && !window.confirm(translate('此對話有未送出的草稿。管理後將放棄草稿，是否繼續？'))) { failures.push(discussionName(item)); continue; }
      }
      try {
        if (action === 'delete') { await api('/api/discussions/' + item.id, 'DELETE', { operationId: crypto.randomUUID(), expectedSequence: item.sequence });
          if (item.id === queryRef.current.selected) { queryRef.current.selected = null; setSelected(null); setDetail(null); }
        } else { const saved = await api<Discussion>('/api/discussions/' + item.id + '/management', 'POST', { action, operationId: crypto.randomUUID(), expectedSequence: item.sequence });
          succeeded.push({ id: saved.id, sequence: saved.sequence, topic: saved.topic, displayName: saved.displayName });
          if (item.id === queryRef.current.selected) { setDetail(saved); setHistoryOpen(false); setPanel(null); if (['archive', 'trash'].includes(action)) setDraftEpoch(value => value + 1); }
        }
        if (action === 'delete') succeeded.push(item);
      } catch (e) { failures.push(discussionName(item) + ': ' + (e instanceof Error ? e.message : translate('操作失敗。'))); }
    }
    setResultNotice(translate('完成 {0} 筆，失敗或取消 {1} 筆。', succeeded.length, failures.length));
    if (failures.length) setError(failures.join('\n'));
    if (succeeded.length && ['archive', 'trash'].includes(action)) setUndo({ action: action === 'archive' ? 'unarchive' : 'restore', items: succeeded });
    await refresh().catch(e => setError(e instanceof Error ? e.message : translate('操作失敗。'))); setBusy(false);
  };
  const confirmDeletion = (items: ManagementTarget[]) => { setHistoryOpen(false); setPanel(null); setConfirmation(items.map(item => ({ ...item }))); };
  const act = (action: HistoryAction, items: ManagementTarget[]) => action === 'delete' ? confirmDeletion(items) : void runActions(action, items);
  const emptyTrash = async () => { setBusy(true); try {
    const items: ManagementTarget[] = []; let page = 1;
    while (true) { const result = await api<DiscussionIndex>('/api/discussion-index?folder=trash&limit=100&page=' + page); items.push(...result.items); if (result.page * result.limit >= result.total) break; page++; }
    confirmDeletion([...new Map(items.map(item => [item.id, item])).values()]);
  } catch (e) { setError(e instanceof Error ? e.message : translate('操作失敗。')); } finally { setBusy(false); } };
  const history = <><a className="brand" href="#" onClick={e => { e.preventDefault(); selectDiscussion(null); }}>CandC<span>{translate('多 AI 討論室')}</span></a>
    <button className="new-button" onClick={() => selectDiscussion(null)}><Icon name="plus"/>{translate('新討論')}</button>
    <History index={index} folder={folder} setFolder={value => { setFolder(value); setHistoryPage(1); setBefore(''); }} query={historyFilter} setQuery={value => { setHistoryFilter(value); setHistoryPage(1); }} before={before} setBefore={value => { setBefore(value); setHistoryPage(1); }} setPage={setHistoryPage} selected={selected} select={selectDiscussion} busy={busy} act={act} emptyTrash={() => void emptyTrash()}/>
    <button className={'connection-entry' + (page === 'connections' ? ' selected' : '')} aria-label={translate('連線與設定')} aria-current={page === 'connections' ? 'page' : undefined} onClick={openConnections}><span className="conn-dots" aria-hidden="true">{PROVIDERS.map(p => <i key={p} className={providerAvailability(environment, p).ready ? 'ok' : environment ? 'warn' : ''}/>)}</span>{environment ? translate('{0} / {1} 供應商就緒', readyProviders(environment), PROVIDERS.length) : translate('正在檢查連線…')}<span aria-hidden="true">⚙</span></button></>;
  const historyToggle = <button className="icon-button history-toggle" aria-label={mobile ? translate("開啟討論紀錄") : sidebarCollapsed ? translate("展開側欄") : translate("收起側欄")} aria-expanded={mobile ? historyOpen : !sidebarCollapsed} onClick={toggleHistory}>☰</button>;
  const controls = <ReadingControls readingMode={readingMode} setReadingMode={setReadingMode} open={panel === 'reading'} onToggle={() => setPanel(panel === 'reading' ? null : 'reading')}/>;
  return <div className={'app-shell ' + (sidebarCollapsed ? 'sidebar-collapsed ' : '') + (state ? 'chat-open' : '')}>
    {!mobile && !sidebarCollapsed && <aside className="sidebar">{history}</aside>}
    {mobile && historyOpen && <Inspector side="left" title={translate("討論紀錄")} modal onClose={() => setHistoryOpen(false)}>{history}</Inspector>}
    <main className={!state && panel && !overlayInspector ? 'creation-inspector-open' : ''}>
      {error && <div className="error-banner" role="alert"><span>{systemMessage(error)}</span><button aria-label={translate("關閉錯誤訊息")} onClick={() => setError('')}>×</button></div>}
      {storageIssues.filter(issue => !index.items.some(s => s.id === issue.id) && state?.id !== issue.id).map(issue => <div key={issue.id} className="notice warning" role="alert">{translate("無法讀取討論")}{" "}{issue.id}：{issue.reason}{translate("。原始檔保留；未確認保存，請核對 journal，不能顯示為正常空白討論。")}<button disabled={busy} onClick={() => void perform(() => api('/api/discussions/' + issue.id + '/recover', 'POST', { repairTail: false }))}>{translate("重新驗證原始 journal")}</button></div>)}
      {!connected && <div className="notice warning">{translate("正在重新連線。若連線中斷超過 15 秒，程式會在目前發言完成後暫停。")}</div>}
      {resultNotice && <div className="notice" role="status"><span>{resultNotice}</span>{undo && <button disabled={busy} onClick={() => void runActions(undo.action, undo.items)}>{translate('撤銷')}</button>}<button aria-label={translate('關閉通知')} onClick={() => { setResultNotice(''); setUndo(null); }}>×</button></div>}
      {index.pendingDeletions.map(item => <div className="notice warning" role="alert" key={item.id}><span>{translate('刪除未完成')} · {item.id} · {item.expectedSequence === undefined ? translate('刪除標記未確認，請保留檔案供檢查。') : translate('剩餘檔案已保留，可以重試刪除。')}</span>{item.expectedSequence !== undefined && <button disabled={busy} onClick={() => confirmDeletion([{ id: item.id, sequence: item.expectedSequence!, topic: item.id, exportable: false }])}>{translate('重試永久刪除')}</button>}</div>)}
      {state && state.management && state.management.folder !== 'active' && <div className="notice" role="status"><span>{translate('{0} · 唯讀，還原後才能修改或續談。', folderLabels()[state.management.folder])}</span><button disabled={busy || !!state.storage} onClick={() => act(state.management!.folder === 'trash' ? 'restore' : 'unarchive', [state])}>{state.management.folder === 'trash' ? translate('還原') : translate('取消封存')}</button></div>}
      {/* Keep the current workspace mounted during connection checks so unsent input and recipients survive. */}
      <div className="workspace-page" hidden={page !== 'main'}>
        {!state && <header className="creation-header">{historyToggle}<span>{translate("本機工作空間")}</span>{controls}<button className="icon-button" onClick={openConnections}>{translate("連線")}</button></header>}
        <Suspense fallback={<div className="loading" role="status">{translate("正在載入討論室…")}</div>}>
        {loading ? <div className="loading" role="status">{translate("正在載入討論室…")}</div> : state ? state.behaviorVersion === 3 ? <RoomView visible={page === 'main'} readingMode={readingMode} setReadingMode={setReadingMode} key={state.id + ":" + draftEpoch} state={state} progress={progress} busy={busy} perform={perform} panel={page === 'main' ? panel : null} setPanel={setPanel} historyToggle={historyToggle} controls={controls}/> : <DiscussionView visible={page === 'main'} readingMode={readingMode} setReadingMode={setReadingMode} key={state.id + ":" + draftEpoch} state={state} progress={progress} busy={busy} perform={perform} panel={page === 'main' ? panel : null} setPanel={setPanel} historyToggle={historyToggle} controls={controls} onFork={next => { setDetail(next); selectDiscussion(next.id); }}/>: <RoomNewDiscussion environment={environment} models={models} busy={busy} onCreate={create} onConnection={openConnections}/>}
        </Suspense>
      </div>
      {page === 'connections' && <Suspense fallback={<div className="loading" role="status">{translate("正在載入連線與設定…")}</div>}><ConnectionsPage environment={environment} models={models} checking={checking} onCheck={() => void check()} onBack={() => { setPanel(null); setPage('main'); }} historyToggle={historyToggle} controls={controls}/></Suspense>}
      {(!state || page === 'connections') && panel === 'reading' && <Inspector title={translate("閱讀設定")} modal={overlayInspector} onClose={() => setPanel(null)}><ReadingControls readingMode={readingMode} setReadingMode={setReadingMode} settings/></Inspector>}
      {confirmation && <Inspector title={translate('永久刪除確認')} modal onClose={() => setConfirmation(null)}><p>{translate('將永久刪除 {0} 筆對話，無法還原。', confirmation.length)}</p><p>{translate('只刪除本機對話 journal、復原與壓縮備份。另存的匯出檔、AI 工作目錄與 CLI 歷史仍保留。')}</p><ul className="deletion-targets">{confirmation.map(item => <li key={item.id}>{discussionName(item)}{item.exportable !== false && <span><a href={'/api/discussions/' + item.id + '/export?format=markdown'}>Markdown</a> · <a href={'/api/discussions/' + item.id + '/export?format=json'}>JSON</a></span>}</li>)}</ul><div className="actions"><button onClick={() => setConfirmation(null)}>{translate('取消')}</button><button className="danger" disabled={busy || !confirmation.length} onClick={() => void runActions('delete', confirmation)}>{translate('確認永久刪除')}</button></div></Inspector>}
    </main></div>;
}
