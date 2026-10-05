import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RoomDiscussion, RoomMessage as Message } from '../src/room-contract';
import type { Progress } from './DiscussionView';
import { api, operation, statusText, discussionName, clock } from './api';
import { Inspector, useNarrow } from './Inspector';
import { ReadingControls } from './ReadingControls';
import { jumpToMessage } from './FocusedPanel';
import { timelineDividers } from './timeline';
import { liveProgress, roomTimeline } from './roomEvents';
import { seatViews, seatOf } from './seats';
import { SeatAvatar } from './SeatAvatar';
import { Icon } from './Icon';
import { ConsensusStrip, OutcomeCard, RecipientChips, RoomEventRow, RoomMessage, RoomPending, RosterPanel, SeatStrip, privacyNote } from './RoomParts';
import { RoomSettings } from './RoomSettings';
import { RoomResult } from './RoomResult';
import { RoomDiagnostics } from './RoomDiagnostics';

type Tab = 'chat' | 'result' | 'diagnostics';
const tabs = [['chat', '對話'], ['result', '結論'], ['diagnostics', '診斷']] as const;

export function RoomView({ state, progress, busy, perform, panel, setPanel, historyToggle, controls, readingMode, setReadingMode, visible }: {
  state: RoomDiscussion; progress: Progress | null; busy: boolean; perform: (action: () => Promise<unknown>) => Promise<void>;
  panel: string | null; setPanel: (panel: string | null) => void; historyToggle: ReactNode; controls: ReactNode;
  readingMode: 'full' | 'highlights'; setReadingMode: (mode: 'full' | 'highlights') => void;
  visible: boolean;
}) {
  const overlay = useNarrow('(max-width: 1279px)'), active = state.status === 'running', terminal = ['stopped', 'indeterminate'].includes(state.status), locked = busy || !!state.storage || state.activity !== null;
  const seats = useMemo(() => seatViews(state), [state.participants, state.moderator]);
  const [tab, setTab] = useState<Tab>('chat'), [text, setText] = useState(''), [recipient, setRecipient] = useState('all'), [reply, setReply] = useState<string | null>(null), [autoOpened, setAutoOpened] = useState(false), [newContent, setNewContent] = useState(false);
  const viewport = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), follow = useRef(true), sending = useRef(false);
  const displayedContent = useRef<readonly unknown[]>([]);
  const live = liveProgress(progress, state.messages);
  const speaking = active ? live?.speaker ?? state.room.currentSpeaker ?? null : null, outcome = state.room.outcome, proposal = state.room.proposal;
  const latest = () => { if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; follow.current = true; setNewContent(false); };
  useLayoutEffect(() => {
    if (!visible || tab !== 'chat') return;
    const content = [state.messages.length, state.room.commands.length, progress?.preview, outcome?.result, state.status];
    const changed = content.some((value, index) => value !== displayedContent.current[index]); displayedContent.current = content;
    if (follow.current) latest(); else if (changed) setNewContent(true);
  }, [visible, panel, state.messages.length, state.room.commands.length, progress?.preview, outcome?.result, state.status, tab]);
  // The participants dock is open by default on a wide screen and remembers when the user closes it. It never takes focus.
  useEffect(() => { if (visible && !overlay && panel === null && localStorage.getItem('candc-roster') !== 'closed') { setAutoOpened(true); setPanel('participants'); } }, [state.id, overlay, visible]);
  // The composer grows with its text up to a few lines, like the two-agent view.
  useLayoutEffect(() => { const el = input.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(128, Math.max(48, el.scrollHeight))}px`; }, [text, tab]);
  // A dock the app opened itself must not turn into a full-screen drawer when the window shrinks.
  useEffect(() => { if (overlay && autoOpened && panel === 'participants') { setAutoOpened(false); setPanel(null); } }, [overlay]);
  const openPanel = (value: string) => { setAutoOpened(false); if (value === 'participants' && !overlay) localStorage.setItem('candc-roster', 'open'); setPanel(value); };
  const closePanel = () => { if ((panel === 'participants' || panel === 'settings') && !overlay) localStorage.setItem('candc-roster', 'closed'); setPanel(null); };
  const toggle = (value: string) => panel === value ? closePanel() : openPanel(value);
  const command = (action: string) => perform(() => operation(state.id, action));
  const jump = (id: string) => { follow.current = false; setTab('chat'); if (overlay && panel) setPanel(null); requestAnimationFrame(() => jumpToMessage(id)); };
  const items = useMemo(() => roomTimeline(state, seats), [state, seats]);
  const messages = useMemo(() => items.flatMap(item => item.kind === 'message' ? [item.message] : []), [items]);
  const dividers = useMemo(() => new Map(timelineDividers(messages).map((parts, index) => [messages[index]!.id, parts])), [messages]);
  const speakerId = live?.speaker ?? state.room.currentSpeaker ?? (state.moderator ? 'moderator' : state.participants[0]?.id ?? 'user');
  const note = privacyNote(state, seats, recipient), grant = state.room.grant;
  const draftReply = (m: Message) => { setReply(m.id); setRecipient(m.recipient !== 'all' ? m.recipient : 'all'); input.current?.focus(); };
  const replyTo = reply ? state.messages.find(m => m.id === reply) : undefined;
  const confirmed = proposal && (!state.moderator || state.moderatorMode !== 'judge') ? proposal.confirmed.length : 0;
  const resultBadge = outcome ? <small className="hl">{outcome.delivery?.status === 'partial' ? '暫定結果' : outcome.delivery ? '已完成' : '已確認'}</small> : proposal && (!state.moderator || state.moderatorMode !== 'judge') ? <small className="hl">確認 {confirmed} / {state.participants.length}</small> : null;
  const rebuild = () => void perform(async () => { await api(`/api/discussions/${state.id}/rebuild`, 'POST', { operationId: crypto.randomUUID(), expectedVersion: state.room.taskVersion }); });
  return <section className={'discussion room-discussion ' + (panel && !overlay ? 'inspector-open' : '')}>
    <header className="discussion-heading">{historyToggle}<div className="heading-name"><h1 title={state.topic}>{discussionName(state)}</h1><span className={'status ' + state.status}><span/>{statusText[state.status]}{state.backend === 'fake' && ' · 示範'}{active && live?.speaker && ` · ${seatOf(seats, live.speaker).name} 回應中`}</span></div>
      <div className="header-controls"><button className="icon-button participants-entry" aria-label="參與者" aria-expanded={panel === 'participants'} onClick={() => toggle('participants')}><SeatStrip state={state} seats={seats} speaking={speaking}/></button>{controls}<button className="icon-button" aria-label="更多討論操作" aria-expanded={panel === 'settings'} onClick={() => toggle('settings')}>···</button><span className="header-divider" aria-hidden="true"/>
        <div className="execution-actions">{!state.storage && (active ? <><button disabled={busy} aria-label="立即停止" className="quiet-button stop-button" onClick={() => void command('stop')}><Icon name="stop"/><span className="button-label">停止</span></button><button className="primary" disabled={busy} onClick={() => void command('pause')}><Icon name="pause"/><span className="button-label">本次回覆後暫停</span></button></> : terminal ? <button className="primary" disabled={locked} onClick={rebuild}>重建工作階段</button> : <button className="primary" disabled={locked || !state.rolesConfirmed || !!outcome || !!state.room.pendingTopic} onClick={() => void command('start')}>繼續討論</button>)}</div></div></header>
    <div className="room-subbar"><div className="room-tabs" role="tablist" aria-label="討論室頁面">{tabs.map(([id, label]) => <button key={id} role="tab" className="room-tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}{id === 'result' && resultBadge}</button>)}</div>
      {tab === 'chat' && <button className="stage-topic" aria-label="查看議題" onClick={() => openPanel('settings')}><span className="focus-label">目前議題</span><strong>{state.topic}</strong></button>}
      <div className="room-meter"><span className="meter-bar" aria-hidden="true"><b style={{ width: `${Math.min(100, state.round / state.limits.maxRounds * 100)}%` }}/></span><span>第 {state.round} / {state.limits.maxRounds} 輪</span><span>{clock(state.elapsedMs)} / {clock(state.limits.maxDurationMs)}</span>{state.moderator && <span className="moderator-count">主持 {state.room.moderatorCalls} / {state.limits.maxModeratorCalls}</span>}</div></div>
    {!state.rolesConfirmed && <div className="notice warning">請先確認所有發言者的立場。<button onClick={() => openPanel('participants')}>查看立場</button></div>}
    {state.room.pendingTopic && <div className="notice warning" role="alert">主題變更通知已保存，尚未套用：{state.room.pendingTopic.title}。請確認後續談。{[true, false].map(apply => <button key={String(apply)} disabled={locked} onClick={() => void perform(() => api(`/api/discussions/${state.id}/pending-topic`, 'POST', { operationId: crypto.randomUUID(), expectedVersion: state.room.taskVersion, apply }))}>{apply ? '套用已通知的改題' : '保留目前題目'}</button>)}</div>}
    {tab === 'result' && <RoomResult state={state} seats={seats} locked={locked} jump={jump} onSummary={() => void command('summary')}/>}
    {tab === 'diagnostics' && <RoomDiagnostics state={state} seats={seats}/>}
    {tab === 'chat' && <>
      {grant && <div className="stage-grant"><SeatAvatar seat={seatOf(seats, 'moderator')} size="sm"/><span>主持人請 <b>{seatOf(seats, grant.target).name}</b>：{grant.task}</span></div>}
      <div className="conversation-region"><div className="messages" aria-label="對話內容" aria-live="polite" tabIndex={0} ref={viewport} onScroll={e => { if (!visible) return; const v = e.currentTarget; follow.current = v.scrollHeight - v.scrollTop - v.clientHeight < 80; if (follow.current) setNewContent(false); }}>
        {items.map(item => item.kind === 'event' ? <RoomEventRow key={item.id} event={item} seats={seats}/> : <Fragment key={item.message.id}>{dividers.get(item.message.id)}<RoomMessage message={item.message} seats={seats} messages={state.messages} demo={state.backend === 'fake'} proposalId={proposal?.id ?? null} readingMode={readingMode} canReply={!terminal && !state.storage} onReply={draftReply} jump={jump}/></Fragment>)}
        {active && <RoomPending seat={seatOf(seats, speakerId)} preview={live?.preview}/>}
        <OutcomeCard state={state} seats={seats} onOpen={() => setTab('result')}/>
      </div>{newContent && <button className="latest-message" onClick={latest}>有新內容 · 回到最新訊息 ↓</button>}</div>
      <ConsensusStrip state={state} seats={seats}/>
      {state.room.workflow && <div className="stage-checkpoint-bar" role="status"><span>{state.room.workflow.checkpoint ? '階段成果已保存' : '主動討論已啟用'} · 待補充 {state.room.workflow.questions.filter(q => q.status === 'pending').length} · 待辦 {state.room.workflow.tasks.filter(t => t.status === 'pending').length}</span><button onClick={() => setTab('result')}>查看階段成果</button></div>}
      {(state.pauseReason || !active) && !outcome && <div className={'discussion-notice ' + (terminal || state.storage ? 'warning' : '')} role={state.storage ? 'alert' : 'status'}><strong>{state.storage ? '未確認保存 · 已停止所有 AI 排程' : statusText[state.status]}</strong><span>{state.pauseReason}</span></div>}
      {state.storage && <div className="recovery-actions"><button disabled={busy} onClick={() => void perform(() => api(`/api/discussions/${state.id}/recover`, 'POST', { repairTail: false }))}>驗證保存並復原</button><button disabled={busy} onClick={() => void perform(() => api(`/api/discussions/${state.id}/recover`, 'POST', { repairTail: true }))}>修復殘缺尾端並驗證（保留備份）</button></div>}
      {!terminal && !state.storage && <form className="composer" onSubmit={e => { e.preventDefault(); if (sending.current || busy || !text.trim()) return; sending.current = true; const submitted = text; void perform(async () => {
        const saved = await api<RoomDiscussion>(`/api/discussions/${state.id}/messages`, 'POST', { messageId: crypto.randomUUID(), text: submitted, recipient, inReplyTo: reply }); setText(current => current === submitted ? '' : current); setReply(null);
        if (saved.activity === null && saved.rolesConfirmed && !saved.room.pendingTopic) await operation(state.id, 'start');
      }).finally(() => { sending.current = false; }); }}>
        <div className="composer-heading"><label htmlFor="room-intervention">你的意見</label>{replyTo && <span className="reply-preview"><b>↳ 引用 {seatOf(seats, replyTo.sender).name}</b><span>{replyTo.text.slice(0, 64)}</span><button type="button" aria-label="移除引用" onClick={() => setReply(null)}>×</button></span>}<small>{active ? '下一次發言納入' : '送出後接續討論'}</small></div>
        <textarea id="room-intervention" ref={input} aria-label="加入討論" rows={1} required maxLength={32000} value={text} placeholder="加入條件、提出反例，或指定某個座位回應…" title="Enter 送出 · Shift + Enter 換行" onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}/>
        {/* Public is the default and is announced to screen readers only; a private recipient gets a visible reminder of who cannot see it. */}
        <p className={'privacy-note' + (note.private ? ' private' : ' sr-only')} role="status">{note.private && <Icon name="lock"/>}{note.text}</p>
        <div className="composer-bottom"><div className="recipient-row"><span>傳給</span><RecipientChips state={state} seats={seats} value={recipient} onChange={setRecipient}/></div><button className="primary" disabled={busy || !text.trim()}>送出並續談 ↑</button></div></form>}
    </>}
    {panel && <Inspector title={panel === 'participants' ? '參與者' : panel === 'settings' ? '討論設定' : '閱讀設定'} modal={overlay} focus={!autoOpened} onClose={closePanel}>
      {(panel === 'participants' || panel === 'settings') && <div className="dock-tabs" role="group" aria-label="面板"><button aria-pressed={panel === 'participants'} onClick={() => setPanel('participants')}>名單</button><button aria-pressed={panel === 'settings'} onClick={() => setPanel('settings')}>設定</button></div>}
      {panel === 'participants' && <RosterPanel state={state} seats={seats} speaking={speaking} locked={locked} onConfirmRoles={() => void perform(() => api(`/api/discussions/${state.id}`, 'PATCH', { confirmRoles: true, expectedVersion: state.room.configurationVersion }))}/>}
      {panel === 'settings' && <RoomSettings state={state} locked={locked} busy={busy} perform={perform}/>}
      {panel === 'reading' && <ReadingControls readingMode={readingMode} setReadingMode={setReadingMode} settings/>}
    </Inspector>}
  </section>;
}
