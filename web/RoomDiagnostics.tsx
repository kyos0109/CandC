import type { RoomDiscussion } from '../src/room-contract';
import { PerformancePanel } from './PerformancePanel';
import { hhmm } from './RoomParts';
import { seatOf, type SeatView } from './seats';

type Seats = Record<string, SeatView>;
const purposes = { discussion: '發言', moderation: '主持', monitor: '監看', summary: '整理' };
const statuses = { prepared: '進行中', completed: '完成', cancelled: '已中止', failed: '失敗' };
const seconds = (ms: number | null) => ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`;

/** Diagnostics tab: calls, sessions, every moderator command (including routine observe), sources and performance. */
export function RoomDiagnostics({ state, seats }: { state: RoomDiscussion; seats: Seats }) {
  const name = (id: string) => seatOf(seats, id).name, callTime = (id: string) => state.room.calls.find(call => call.id === id)?.startedAt;
  return <div className="room-page"><div className="room-page-inner">
    <h1>診斷</h1><p className="lead">呼叫按 agent、session 與任務版本記錄；接收輸入與完成回答分別保存。</p>
    <section className="surface-card"><div className="table-wrap"><table className="data-table"><thead><tr><th>座位</th><th>用途</th><th>狀態</th><th>耗時</th><th>任務版本</th><th>Native session</th></tr></thead>
      <tbody>{state.room.calls.length === 0 ? <tr><td colSpan={6}>尚無呼叫。</td></tr> : state.room.calls.map(call => <tr key={call.id}><td>{name(call.participant)}</td><td>{purposes[call.purpose]}</td><td>{statuses[call.status]}{call.controlDiagnostic && <small> · 控制檢查：{call.controlDiagnostic}</small>}</td><td>{seconds(call.durationMs)}</td><td>v{call.taskVersion}</td><td className="mono">{call.nativeSessionId?.slice(0, 18) ?? '—'}</td></tr>)}</tbody></table></div></section>
    <section className="surface-card"><div className="table-wrap"><table className="data-table"><thead><tr><th>座位</th><th>供應商</th><th>目前 session</th><th>已送達訊息</th></tr></thead>
      <tbody>{[...state.participants, ...(state.moderator ? [state.moderator] : [])].map(p => { const session = Object.hasOwn(state.room.sessions, p.id) ? state.room.sessions[p.id] : undefined; return <tr key={p.id}><td>{name(p.id)}</td><td>{p.provider}</td><td className="mono">{session?.id.slice(0, 18) ?? '尚未建立／已退役'}</td><td>{session?.delivered.length ?? 0}</td></tr>; })}</tbody></table></div></section>
    {state.moderator && <section className="surface-card padded"><h3>主持人指令</h3>
      {state.room.commands.length === 0 ? <p className="dock-note">尚無指令。</p> : state.room.commands.map(command => { const at = callTime(command.callId), a = command.action; return <div className="history-row" key={command.id}><em>{at ? hhmm(at) : '—'}</em><span>{a.type}{'target' in a ? ` → ${name(a.target)}` : ''}</span><small>{command.applied ? '已套用' : '未套用'}{'reason' in a ? ` · ${a.reason}` : ''}</small></div>; })}</section>}
    <section className="surface-card padded"><h3>可核對的來源 · {state.evidence.length}</h3>
      {state.evidence.length ? state.evidence.map((item, index) => <details key={index}><summary>{item.source} · {name(item.owner ?? 'user')}</summary><small>{item.retrievedAt} · SHA256 {item.sha256}</small><pre>{item.text}</pre></details>) : <p className="dock-note">尚無資料工具取得的來源；回覆中的連結不代表已驗證。</p>}</section>
    <section className="surface-card padded"><PerformancePanel discussionId={state.id}/></section>
    <details className="surface-card padded"><summary>原始呼叫紀錄</summary>{state.room.calls.map(call => <details key={call.id}><summary>{name(call.participant)} · {purposes[call.purpose]} · {statuses[call.status]}</summary><pre>{JSON.stringify({ ...call, draft: call.draft ? { turnId: call.draft.turnId, through: call.draft.through } : null }, null, 2)}</pre></details>)}</details>
  </div></div>;
}
