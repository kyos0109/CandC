import { useEffect, useState } from 'react';
import type { RoomDiscussion } from '../src/room-contract';
import { api } from './api';

type Perform = (action: () => Promise<unknown>) => Promise<void>;
const limitFields = [['最多輪次', 'maxRounds', 1, 1000], ['總時間（分鐘）', 'maxDurationMs', 60000, 1440], ['單次回覆（分鐘）', 'turnTimeoutMs', 60000, 60], ['主持人最多呼叫次數', 'maxModeratorCalls', 1, 10000]] as const;

/** Settings tab: run mode, limits, topic and task, display name and the topic history. */
export function RoomSettings({ state, locked, busy, perform }: { state: RoomDiscussion; locked: boolean; busy: boolean; perform: Perform }) {
  const [limits, setLimits] = useState(state.limits), [topic, setTopic] = useState(state.topic), [goal, setGoal] = useState(state.goal), [constraints, setConstraints] = useState(state.constraints), [name, setName] = useState(state.displayName ?? '');
  const [roots, setRoots] = useState(state.roots.join('\n'));
  const [researchEnabled, setResearchEnabled] = useState(state.research);
  const [judgeEnabled, setJudgeEnabled] = useState(state.moderatorMode === 'judge');
  const researchReady = state.backend === 'live' && [...state.participants, ...(state.moderator ? [state.moderator] : [])].every(p => ['codex', 'claude'].includes(p.provider));
  useEffect(() => { setLimits(state.limits); setTopic(state.topic); setGoal(state.goal); setConstraints(state.constraints); }, [state.room.configurationVersion]);
  useEffect(() => { setName(state.displayName ?? ''); }, [state.displayName]);
  useEffect(() => { setRoots(state.roots.join('\n')); }, [state.room.configurationVersion]);
  useEffect(() => { if (!locked) setResearchEnabled(state.research); }, [locked, state.research, state.room.configurationVersion]);
  useEffect(() => { if (!locked) setJudgeEnabled(state.moderatorMode === 'judge'); }, [locked, state.moderatorMode, state.room.configurationVersion]);
  const configure = (patch: object) => api(`/api/discussions/${state.id}`, 'PATCH', { ...patch, expectedVersion: state.room.configurationVersion });
  return <div className="settings-panel">
    {state.moderator && <section><h3>主持人權限</h3><label><input type="checkbox" aria-label="主持人裁判模式" checked={judgeEnabled} disabled={locked} onChange={e => { const judge = e.target.checked; setJudgeEnabled(judge); void perform(() => configure({ moderatorMode: judge ? 'judge' : 'facilitator' })); }}/>裁判模式 · 允許強制介入</label><p className="dock-note">{judgeEnabled ? '可中止、靜音、通知後改題及單方裁決；裁決不代表共識。' : '一般主持只協調；正式結論由全部發言者確認。'} 切換會保留歷史並重建 session，不會自動發言。</p></section>}
    <section><h3>主動討論</h3><p>{state.discussionPolicyVersion === 1 ? '已啟用：優先研究、分析及核對，待補充問題集中保存。' : '這份紀錄使用原有策略。啟用後會保留歷史並重建獨立工作階段。'}</p>{state.discussionPolicyVersion !== 1 && <button disabled={locked} onClick={() => void perform(() => configure({ discussionPolicyVersion: 1 }))}>啟用主動討論</button>}</section>
    <section><h3>網路研究</h3><label><input type="checkbox" aria-label="啟用討論研究" checked={researchEnabled} disabled={locked || (!researchReady && !state.research)} onChange={e => { const research = e.target.checked; setResearchEnabled(research); void perform(() => configure({ research })); }}/>允許發言者查詢公開資料</label><p className="dock-note">{researchReady ? '更新權限會重建工作階段，保留已確認回答；保存後需自行續談。' : '示範模式或所選供應商的研究權限尚未驗證。'}</p>{state.research && <form onSubmit={e => { e.preventDefault(); void perform(() => configure({ roots: roots.split(/\r?\n/).map(r => r.trim()).filter(Boolean) })); }}><label>可讀取的本機目錄<textarea aria-label="調整研究目錄" value={roots} onChange={e => setRoots(e.target.value)} placeholder="每行一個完整路徑；空白表示只查公開網頁"/></label><button disabled={locked}>保存研究範圍</button></form>}</section>
    <label>執行模式<select aria-label="進行方式" disabled={locked} value={state.mode} onChange={e => void perform(() => configure({ mode: e.target.value }))}><option value="manual">手動</option><option value="auto">自動</option><option value="conclusion">有結論就停</option></select></label>
    <form onSubmit={e => { e.preventDefault(); const { maxModeratorCalls, ...ordinary } = limits; void perform(() => configure({ limits: ordinary, maxModeratorCalls })); }}>
      <div className="grid-two">{limitFields.filter(([, key]) => key !== 'maxModeratorCalls' || state.moderator).map(([label, key, multiplier, max]) => <label key={key}>{label}<input aria-label={`調整${label}`} type="number" required min={1} max={max} value={limits[key] / multiplier} onChange={e => setLimits(current => ({ ...current, [key]: e.target.valueAsNumber * multiplier }))}/></label>)}</div>
      <button disabled={locked}>更新上限</button>
    </form>
    <details><summary>編輯題目與任務</summary><form onSubmit={e => { e.preventDefault(); void perform(() => configure({ topic, goal, constraints })); }}>
      {([['題目', topic, setTopic], ['目標', goal, setGoal], ['限制', constraints, setConstraints]] as const).map(([label, value, update]) => <label key={label}>{label}<textarea aria-label={`編輯${label}`} maxLength={32000} value={value} onChange={e => update(e.target.value)}/></label>)}
      <button disabled={locked}>保存題目與任務</button></form></details>
    <form onSubmit={e => { e.preventDefault(); void perform(() => api(`/api/discussions/${state.id}/display-name`, 'PATCH', { displayName: name, expectedVersion: state.displayVersion ?? 0 })); }}>
      <label>顯示名稱<input aria-label="顯示名稱" maxLength={120} value={name} disabled={locked} onChange={e => setName(e.target.value)}/></label><small>空白時顯示題目第一行。更名不改變任務或確認。</small><button disabled={locked || busy}>儲存名稱</button></form>
    <details open><summary>主題歷程</summary>{state.room.topicHistory.map(t => <p key={t.version}>版本 {t.version}：{t.title}<br/><small>{t.reason}</small></p>)}<p><small>原始目標：{state.goal || '同題目'}<br/>限制：{state.constraints || '未另訂限制'}</small></p></details>
  </div>;
}
