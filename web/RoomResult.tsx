import type { RoomDiscussion } from '../src/room-contract';
import { discussionName } from './api';
import { MessageContent } from './MessageContent';
import { OutcomeCard } from './RoomParts';
import { SeatAvatar } from './SeatAvatar';
import { seatOf, type SeatView } from './seats';
import { RoomProgress } from './RoomProgress';

type Seats = Record<string, SeatView>;
const lines = (items: string[]) => <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>;

/** Conclusion tab: the finished result, or the proposal still waiting for confirmation, plus topic history and export. */
export function RoomResult({ state, seats, locked, jump, onSummary }: { state: RoomDiscussion; seats: Seats; locked: boolean; jump: (id: string) => void; onSummary: () => void }) {
  const proposal = state.room.proposal, outcome = state.room.outcome;
  return <div className="room-page"><div className="room-page-inner">
    <h1>結論</h1><p className="lead">{discussionName(state)} · {state.participants.length} 個座位{state.moderator ? ' ＋ 主持人' : ''}</p>
    {state.room.conclusionRequest && <p className="notice warning">結論仍需補寫或審查，尚未完成交付。</p>}
    {outcome ? <OutcomeCard state={state} seats={seats} full jump={jump}/> : proposal && (!state.moderator || state.moderatorMode !== 'judge') ?
      <section className="surface-card padded" aria-label="待確認的結論"><h3>待確認的結論 · {proposal.confirmed.length} / {state.participants.length}</h3>
        <MessageContent text={proposal.result}/>
        {proposal.delivery && <><p className="dock-note">{proposal.delivery.status === 'partial' ? '這份提案仍缺少部分答案，確認後也只會標示為暫定結果。' : '正在審查這份答案是否完整回應原始問題；確認不代表事實已獲獨立驗證。'}</p><h3>依據與說明</h3>{lines(proposal.delivery.basis)}</>}
        {proposal.reviews?.some(r => !r.adequate || r.gaps.length > 0) && <div className="notice warning"><h3>需要補寫的內容</h3>{proposal.reviews.filter(r => !r.adequate || r.gaps.length > 0).map(r => <div key={r.actor}><strong>{seatOf(seats, r.actor).name}</strong><MessageContent text={r.reason}/>{lines(r.gaps)}</div>)}</div>}
        {proposal.dissent.length > 0 && <><h3>異議</h3>{lines(proposal.dissent)}</>}{proposal.unresolved.length > 0 && <><h3>未解事項</h3>{lines(proposal.unresolved)}</>}
        <div className="outcome-signers">{state.participants.map(p => <span className="signer" key={p.id}><SeatAvatar seat={seatOf(seats, p.id)} size="sm" badge={proposal.confirmed.includes(p.id) ? 'ok' : undefined}/>{seatOf(seats, p.id).name}{proposal.confirmed.includes(p.id) ? ' · 已確認' : ' · 等待確認'}</span>)}</div>
        <p className="dock-note">沉默與送達都不算同意；所有座位確認同一版後才會結束。</p></section> :
      <p className="dock-note">{state.status === 'running' ? '討論進行中，尚未完成結論交付。' : state.room.calls.length ? '討論已停止，結論交付尚未完成。已保存的分析如下。' : '尚未產生結論。'}</p>}
    {outcome ? <details><summary>查看討論過程與階段成果</summary><RoomProgress state={state} seats={seats} jump={jump}/></details> : <RoomProgress state={state} seats={seats} jump={jump}/>}
    <section className="surface-card padded"><h3>主題歷程</h3>{state.room.topicHistory.map(t => <div className="history-row" key={t.version}><em>v{t.version}</em><span>{t.title}</span><small>{t.reason}</small></div>)}</section>
    <div className="action-row"><button disabled={locked || !state.rolesConfirmed} onClick={onSummary}>整理結論</button><a href={`/api/discussions/${state.id}/export?format=markdown`}>匯出 Markdown</a><a href={`/api/discussions/${state.id}/export?format=json`}>匯出 JSON</a></div>
  </div></div>;
}
