import { translate, dateLocale } from './i18n.js';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { plainSnippet } from './snippet.js';
import type { RoomDiscussion, RoomMessage } from '../src/room-contract.js';
import { MessageContent } from './MessageContent.js';
import { Icon } from './Icon.js';
import { SeatAvatar } from './SeatAvatar.js';
import { seatOf, userSeat, type SeatView } from './seats.js';
import type { RoomEvent } from './roomEvents.js';

type Seats = Record<string, SeatView>;
export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', hour12: false });

/** Live state of one seat, from saved room state plus the speaker the stream is currently showing. */
export function seatLive(state: RoomDiscussion, id: string, speaking: string | null) {
  const muted = state.room.muted.includes(id), proposal = state.room.proposal;
  const confirmed = state.room.outcome?.authority === 'participants' || !state.room.outcome && !!proposal?.confirmed.includes(id);
  return { state: muted ? 'muted' as const : speaking === id ? 'speaking' as const : undefined, badge: muted ? 'mute' as const : confirmed ? 'ok' as const : undefined };
}

export function SeatStrip({ state, seats, speaking }: { state: RoomDiscussion; seats: Seats; speaking: string | null }) {
  // Only the mute badge shows in the header; confirmation checks live in the roster and the consensus strip, where they have room.
  return <span className="seat-strip" aria-hidden="true">{state.participants.map(p => { const live = seatLive(state, p.id, speaking); return <SeatAvatar key={p.id} seat={seatOf(seats, p.id)} size="sm" state={live.state} badge={live.badge === 'mute' ? 'mute' : undefined}/>; })}{state.moderator && <SeatAvatar seat={seatOf(seats, 'moderator')} size="sm"/>}</span>;
}

/** Native radios, one per seat. The caption says who can read the message before it is sent. */
export function RecipientChips({ state, seats, value, onChange }: { state: RoomDiscussion; seats: Seats; value: string; onChange: (id: string) => void }) {
  return <div className="recipient-chips" role="radiogroup" aria-label={translate("傳給")}>
    <label className="all"><input type="radio" name="room-recipient" value="all" checked={value === 'all'} onChange={() => onChange('all')}/><span>{translate("所有人")}</span></label>
    {state.participants.map(p => <label key={p.id}><input type="radio" name="room-recipient" value={p.id} checked={value === p.id} onChange={() => onChange(p.id)}/><span><SeatAvatar seat={seatOf(seats, p.id)} size="sm" state={state.room.muted.includes(p.id) ? 'muted' : undefined}/>{seatOf(seats, p.id).name}</span></label>)}
  </div>;
}
export function privacyNote(state: RoomDiscussion, seats: Seats, recipient: string) {
  if (recipient === 'all') return { private: false, text: state.moderator ? translate("公開 · 所有座位與主持人都看得到。") : translate("公開 · 所有座位都看得到。") };
  const seat = seatOf(seats, recipient), twin = state.participants.some(p => p.id !== recipient && p.provider === state.participants.find(q => q.id === recipient)?.provider);
  return { private: true, text: translate("私訊給 {0} · 只有它收得到；{1}其他座位{2}都看不到。", seat.name, state.moderator ? translate("主持人與") : '', twin ? translate("（包含同一個 AI 的另一個 session）") : '') };
}

/** Classes that give a seat its own bubble colour. A later seat of one provider gets a separate colour; the moderator also gets its own shape. */
const seatSkin = (seat: SeatView, moderator: boolean) => moderator ? 'seated speaker-moderator' : seat.provider ? `seated prov-${seat.provider}${seat.alt ? ' seat-alt' : ''}` : '';

const FOLD_AT = 380, FOLD_SLACK = 120;
/** A long reply starts folded so one message cannot fill the pane. Only the presentation folds: the full text stays in the page, the copy action and exports. */
function Foldable({ children, text, mode }: { children: ReactNode; text: string; mode: string }) {
  const box = useRef<HTMLDivElement>(null), [tall, setTall] = useState(false), [open, setOpen] = useState(false);
  // Measured when the text or reading mode changes, not on every height change, so opening details never folds the message again.
  useLayoutEffect(() => { if (box.current) setTall(box.current.scrollHeight > FOLD_AT + FOLD_SLACK); }, [text, mode]);
  const folded = tall && !open;
  const toggle = () => {
    setOpen(!open);
    // Collapsing shrinks the message under the reader: if its top is now above the pane, bring it back.
    if (open) requestAnimationFrame(() => { const article = box.current?.closest('article'), pane = article?.closest('.messages'); if (article && pane && article.getBoundingClientRect().top < pane.getBoundingClientRect().top) article.scrollIntoView({ block: 'start' }); });
  };
  // Focus moving into folded text (keyboard, a link, a table) unfolds it instead of scrolling hidden content.
  return <>
    <div ref={box} className={folded ? 'clip folded' : 'clip'} style={folded ? { maxHeight: FOLD_AT } : undefined} onFocusCapture={() => setOpen(true)}>{children}</div>
    {tall && <div className={'fold-row' + (open ? ' open' : '')}><button type="button" className="fold-btn" aria-expanded={open} onClick={toggle}>{open ? translate("收合") : translate("展開全文 · 約 {0} 字", text.length)}</button></div>}
  </>;
}

export function RoomMessage({ message: m, seats, messages, demo, proposalId, readingMode, canReply, onReply, jump }: {
  message: RoomMessage; seats: Seats; messages: RoomMessage[]; demo: boolean; proposalId: string | null; readingMode: 'full' | 'highlights';
  canReply: boolean; onReply: (message: RoomMessage) => void; jump: (id: string) => void;
}) {
  const author = seatOf(seats, m.sender), user = m.sender === 'user', moderator = m.sender === 'moderator';
  const target = m.inReplyTo ? messages.find(other => other.id === m.inReplyTo && other.status === 'completed') : undefined, recipient = m.recipient !== 'all' ? seatOf(seats, m.recipient) : null;
  const cls = ['message', user && 'user', seatSkin(author, moderator), m.status !== 'completed' && 'cancelled'].filter(Boolean).join(' ');
  const body = <MessageContent text={m.text || translate("（生成中止，沒有可保存的文字）")} plain={user} readingMode={readingMode}/>;
  return <article id={'message-' + m.id} tabIndex={-1} className={cls}>
    <SeatAvatar seat={author}/>
    <div className="message-main">
      <div className="message-meta"><strong>{author.name}</strong>
        {!user && <span className={'message-role' + (moderator ? ' moderator' : '')}>{m.purpose === 'summary' ? translate("整理") : moderator ? translate("主持") : translate("發言者")}</span>}
        {proposalId === m.id && <span className="message-role proposal">{translate("提議結論")}</span>}
        {recipient && <span className="private-tag"><Icon name="lock"/>{translate("私訊給")}{" "}{recipient.name}</span>}
        {demo && !user && <span className="message-role">{translate("示範回覆")}</span>}
        <time dateTime={m.createdAt}>{hhmm(m.createdAt)}</time></div>
      <div className="message-body">
        {target && <button className="source-jump" aria-label={translate("回應來源")} onClick={() => jump(target.id)}><b>↳ {seatOf(seats, target.sender).name}</b><span>{plainSnippet(target.text)}</span></button>}
        {user ? body : <Foldable text={m.text} mode={readingMode}>{body}</Foldable>}
        {m.status !== 'completed' && <p className="notice warning">{m.interruptedBy ? translate("主持人已中止發言") : translate("回覆未確認完成")}{" "}{translate("· 部分文字已保存，不作為完成回答或證據。")}</p>}
        <div className="actions"><button disabled={!canReply} onClick={() => onReply(m)}><Icon name="reply"/>{translate("引用")}</button><button onClick={() => void navigator.clipboard.writeText(m.text)}><Icon name="copy"/>{translate("複製")}</button></div>
      </div>
    </div>
  </article>;
}

export function RoomPending({ seat, preview }: { seat: SeatView; preview?: string | undefined }) {
  return <article className={'message pending ' + seatSkin(seat, seat.kind === 'moderator')}><SeatAvatar seat={seat} state="speaking"/><div className="message-main"><div className="message-meta"><strong>{seat.name}</strong><span className="pulse">{translate("生成中 · 尚未保存")}</span></div><div className="message-body">{preview ? <div className="preview"><MessageContent text={preview}/></div> : <span className="typing" aria-hidden="true"><b/><b/><b/></span>}</div></div></article>;
}

/** One compact row for a moderator or configuration event; long details stay one click away. */
export function RoomEventRow({ event, seats }: { event: RoomEvent; seats: Seats }) {
  const who = event.who === 'moderator' ? seatOf(seats, 'moderator') : userSeat, long = !!event.detail && (event.detail.includes('\n') || event.detail.length > 80);
  return <div className="room-event" role="note"><SeatAvatar seat={who} size="sm"/><span title={event.detail ? `${event.text}：${event.detail}` : event.text}><b>{who.name}</b> · {event.text}{event.detail && !long && <> · {event.detail}</>}</span>{long && <details className="room-event-more"><summary>{translate("內容")}</summary><p>{event.detail}</p></details>}<time dateTime={event.at}>{hhmm(event.at)}</time></div>;
}

export function ConsensusStrip({ state, seats }: { state: RoomDiscussion; seats: Seats }) {
  const proposal = state.room.proposal; if (!proposal || state.moderator && state.moderatorMode === 'judge' || state.room.outcome) return null;
  const waiting = state.participants.filter(p => !proposal.confirmed.includes(p.id)).map(p => seatOf(seats, p.id).name);
  return <div className="consensus-strip" role="status"><strong>{state.mode === 'conclusion' ? translate("結論確認") : translate("階段成果確認")}{" "}{proposal.confirmed.length} / {state.participants.length}</strong>
    <span className="consensus-seats">{state.participants.map(p => <span className="consensus-seat" key={p.id}><SeatAvatar seat={seatOf(seats, p.id)} size="sm" badge={proposal.confirmed.includes(p.id) ? 'ok' : undefined}/>{seatOf(seats, p.id).short}</span>)}</span>
    <small>{translate("提議者")}{" "}{seatOf(seats, proposal.author).name}{waiting.length ? translate(" · 等待 {0} 確認；沉默不算同意。", waiting.join('、')) : ''}</small></div>;
}

/** Compact in the stream, complete on the conclusion page. A moderator ruling is never presented as everyone's agreement. */
export function OutcomeCard({ state, seats, full = false, onOpen, jump }: { state: RoomDiscussion; seats: Seats; full?: boolean; onOpen?: () => void; jump?: (id: string) => void }) {
  const outcome = state.room.outcome; if (!outcome) return null;
  const ruling = outcome.authority === 'moderator';
  const partial = outcome.delivery?.status === 'partial';
  const kind = outcome.delivery?.kind;
  const list = (items: string[], empty: string): ReactNode => items.length ? <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="muted">{empty}</p>;
  return <section className={'outcome-card room-outcome' + (ruling ? ' ruling' : '')} aria-label={ruling ? translate("主持人裁決") : translate("共識結果")}>
    <div className="outcome-head"><span className="outcome-icon"><Icon name={ruling ? 'scale' : 'check'}/></span><div><h2>{partial ? translate("暫定結果 · 結論交付尚未完成") : ruling ? translate("主持人裁決結束") : outcome.delivery ? kind === 'disagreement' ? translate("已完成分歧結論") : kind === 'undetermined' ? translate("已完成結論 · 目前無法定論") : translate("已完成結論") : translate("所有發言者已確認結果")}</h2><small>{ruling ? translate("這是主持裁決，未代表所有發言者同意。") : translate("全部 {0} 個座位確認了同一份{1}。", state.participants.length, partial ? translate("暫定結果") : translate("結果"))}</small></div>{!full && onOpen && <button onClick={onOpen}>{translate("查看結論")}</button>}</div>
    <h3>{partial ? translate("目前得到的答案") : translate("答案")}</h3><MessageContent text={outcome.result}/>
    {outcome.delivery && <><h3>{translate("依據與說明")}</h3><ul>{outcome.delivery.basis.map((text, i) => <li key={i}><MessageContent text={text}/></li>)}</ul></>}
    {!outcome.delivery && <p className="dock-note">{translate("這是舊版保存的結果，未包含本次新增的結論交付審查。")}</p>}
    {full ? <><h3>{translate("異議")}</h3>{list(outcome.dissent, translate("未列出異議"))}<h3>{translate("未解事項")}</h3>{list(outcome.unresolved, translate("未列出未解事項"))}</> : (outcome.dissent.length > 0 || outcome.unresolved.length > 0) && <p className="muted">{translate("異議")}{" "}{outcome.dissent.length}{" "}{translate("項 · 未解事項")}{" "}{outcome.unresolved.length}{" "}{translate("項")}</p>}
    {full && <div className="outcome-signers">{ruling && <span className="signer"><SeatAvatar seat={seatOf(seats, 'moderator')} size="sm"/>{translate("主持人裁決")}</span>}{state.participants.map(p => <span className="signer" key={p.id}><SeatAvatar seat={seatOf(seats, p.id)} size="sm" badge={ruling ? undefined : 'ok'}/>{seatOf(seats, p.id).name}{ruling ? '' : translate(" · 已確認")}</span>)}</div>}
    {outcome.unhandledRequests.length > 0 && <div className="outcome-caution">{translate("仍有")}{" "}{outcome.unhandledRequests.length}{" "}{translate("則使用者要求未確認回應；回應標註是 AI 的聲明，不是獨立驗證。")}{full && jump && outcome.unhandledRequests.map(id => <div key={id}><a href={'#message-' + id} onClick={event => { event.preventDefault(); jump(id); }}>{translate("查看要求")}</a>：{state.messages.find(m => m.id === id)?.text.slice(0, 80)}</div>)}</div>}
  </section>;
}

const said = (state: RoomDiscussion, id: string) => state.messages.filter(m => m.sender === id && m.purpose === 'discussion' && m.status === 'completed').length;
const cut = (state: RoomDiscussion, id: string) => state.messages.filter(m => m.sender === id && m.purpose === 'discussion' && m.status !== 'completed').length;
const muteReason = (state: RoomDiscussion, id: string) => { const command = state.room.commands.findLast(c => c.action.type === 'mute' && c.action.target === id); return command?.action.type === 'mute' ? command.action.reason : ''; };

/** Participants tab: one card per seat with its live state, then the moderator. Raw session IDs live in diagnostics. */
export function RosterPanel({ state, seats, speaking, locked, onConfirmRoles }: { state: RoomDiscussion; seats: Seats; speaking: string | null; locked: boolean; onConfirmRoles: () => void }) {
  const proposal = state.room.proposal, observed = state.room.commands.filter(c => c.action.type === 'observe').length;
  return <>
    {state.participants.map(p => {
      const live = seatLive(state, p.id, speaking), seat = seatOf(seats, p.id), muted = state.room.muted.includes(p.id), cuts = cut(state, p.id);
      const chip = muted ? <span className="chip warn">{translate("已靜音")}</span> : speaking === p.id ? <span className="chip run">{translate("發言中")}</span> : proposal?.confirmed.includes(p.id) ? <span className="chip ok">{proposal.author === p.id ? translate("提議並確認") : translate("已確認")}</span> : proposal && (!state.moderator || state.moderatorMode !== 'judge') ? <span className="chip">{translate("等待確認")}</span> : <span className="chip">{translate("待命")}</span>;
      return <div key={p.id} className={'roster-card' + (speaking === p.id ? ' speaking' : '')}>
        <SeatAvatar seat={seat} size="lg" state={live.state} badge={live.badge}/>
        <h3>{seat.name}{chip}</h3>
        <small>{p.provider} · {p.settings.model} · {p.settings.effort ?? translate("CLI 預設")}</small>
        <small>{translate("已發言")}{" "}{said(state, p.id)}{" "}{translate("次")}{cuts ? translate(" · {0} 次被中止", cuts) : ''}</small>
        {p.instructions && <p>{translate("立場：")}{p.instructions}</p>}
        {muted && <p>{translate("主持人停止其發言")}{muteReason(state, p.id) ? '：' + muteReason(state, p.id) : ''}</p>}
      </div>;
    })}
    {state.moderator ? <div className="roster-card"><SeatAvatar seat={seatOf(seats, 'moderator')} size="lg"/><h3>{translate("主持人")}<span className="chip moderator">{translate("獨立 session")}</span></h3>
      <small>{state.moderator.provider} · {state.moderator.settings.model} · {state.moderator.settings.effort ?? translate("CLI 預設")}</small>
      <small>{translate("呼叫")}{" "}{state.room.moderatorCalls} / {state.limits.maxModeratorCalls}{" "}{translate("· 不介入")}{" "}{observed}{" "}{translate("次")}</small>
      <p>{state.moderatorMode === 'judge' ? translate("獨立主持人 · 可中止發言 · 私訊不可見") : translate("一般主持人 · 協調發言 · 結論需共識 · 私訊不可見")}</p></div> : <p className="dock-note">{translate("沒有主持人：所有座位確認同一版結論才算結束。")}</p>}
    {!state.rolesConfirmed && <button className="primary" disabled={locked} onClick={onConfirmRoles}>{translate("確認所有發言者立場")}</button>}
    <p className="dock-note">{translate("Session ID 與呼叫紀錄在「診斷」。")}</p>
  </>;
}
