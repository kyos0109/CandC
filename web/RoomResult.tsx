import { translate } from './i18n.js';
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
    <h1>{translate("結論")}</h1><p className="lead">{discussionName(state)} · {state.participants.length}{" "}{translate("個座位")}{state.moderator ? translate(" ＋ 主持人") : ''}</p>
    {state.room.conclusionRequest && <p className="notice warning">{translate("結論仍需補寫或審查，尚未完成交付。")}</p>}
    {outcome ? <OutcomeCard state={state} seats={seats} full jump={jump}/> : proposal && (!state.moderator || state.moderatorMode !== 'judge') ?
      <section className="surface-card padded" aria-label={state.mode === 'conclusion' ? translate("待確認的結論") : translate("待確認的階段成果")}><h3>{state.mode === 'conclusion' ? translate("待確認的結論 ·") : translate("待確認的階段成果 ·")}{" "}{proposal.confirmed.length} / {state.participants.length}</h3>
        <MessageContent text={proposal.result}/>
        {proposal.delivery && <><p className="dock-note">{proposal.delivery.status === 'partial' ? translate("這份提案仍缺少部分答案，確認後也只會標示為暫定結果。") : translate("正在審查這份答案是否完整回應原始問題；確認不代表事實已獲獨立驗證。")}</p><h3>{translate("依據與說明")}</h3>{lines(proposal.delivery.basis)}</>}
        {proposal.reviews?.some(r => !r.adequate || r.gaps.length > 0) && <div className="notice warning"><h3>{translate("需要補寫的內容")}</h3>{proposal.reviews.filter(r => !r.adequate || r.gaps.length > 0).map(r => <div key={r.actor}><strong>{seatOf(seats, r.actor).name}</strong><MessageContent text={r.reason}/>{lines(r.gaps)}</div>)}</div>}
        {proposal.dissent.length > 0 && <><h3>{translate("異議")}</h3>{lines(proposal.dissent)}</>}{proposal.unresolved.length > 0 && <><h3>{translate("未解事項")}</h3>{lines(proposal.unresolved)}</>}
        <div className="outcome-signers">{state.participants.map(p => <span className="signer" key={p.id}><SeatAvatar seat={seatOf(seats, p.id)} size="sm" badge={proposal.confirmed.includes(p.id) ? 'ok' : undefined}/>{seatOf(seats, p.id).name}{proposal.confirmed.includes(p.id) ? translate(" · 已確認") : translate(" · 等待確認")}</span>)}</div>
        <p className="dock-note">{state.mode === 'conclusion' ? translate("沉默與送達都不算同意；所有座位確認同一版後才會結束。") : translate("沉默不算確認；所有座位審查後保存為階段成果，討論仍可繼續。")}</p></section> :
      <p className="dock-note">{state.room.interimResults?.length ? translate("已保存階段共識，可從現有成果繼續討論。") : state.status === 'running' ? translate("討論進行中，尚未完成結論交付。") : state.room.calls.length ? state.status === 'stopped' ? translate("討論已停止，結論交付尚未完成。已保存的分析如下。") : translate("結論交付尚未完成。已保存的分析如下。") : translate("尚未產生結論。")}</p>}
    {!!state.room.interimResults?.length && <section className="surface-card padded" aria-label={translate("已審查的階段成果")}>
      <h3>{translate("已審查的階段成果")}</h3><p className="dock-note">{translate("這些成果已由所有座位審查；保留分歧與限制，不代表整場討論結束或事實已獲獨立驗證。")}</p>
      {state.room.interimResults.map((result, index, results) => <details key={result.id} open={index === results.length - 1}>
        <summary>{result.delivery?.status === 'partial' ? translate("階段共識 · 部分交付") : translate("階段共識 · 討論仍可繼續")}{' · v'}{result.taskVersion}</summary>
        {result.taskVersion !== state.room.taskVersion && <p className="notice warning">{translate("這是前一版任務的成果，尚未依新輸入更新。")}</p>}
        <MessageContent text={result.result}/>
        {result.delivery && <><h4>{translate("依據與說明")}</h4>{lines(result.delivery.basis)}</>}
        {result.dissent.length > 0 && <><h4>{translate("異議")}</h4>{lines(result.dissent)}</>}
        {result.unresolved.length > 0 && <><h4>{translate("未解事項")}</h4>{lines(result.unresolved)}</>}
        <p>{result.confirmed.map(id => seatOf(seats, id).name).join(' · ')}{translate(" · 已確認")}</p>
        {result.unhandledRequests.length > 0 && <p className="notice warning">{translate("仍有")}{' '}{result.unhandledRequests.length}{' '}{translate("則使用者要求未確認回應；回應標註是 AI 的聲明，不是獨立驗證。")}</p>}
        <button onClick={() => jump(result.id)}>{translate("查看來源發言")}</button>
      </details>)}
    </section>}
    {outcome ? <details><summary>{translate("查看討論過程與階段成果")}</summary><RoomProgress state={state} seats={seats} jump={jump}/></details> : <RoomProgress state={state} seats={seats} jump={jump}/>}
    <section className="surface-card padded"><h3>{translate("主題歷程")}</h3>{state.room.topicHistory.map(t => <div className="history-row" key={t.version}><em>v{t.version}</em><span>{t.title}</span><small>{t.reason}</small></div>)}</section>
    <div className="action-row"><button disabled={locked || !state.rolesConfirmed} onClick={onSummary}>{translate("整理結論")}</button><a href={`/api/discussions/${state.id}/export?format=markdown`}>{translate("匯出 Markdown")}</a><a href={`/api/discussions/${state.id}/export?format=json`}>{translate("匯出 JSON")}</a></div>
  </div></div>;
}
