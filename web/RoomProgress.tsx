import type { RoomDiscussion } from '../src/room-contract';
import { MessageContent } from './MessageContent';
import { seatOf, type SeatView } from './seats';

export function RoomProgress({ state, seats, jump }: { state: RoomDiscussion; seats: Record<string, SeatView>; jump: (id: string) => void }) {
  const work = state.room.workflow, stage = work?.checkpoint;
  const fallback = state.messages.filter(m => m.recipient === 'all' && m.status === 'completed' && m.sender !== 'user' && ['discussion', 'summary'].includes(m.purpose)).slice(-2);
  const index = stage ? state.messages.findIndex(m => m.id === stage.messageId) : -1;
  const newer = stage ? state.messages.slice(index + 1).filter(m => m.recipient === 'all' && m.status === 'completed' && m.sender !== 'user' && ['discussion', 'summary'].includes(m.purpose)) : [];
  const questions = work?.questions.filter(q => q.status === 'pending') ?? [];
  const tasks = work?.tasks.filter(t => t.status === 'pending') ?? [];
  return <section className="surface-card padded stage-progress" aria-label="階段成果">
    <h3>{state.room.outcome ? '歷史階段成果' : stage?.kind === 'synthesis' ? '階段整理 · 尚未完成結論交付' : '已保存分析 · 尚未完成結論交付'}</h3>
    <p className="dock-note">{state.room.outcome ? '這是討論過程中的分析；最終交付以上方結果為準。' : '這是過程中的分析，尚未完成結論交付。'} AI 的整理與核對不代表事實已獲獨立驗證。</p>
    {stage ? <>
      {stage.taskVersion !== state.room.taskVersion && <p className="notice warning">這是前一版任務的成果，尚未依新輸入更新。</p>}
      <MessageContent text={stage.answer}/>
      {([['支持理由', stage.reasons], ['分歧', stage.dissent], ['待查事項', stage.unknowns]] as const).map(([title, items]) => items.length > 0 && <div key={title}><h4>{title}</h4><ul>{items.map((text, i) => <li key={i}>{text}</li>)}</ul></div>)}
      <div className="action-row">{stage.sources.map(id => <button key={id} onClick={() => jump(id)}>查看 {seatOf(seats, state.messages.find(m => m.id === id)?.sender ?? 'user').name} 的來源發言</button>)}</div>
    </> : fallback.length ? fallback.map(m => <details key={m.id} open={m.purpose === 'summary'}><summary>{m.purpose === 'summary' ? '已保存整理' : '已保存分析'} · {seatOf(seats, m.sender).name}</summary><MessageContent text={m.text}/><button onClick={() => jump(m.id)}>查看來源發言</button></details>) : <p>尚無已完成的公開分析；未完成的生成不作為結論。</p>}
    {newer.length > 0 && <p className="notice">另有 {newer.length} 則已完成回答尚未納入這份整理。{newer.map(m => <button key={m.id} onClick={() => jump(m.id)}>查看 {seatOf(seats, m.sender).name}</button>)}</p>}
    {questions.length > 0 && <div><h4>待你補充 · 不自動阻塞其他分析</h4><ul>{questions.map(q => <li key={q.key}><strong>{q.text}</strong><p>{q.reason}</p></li>)}</ul></div>}
    {tasks.length > 0 && <div><h4>下一步任務</h4><ul>{tasks.map(t => <li key={t.key}><strong>{t.kind === 'research' ? '研究' : t.kind === 'check' ? '核對' : '分析'}{t.target && ' · ' + seatOf(seats, t.target).name}</strong><p>{t.task}</p>{t.kind === 'research' && !state.research && <small>研究未啟用；此任務尚未執行。</small>}{t.target && state.room.muted.includes(t.target) && <small>此座位已停止發言，任務目前不可執行。</small>}</li>)}</ul></div>}
  </section>;
}
