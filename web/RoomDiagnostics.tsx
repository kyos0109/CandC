import { translate } from './i18n.js';
import type { RoomDiscussion } from '../src/room-contract';
import { PerformancePanel } from './PerformancePanel';
import { hhmm } from './RoomParts';
import { seatOf, type SeatView } from './seats';

type Seats = Record<string, SeatView>;
const purposes = { get discussion() { return translate("發言"); }, get moderation() { return translate("主持"); }, get monitor() { return translate("監看"); }, get summary() { return translate("整理"); } };
const statuses = { get prepared() { return translate("進行中"); }, get completed() { return translate("完成"); }, get cancelled() { return translate("已中止"); }, get failed() { return translate("失敗"); } };
const seconds = (ms: number | null) => ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`;
const metadataLabels = {
  'work-schema': '工作回報格式無效', 'work-reference': '工作回報來源或權限無效', 'work-limit': '工作回報超過容量',
  'references-schema': '回應引用格式無效', references: '回應引用不在可見內容內', 'delivery-schema': '交付說明格式無效',
  'review-schema': '審查說明格式無效', 'proposal-reference': '確認未對應目前的同儕提案', 'unsupported-action': '此角色不處理提案或確認',
  'control-schema': '控制資料格式無效，已保留發言並採用中性動作', 'delivery-repair-limit': '交付格式修復已達上限，這次提案未採用，討論繼續',
};

/** Diagnostics tab: calls, sessions, every moderator command (including routine observe), sources and performance. */
export function RoomDiagnostics({ state, seats }: { state: RoomDiscussion; seats: Seats }) {
  const name = (id: string) => seatOf(seats, id).name, callTime = (id: string) => state.room.calls.find(call => call.id === id)?.startedAt;
  return <div className="room-page"><div className="room-page-inner">
    <h1>{translate("診斷")}</h1><p className="lead">{translate("呼叫按 agent、session 與任務版本記錄；接收輸入與完成回答分別保存。")}</p>
    <section className="surface-card"><div className="table-wrap"><table className="data-table"><thead><tr><th>{translate("座位")}</th><th>{translate("用途")}</th><th>{translate("狀態")}</th><th>{translate("耗時")}</th><th>{translate("任務版本")}</th><th>Native session</th></tr></thead>
      <tbody>{state.room.calls.length === 0 ? <tr><td colSpan={6}>{translate("尚無呼叫。")}</td></tr> : state.room.calls.map(call => <tr key={call.id}><td>{name(call.participant)}</td><td>{purposes[call.purpose]}</td><td>{statuses[call.status]}{call.controlDiagnostic && <small>{" "}{translate("· 控制檢查：")}{call.controlDiagnostic}</small>}{call.metadataDiagnostics?.map(code => <small key={code}>{" "}{translate("附加資料未採用：")}{translate(metadataLabels[code])}</small>)}</td><td>{seconds(call.durationMs)}</td><td>v{call.taskVersion}</td><td className="mono">{call.nativeSessionId?.slice(0, 18) ?? '—'}</td></tr>)}</tbody></table></div></section>
    <section className="surface-card"><div className="table-wrap"><table className="data-table"><thead><tr><th>{translate("座位")}</th><th>{translate("供應商")}</th><th>{translate("目前 session")}</th><th>{translate("已送達訊息")}</th></tr></thead>
      <tbody>{[...state.participants, ...(state.moderator ? [state.moderator] : [])].map(p => { const session = Object.hasOwn(state.room.sessions, p.id) ? state.room.sessions[p.id] : undefined; return <tr key={p.id}><td>{name(p.id)}</td><td>{p.provider}</td><td className="mono">{session?.id.slice(0, 18) ?? translate("尚未建立／已退役")}</td><td>{session?.delivered.length ?? 0}</td></tr>; })}</tbody></table></div></section>
    {state.moderator && <section className="surface-card padded"><h3>{translate("主持人指令")}</h3>
      {state.room.commands.length === 0 ? <p className="dock-note">{translate("尚無指令。")}</p> : state.room.commands.map(command => { const at = callTime(command.callId), a = command.action; return <div className="history-row" key={command.id}><em>{at ? hhmm(at) : '—'}</em><span>{a.type}{'target' in a ? ` → ${name(a.target)}` : ''}</span><small>{command.applied ? translate("已套用") : translate("未套用")}{'reason' in a ? ` · ${a.reason}` : ''}</small></div>; })}</section>}
    <section className="surface-card padded"><h3>{translate("可核對的來源 ·")}{" "}{state.evidence.length}</h3>
      {state.evidence.length ? state.evidence.map((item, index) => <details key={index}><summary>{item.source} · {name(item.owner ?? 'user')}</summary><small>{item.retrievedAt} · SHA256 {item.sha256}</small><pre>{item.text}</pre></details>) : <p className="dock-note">{translate("尚無資料工具取得的來源；回覆中的連結不代表已驗證。")}</p>}</section>
    <section className="surface-card padded"><PerformancePanel discussionId={state.id}/></section>
    <details className="surface-card padded"><summary>{translate("原始呼叫紀錄")}</summary>{state.room.calls.map(call => <details key={call.id}><summary>{name(call.participant)} · {purposes[call.purpose]} · {statuses[call.status]}</summary><pre>{JSON.stringify({ ...call, draft: call.draft ? { turnId: call.draft.turnId, through: call.draft.through } : null }, null, 2)}</pre></details>)}</details>
  </div></div>;
}
