import { translate } from './i18n.js';
import { movedAwayFromLatest } from './scroll-follow';
import { PerformancePanel } from './PerformancePanel';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MessageContent } from './MessageContent';
import { api, operation, reasonText, statusText, discussionName, clock, type Discussion, type AnyDiscussion } from './api';
import { DebateRoles, debateSide } from './DebateRoles';
import { Segmented } from './Segmented';
import { FocusedPanel, jumpToMessage } from './FocusedPanel';
import { Inspector, useNarrow } from './Inspector';
import { ReadingControls } from './ReadingControls';
import { Avatar, ParticipantList, participantsFromAgents } from './Participants';
import { ConversationMessage } from './ConversationMessage';
import { timelineDividers } from './timeline';
export type Progress = { speaker?: string; characters?: number; preview?: string; tool?: string; turnId?: string };

export function DiscussionView({ state, progress, busy, perform, onFork, readingMode, setReadingMode, historyToggle, controls, panel, setPanel, visible }: { state: Discussion; progress: Progress | null; busy: boolean; perform: (action: () => Promise<unknown>) => Promise<void>; onFork: (state: AnyDiscussion) => void; readingMode: 'highlights' | 'full'; setReadingMode: (mode: 'highlights' | 'full') => void; historyToggle: ReactNode; controls: ReactNode; panel: string | null; setPanel: (value: string | null) => void; visible: boolean }) {
  const readOnly = state.management !== undefined && state.management.folder !== 'active';
  const overlay = useNarrow('(max-width: 1279px)');
  const [name, setName] = useState(state.displayName ?? '');
  useEffect(() => { setName(state.displayName ?? ''); }, [state.displayName]);
  // Debate sides are a quiet presentation label derived from the saved role text.
  const participants = participantsFromAgents(state.agents).map(p => state.kind === 'debate' && !p.role && (p.id === 'codex' || p.id === 'claude') ? { ...p, role: debateSide(state.roles[p.id]) } : p);
  const identity = (id: string) => participants.find(p => p.id === id) ?? { id, name: id, symbol: id.slice(0, 1).toUpperCase() };
  const jump = (id: string) => { followLatest.current = false; if (overlay) { setPanel(null); requestAnimationFrame(() => jumpToMessage(id)); } else jumpToMessage(id); };
  const togglePanel = (value: string) => setPanel(panel === value ? null : value);
  const currentIssue = state.v2?.issues.find(i => i.id === state.v2?.currentIssueId);
  const [text, setText] = useState('');
  const [recipient, setRecipient] = useState('both');
  const [inReplyTo, setInReplyTo] = useState<string | null>(null);
  const [roles, setRoles] = useState(state.roles);
  const [limits, setLimits] = useState(state.limits);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const sending = useRef(false);
  useLayoutEffect(() => {
    const input = composerInput.current;
    if (!visible || !input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(128, Math.max(48, input.scrollHeight))}px`;
  }, [text, visible]);
  const messageViewport = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const followedPosition = useRef(0);
  const displayedContent = useRef<readonly unknown[]>([]);
  const [newContent, setNewContent] = useState(false);
  const jumpToLatest = () => {
    const viewport = messageViewport.current;
    if (viewport) { viewport.scrollTop = viewport.scrollHeight; followedPosition.current = viewport.scrollTop; }
    followLatest.current = true;
    setNewContent(false);
  };
  const shouldFollow = () => {
    const viewport = messageViewport.current;
    if (viewport && movedAwayFromLatest(viewport, followedPosition.current)) followLatest.current = false;
    return followLatest.current;
  };
  useLayoutEffect(() => {
    if (!visible) return;
    const content = [state.messages.length, progress?.preview, progress?.characters, state.status];
    const changed = content.some((value, index) => value !== displayedContent.current[index]); displayedContent.current = content;
    if (shouldFollow()) jumpToLatest();
    else if (changed) setNewContent(true);
  }, [visible, state.messages.length, progress?.preview, progress?.characters, state.status]);
  useEffect(() => {
    const viewport = messageViewport.current;
    if (!visible || !viewport) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      // Resize callbacks can precede the scroll event from this same frame.
      // Wait for that event before deciding whether the reader still follows.
      frame = requestAnimationFrame(() => { if (shouldFollow()) jumpToLatest(); });
    });
    observer.observe(viewport);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [visible]);
  useEffect(() => { setRoles(state.roles); }, [state.id, state.roles.codex, state.roles.claude]);
  useEffect(() => { setLimits(state.limits); }, [state.id, state.limits.maxRounds, state.limits.maxDurationMs, state.limits.turnTimeoutMs]);
  const active = state.status === 'running';
  // One source for the pending author's class, avatar and name; keeps the existing role-proposal attribution.
  const pendingSpeaker = progress?.speaker ?? (state.activity === 'roles' ? 'codex' : state.nextSpeaker);
  const terminal = ['stopped', 'indeterminate'].includes(state.status);
  const locked = readOnly || busy || active || !!state.storage;
  const configure = (settings: object) => api(`/api/discussions/${state.id}`, 'PATCH', { ...settings, ...(state.v2 ? { expectedVersion: state.v2.configurationVersion } : {}) });
  const draftReply = (messageId: string, peerCheck = false) => {
    const target = state.messages.find(m => m.id === messageId);
    setInReplyTo(messageId); setText(peerCheck ? translate("請檢查這則回答是否回應我的要求，指出接受、修正或反對的理由。") : translate("針對這則訊息：\n"));
    if (peerCheck) setRecipient(target?.sender === 'codex' ? 'claude' : 'codex');
    else if (target && target.recipient !== 'both') setRecipient(target.recipient);
    composerInput.current?.focus();
  };
  const rolesDirty = state.kind === 'debate' && (roles.codex !== state.roles.codex || roles.claude !== state.roles.claude);
  const command = (action: string) => perform(() => operation(state.id, action));
  const hasDiscussion = state.messages.some(m => m.sender !== 'user' && m.purpose !== 'roles');
  const resumeLabel = state.flow === 'free' && hasDiscussion ? translate("繼續交流") : state.completedInRound.length === 2 ? translate("開始下一輪") : hasDiscussion ? translate("繼續討論") : translate("開始討論");
  return <section className={'discussion ' + (panel && !overlay ? 'inspector-open' : '')}>
    <header className="discussion-heading">{historyToggle}<div className="heading-name"><h1 title={state.topic}>{discussionName(state)}</h1><span className={'status ' + state.status}><span/>{statusText[state.status]}{active && progress?.speaker ? translate(" · {0} 回應中", identity(progress.speaker).name) : ''}{state.backend === 'fake' ? translate(" · 示範") : ''}</span></div>
      <div className="header-controls"><button className="icon-button participants-entry" aria-label={translate("參與者")} aria-expanded={panel === 'participants'} onClick={() => togglePanel('participants')}><span className="avatar-stack" aria-hidden="true">{participants.map(p => <span key={p.id} className={'stack-avatar ' + p.id}>{p.symbol}</span>)}</span></button>{controls}<button className="icon-button" aria-label={translate("更多討論操作")} aria-expanded={panel === 'settings'} onClick={() => togglePanel('settings')}>···</button><span className="header-divider" aria-hidden="true"/><div className="execution-actions">{state.storage || readOnly ? null : active ? <><button className="quiet-button stop-button" aria-label={translate("立即停止")} onClick={() => void command('stop')} disabled={busy}><span aria-hidden="true">■</span><span className="button-label">{translate("停止")}</span></button><button className="primary" onClick={() => void command('pause')} disabled={busy}><span aria-hidden="true">❚❚</span><span className="button-label">{translate("本次回覆後暫停")}</span></button></> : terminal && state.v2 ? <button className="primary" disabled={busy || state.activity !== null} onClick={() => void perform(async () => { await api(`/api/discussions/${state.id}/rebuild`, 'POST', { operationId: crypto.randomUUID(), expectedVersion: state.v2!.taskVersion }); await operation(state.id, 'start'); })}>{translate("重建工作階段並續談")}</button> : terminal ? <button className="primary" disabled={busy || state.activity !== null} onClick={() => void perform(async () => { const next = await api<Discussion>(`/api/discussions/${state.id}/fork`, 'POST', { newId: crypto.randomUUID() }); onFork(next); })}>{translate("重建並續談")}</button> : <button className="primary" disabled={busy || !!state.storage || !state.rolesConfirmed || rolesDirty || !!state.v2?.completed} onClick={() => void command('start')}>{resumeLabel}</button>}</div></div>
    </header>
    <button className="focus-current" aria-label={translate("查看議題")} aria-expanded={panel === 'issues'} onClick={() => togglePanel('issues')}><span className="focus-label">{translate("目前議題")}{currentIssue && state.v2 ? ` ${state.v2.issues.indexOf(currentIssue) + 1}/${state.v2.issues.length}` : ''}</span><strong>{state.v2?.completed ? translate("整場結果已確認") : currentIssue ? currentIssue.title : state.v2 ? translate("選取下一題或確認整場結果") : translate("舊版討論 · 查看原始題目")}</strong><span className="focus-meter"><span className="meter-bar"><b style={{ width: `${Math.min(100, state.round / state.limits.maxRounds * 100)}%` }}/></span>{translate("第 {0} / {1} 輪", state.round, state.limits.maxRounds)}</span><span className="focus-time">{clock(state.elapsedMs)} / {clock(state.limits.maxDurationMs)}</span><span className="focus-go">{translate("查看 ›")}</span></button>
    {!state.rolesConfirmed && <div className="notice warning">{translate("請先確認雙方立場。")}<button onClick={() => setPanel('participants')}>{translate("查看立場")}</button></div>}
    <div className="conversation-region">
    <div className="messages" ref={messageViewport} tabIndex={0} onScroll={event => { if (!visible) return; const viewport = event.currentTarget; followLatest.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80; if (followLatest.current) { followedPosition.current = viewport.scrollTop; setNewContent(false); } }} aria-label={translate("對話內容")} aria-live="polite">{timelineDividers(state.messages).map((divider, index) => { const message = state.messages[index]!; return <Fragment key={message.id}>{divider}<ConversationMessage message={message} messages={state.messages} identity={identity} demonstration={state.backend === 'fake'} readingMode={readingMode} canReply={!readOnly && !terminal && !state.storage} jump={jump} draftReply={draftReply}/></Fragment>; })}
    {active && <article className={`message pending ${pendingSpeaker}`}><Avatar participant={identity(pendingSpeaker)}/><div className="message-main"><div className="message-meta"><strong>{identity(pendingSpeaker).name}</strong><span className="pulse">{progress?.characters || progress?.preview || progress?.tool ? translate("正在生成 · 尚未保存") : translate("等待回覆 · 尚未保存")}{progress?.tool ? translate(" · 查詢資料") : ''}… {progress?.characters ? translate("{0} 字元", progress.characters.toLocaleString()) : ''}</span></div><div className="message-body">{progress?.preview ? <div className="preview"><MessageContent text={progress.preview}/></div> : <span className="typing" aria-hidden="true"><b/><b/><b/></span>}</div></div></article>}</div>
    {newContent && <button className="latest-message" onClick={jumpToLatest}>{translate("有新內容 · 回到最新訊息 ↓")}</button>}
    </div>
    {(state.pauseReason || !active) && <div className={`discussion-notice ${state.storage || terminal || !!state.pauseReason && /invalid|required|limit|Missing|missing|exceed/i.test(state.pauseReason) ? 'warning' : ''}`} role={state.storage || terminal ? 'alert' : 'status'} aria-live="polite"><strong>{state.v2?.completed ? translate("✓ 整場結果已由雙方明確確認") : state.storage ? translate("未確認保存 · 已封鎖寫入與排程") : state.pauseReason === 'Conclusion confirmed by both agents.' ? translate("✓ 雙方已確認結論 · 討論已完成") : active ? translate("暫停要求已收到") : state.status === 'paused' ? translate("⏸ 討論已暫停") : state.status === 'stopped' ? translate("■ 討論已停止") : state.status === 'indeterminate' ? translate("回覆狀態需確認") : translate("尚未開始討論")}</strong><span>{reasonText(state.pauseReason) || statusText[state.status]}</span></div>}
    {state.storage && <div className="recovery-actions"><button disabled={busy} onClick={() => void perform(() => api('/api/discussions/' + state.id + '/recover', 'POST', { repairTail: false }))}>{translate("驗證保存並復原")}</button><button disabled={busy} onClick={() => void perform(() => api('/api/discussions/' + state.id + '/recover', 'POST', { repairTail: true }))}>{translate("修復殘缺尾端並驗證（保留備份）")}</button></div>}
    {!readOnly && !terminal && !state.storage && <form className="composer" onSubmit={e => {
      e.preventDefault();
      if (busy || sending.current || !text.trim()) return;
      sending.current = true;
      void perform(async () => {
        const saved = await api<Discussion>(`/api/discussions/${state.id}/messages`, 'POST', { messageId: crypto.randomUUID(), text, recipient, inReplyTo });
        setText(current => current === text ? '' : current); setInReplyTo(null);
        if ((saved.status === 'paused' || saved.status === 'ready') && saved.rolesConfirmed && !rolesDirty && saved.activity === null) {
          try { await operation(state.id, 'start'); }
          catch (error) { throw new Error(translate("意見已保存，但尚未接續討論：{0}", error instanceof Error ? error.message : translate("請稍後重試。"))); }
        }
      }).finally(() => { sending.current = false; });
    }}><div className="composer-heading">{inReplyTo && <span className="reply-preview"><b className={state.messages.find(m => m.id === inReplyTo)?.sender}>{translate("↳ 引用")}{" "}{identity(state.messages.find(m => m.id === inReplyTo)?.sender ?? 'user').name}</b><span>{state.messages.find(m => m.id === inReplyTo)?.text.slice(0, 64)}</span><button type="button" onClick={() => jump(inReplyTo)}>{translate("查看")}</button><button type="button" aria-label={translate("移除引用")} onClick={() => setInReplyTo(null)}>✕</button></span>}<label htmlFor="intervention">{translate("你的意見")}</label><small>{active ? translate("會在下一次 AI 發言時納入") : !state.rolesConfirmed || rolesDirty ? translate("確認雙方立場後才能接續討論") : translate("送出後會接續討論")}</small></div><textarea ref={composerInput} id="intervention" aria-label={translate("加入討論")} required maxLength={32000} rows={1} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        e.currentTarget.form?.requestSubmit();
      }
    }} placeholder={translate("加入條件、提出反例，或要求雙方聚焦某個問題…")}/><div className="composer-bottom"><Segmented label={translate("傳給")} name="recipient" value={recipient} options={[['both', translate("雙方")], ['codex', 'Codex'], ['claude', 'Claude']]} onChange={setRecipient}/><small>{translate("Enter 送出 · Shift + Enter 換行")}</small><button className="primary" disabled={busy || !text.trim()}>{!active && state.rolesConfirmed && !rolesDirty ? translate("送出並續談 ↑") : translate("送出意見 ↑")}</button></div></form>}
    {panel && panel !== 'connection' && <Inspector key={panel} title={panel === 'issues' ? translate("議題與確認") : panel === 'participants' ? translate("參與者") : panel === 'reading' ? translate("閱讀設定") : panel === 'sources' ? translate("可核對的來源") : panel === 'diagnostics' ? translate("輸入與呼叫診斷") : translate("討論設定")} modal={overlay} onClose={() => setPanel(null)}>
      {panel === 'issues' && (state.v2 ? <FocusedPanel state={state} busy={busy} perform={perform} section="issues" onJump={jump}/> : <div className="notice">{translate("舊版討論 · 保留既有聚焦與全文傳送")}<div className="user-text">{state.topic}</div><button disabled={locked} onClick={() => void perform(async () => onFork(await api('/api/discussions/' + state.id + '/upgrade', 'POST', { newId: crypto.randomUUID() }))) }>{translate("升級為新討論")}</button></div>)}
      {panel === 'participants' && <><ParticipantList participants={participants}/><p>{translate("你 +")}{" "}{participants.length - 1}{" "}{translate("個 AI；「雙方」表示 Codex 與 Claude。")}</p>{state.kind === 'debate' && <details className="roles-panel" open={!state.rolesConfirmed}><summary>{translate("雙方立場")}{" "}{state.rolesConfirmed && !rolesDirty ? translate("· 已確認") : translate("· 請確認後開始")}</summary><DebateRoles roles={roles} onChange={setRoles} disabled={locked}/><div className="actions"><button disabled={locked} onClick={() => void command('roles')}>{translate("重新提議立場")}</button><button className="primary" disabled={locked || !roles.codex.trim() || !roles.claude.trim()} onClick={() => void perform(() => configure({ roles }))}>{translate("確認雙方立場")}</button></div></details>}</>}
      {panel === 'settings' && <div className="settings-panel"><form onSubmit={e => { e.preventDefault(); void perform(() => api('/api/discussions/' + state.id + '/display-name', 'PATCH', { displayName: name, expectedVersion: state.displayVersion ?? 0 })); }}><label>{translate("顯示名稱")}<input aria-label={translate("顯示名稱")} maxLength={120} value={name} disabled={locked} onChange={e => setName(e.target.value)}/></label><small>{translate("空白時顯示題目第一行。更名不改變任務或確認。")}</small><button disabled={locked}>{translate("儲存名稱")}</button></form><details><summary>{translate("原始題目")}</summary><div className="user-text">{state.topic}</div></details><label className="inline">{translate("發言順序")}<select aria-label={translate("發言方式")} value={state.flow} disabled={locked} onChange={e => void perform(() => configure({ flow: e.target.value }))}><option value="free">{translate("自由對話")}</option><option value="alternating">{translate("輪流發言")}</option></select></label><label className="inline">{translate("執行模式")}<select aria-label={translate("進行方式")} value={state.mode} disabled={readOnly || busy || !!state.storage} onChange={e => void perform(() => configure({ mode: e.target.value }))}><option value="manual">{translate("手動")}</option><option value="auto">{translate("自動")}</option><option value="conclusion">{translate("有結論就停")}</option></select></label><details open><summary>{translate("執行上限與資料範圍")}</summary><p>{translate("經過")}{" "}{Math.floor(state.elapsedMs / 60000)}{" "}{translate("分鐘；資料查詢")}{state.research ? translate("已開啟") : translate("未開啟")}。</p>{state.roots.map((root) => <code className="root-path" key={root}>{root}</code>)}<form onSubmit={(e) => { e.preventDefault(); void perform(() => configure({ limits })); }}><div className="grid-three"><label>{translate("最多輪次")}<input disabled={readOnly} aria-label={translate("調整最多輪次")} type="number" min={1} max={1000} value={limits.maxRounds} onChange={(e) => setLimits({ ...limits, maxRounds: e.target.valueAsNumber })}/></label><label>{translate("總時間（分鐘）")}<input disabled={readOnly} type="number" min={1} max={1440} value={limits.maxDurationMs / 60000} onChange={(e) => setLimits({ ...limits, maxDurationMs: e.target.valueAsNumber * 60000 })}/></label><label>{translate("單次回覆（分鐘）")}<input disabled={readOnly} type="number" min={1} max={60} value={limits.turnTimeoutMs / 60000} onChange={(e) => setLimits({ ...limits, turnTimeoutMs: e.target.valueAsNumber * 60000 })}/></label></div><button disabled={locked}>{translate("更新上限")}</button></form></details>
    {!readOnly && !active && !state.storage && <button disabled={busy || !state.messages.some(m => m.sender !== 'user' && m.purpose !== 'roles' && m.status === 'completed')} onClick={() => void command('summary')}>{translate("整理結論")}</button>}<details className="export-menu"><summary>{translate("匯出 ↓")}</summary><a href={'/api/discussions/' + state.id + '/export?format=markdown'}>Markdown</a><a href={'/api/discussions/' + state.id + '/export?format=json'}>JSON</a></details><button onClick={() => setPanel('sources')}>{translate("查看來源")}</button><button onClick={() => setPanel('diagnostics')}>{translate("輸入與呼叫診斷")}</button><button onClick={() => setPanel('connection')}>{translate("連線與設定")}</button></div>}
      {panel === 'settings' && <button disabled={locked} onClick={() => void perform(async () => onFork(await api<AnyDiscussion>(`/api/discussions/${state.id}/upgrade-v3`, 'POST', { newId: crypto.randomUUID() })))}>{translate("另建多人討論（保留原紀錄）")}</button>}
      {panel === 'reading' && <ReadingControls readingMode={readingMode} setReadingMode={setReadingMode} settings/>}
      {panel === 'sources' && <details open><summary>{translate("可核對的來源 ·")}{" "}{state.evidence.length}</summary>{state.evidence.length === 0 ? <p className="muted">{translate("目前沒有透過資料工具取得的來源。AI 回覆中的連結不等於已驗證的證據。")}</p> : state.evidence.map((item, i) => <details className="evidence" key={i}><summary>{item.source}</summary><small>{item.retrievedAt} · {item.truncated ? translate("有截斷") : translate("工具回傳內容")} · SHA256 {item.sha256}</small><pre>{item.text}</pre></details>)}</details>}
      {panel === 'diagnostics' && (state.v2 ? <FocusedPanel state={state} busy={busy} perform={perform} section="diagnostics" onJump={jump}/> : <><PerformancePanel discussionId={state.id}/><p>{translate("舊版紀錄沒有新版本呼叫診斷。")}</p></>)}
    </Inspector>}
  </section>;
}
