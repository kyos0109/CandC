import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { RoomInput, ProviderId } from '../src/room-contract.js';
import type { EnvironmentStatus, Models } from './api.js';
import { Icon } from './Icon.js';
import { useNarrow } from './Inspector.js';
import { Segmented } from './Segmented.js';
import { SeatAvatar } from './SeatAvatar.js';
import { PROVIDERS, numberSeats, providerNames, providerSeat, seatIdsFor, userSeat } from './seats.js';
import { providerAvailability, validModelSettings } from './providers.js';
import { ModelPicker } from './ui/ModelPicker.js';
import { ProviderPicker } from './ui/ProviderPicker.js';

type Settings = RoomInput['participants'][number]['settings'];
type Side = '' | 'support' | 'oppose';
type Seat = { uid: number; provider: ProviderId; label: string; model: string; effort: Settings['effort']; side: Side; stance: string };
const sideText = { support: '支持', oppose: '反對' } as const;
let nextUid = 0;
const defaultEffort = (provider: ProviderId): Settings['effort'] => provider === 'codex' || provider === 'claude' ? 'medium' : null;
const newSeat = (provider: ProviderId): Seat => ({ uid: ++nextUid, provider, label: '', model: '', effort: defaultEffort(provider), side: '', stance: '' });
const moderatorSeat = { ...userSeat, kind: 'moderator' as const, symbol: '主', id: 'moderator' };
// Each preset previews the table it creates, so the choice reads at a glance.
const presets = [['two', '雙人', ['codex', 'claude']], ['three', '三方會審', ['codex', 'claude', 'gemini']], ['same', '同一個 AI 多觀點', ['codex', 'codex']], ['four', '四方＋主持', ['codex', 'claude', 'gemini', 'grok', 'moderator']]] as const;
const steps = [['cf-topic', '題目'], ['cf-seats', '座位與主持'], ['cf-rules', '規則']] as const;

export function RoomNewDiscussion({ environment, models, busy, onCreate, onConnection }: { environment: EnvironmentStatus | null; models: Models; busy: boolean; onCreate: (input: RoomInput) => Promise<void>; onConnection: () => void }) {
  const [backend, setBackend] = useState<'live' | 'fake'>('live'), live = backend === 'live', narrow = useNarrow('(max-width: 767px)');
  const [seats, setSeats] = useState<Seat[]>(() => [newSeat('codex'), newSeat('claude')]), [preset, setPreset] = useState(''), [picking, setPicking] = useState(false), [leaving, setLeaving] = useState<number | null>(null), focusSeat = useRef<number | null>(null);
  const [host, setHost] = useState(false), [hostProvider, setHostProvider] = useState<ProviderId>('codex'), [hostSettings, setHostSettings] = useState<Settings>({ model: '', effort: 'medium' });
  const [hostJudge, setHostJudge] = useState(false);
  const [displayName, setDisplayName] = useState(''), [topic, setTopic] = useState(''), [goal, setGoal] = useState(''), [constraints, setConstraints] = useState('');
  const [kind, setKind] = useState<RoomInput['kind']>('discussion'), [mode, setMode] = useState<RoomInput['mode']>('manual'), [flow, setFlow] = useState<RoomInput['flow']>('free');
  const [rounds, setRounds] = useState(50), [duration, setDuration] = useState(240), [timeout, setTimeout_] = useState(10), [hostCalls, setHostCalls] = useState(500);
  const [research, setResearch] = useState(false), [roots, setRoots] = useState(''), [current, setCurrent] = useState(0);
  const availability = (provider: ProviderId) => providerAvailability(environment, provider);
  const names = numberSeats(seats.map(s => ({ provider: s.provider, label: s.label })));
  const providersUsed = [...seats.map(s => s.provider), ...(host ? [hostProvider] : [])];
  const researchReady = providersUsed.every(p => p === 'codex' || p === 'claude');
  const seatsProblem = (() => {
    if (seats.length < 2) return { text: '至少需要兩個座位。', connection: false };
    if (live) {
      for (const [index, seat] of seats.entries()) { const info = availability(seat.provider); if (!info.ready) return { text: `${names[index]!.name}：${info.label}`, connection: true }; if (!validModelSettings(seat.provider, models, seat)) return { text: `${names[index]!.name}：請選擇模型與思考程度`, connection: false }; }
      if (host) { const info = availability(hostProvider); if (!info.ready) return { text: `主持人：${info.label}`, connection: true }; if (!validModelSettings(hostProvider, models, hostSettings)) return { text: '主持人：請選擇模型與思考程度', connection: false }; }
    }
    if (kind === 'debate' && seats.some(s => !s.side)) return { text: '正反辯論需要每個座位選擇支持或反對。', connection: false };
    return null;
  })();
  const problem = !topic.trim() ? { text: '請輸入討論題目。', connection: false } : seatsProblem;
  const done = [!!topic.trim(), !seatsProblem, !problem];
  const patchSeat = (uid: number, patch: Partial<Seat>) => setSeats(list => list.map(s => s.uid === uid ? { ...s, ...patch } : s));
  const pick = (provider: ProviderId, count = 2) => { setSeats(Array.from({ length: count }, () => newSeat(provider))); setPicking(false); };
  const applyPreset = (key: string) => {
    setPreset(key); setPicking(key === 'same');
    if (key === 'two') { setSeats([newSeat('codex'), newSeat('claude')]); setHost(false); }
    if (key === 'three') { setSeats([newSeat('codex'), newSeat('claude'), newSeat('gemini')]); setHost(false); }
    if (key === 'four') { setSeats(PROVIDERS.map(newSeat)); setHost(true); setHostProvider('claude'); setHostSettings({ model: '', effort: 'medium' }); }
  };
  const removeSeat = (uid: number) => { setLeaving(uid); window.setTimeout(() => { setSeats(list => list.filter(s => s.uid !== uid)); setLeaving(null); setPreset(''); }, 180); };
  // The step rail follows the section nearest the middle of the window.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) setCurrent(steps.findIndex(([id]) => id === entry.target.id)); }), { rootMargin: '-35% 0px -55% 0px' });
    steps.forEach(([id]) => { const element = document.getElementById(id); if (element) observer.observe(element); });
    return () => observer.disconnect();
  }, []);
  const goto = (id: string) => { const element = document.getElementById(id); element?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); element?.querySelector<HTMLElement>('textarea, input, [role=combobox]')?.focus({ preventScroll: true }); };
  const status = live ? (provider: ProviderId) => { const info = availability(provider); return { label: info.label, ready: info.ready }; } : undefined;
  // Every seat and the moderator always render the same controls, so changing the reply source or the discussion form never changes their height.
  const picker = (provider: ProviderId, value: Settings, update: (next: Settings) => void, label: string) => { const info = availability(provider);
    return <ModelPicker provider={provider} label={label} value={value} models={models} demo={!live} disabled={live && !info.ready} disabledReason={live && !info.ready ? info.label : undefined} onChange={update}/>; };
  const summary = `${seats.length} 個座位${host ? ' ＋ 主持人' : ''} · ${mode === 'manual' ? '手動' : mode === 'auto' ? '自動' : '有結論就停'} · ${kind === 'debate' ? '正反辯論' : '共同分析'}${live ? '' : ' · 示範'}`;
  const progress = done.filter(Boolean).length;
  return <section className="create-page">
    <header className="cf-hero"><h1>新討論</h1><p className="lead">寫下題目，安排誰來討論。</p></header>
    <nav className="cf-rail" aria-label="建立步驟"><ol style={{ '--progress': progress } as CSSProperties}>{steps.map(([id, title], index) => <li key={id} className={(done[index] ? 'done ' : '') + (current === index ? 'current' : '')}>
      <a href={`#${id}`} aria-current={current === index ? 'step' : undefined} onClick={e => { e.preventDefault(); goto(id); }}><span className="cf-dot">{done[index] ? <Icon name="check"/> : index + 1}</span>{title}</a></li>)}</ol></nav>
    <form onSubmit={async e => { e.preventDefault();
      const ids = seatIdsFor(seats.map(s => s.provider)), resolve = (provider: ProviderId, s: Settings): Settings => live ? s : { model: `demo-${provider}`, effort: provider === 'gemini' || provider === 'grok' ? null : s.effort };
      await onCreate({ behaviorVersion: 3, ...(displayName.trim() ? { displayName } : {}), topic, goal, constraints, backend, kind, mode, flow,
        participants: seats.map((s, i) => ({ id: ids[i]!, provider: s.provider, role: 'speaker' as const, instructions: kind === 'debate' ? [sideText[s.side as 'support' | 'oppose'], s.stance.trim()].filter(Boolean).join('：') : s.stance, ...(s.label.trim() ? { label: s.label.trim() } : {}), settings: resolve(s.provider, { model: s.model, effort: s.effort }) })),
        moderator: host ? { id: 'moderator', role: 'moderator', provider: hostProvider, settings: resolve(hostProvider, hostSettings) } : null,
        ...(host ? { moderatorMode: hostJudge ? 'judge' as const : 'facilitator' as const } : {}),
        discussionPolicyVersion: 1,
        research: live && research && researchReady, roots: live && research && researchReady ? roots.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [],
        limits: { maxRounds: rounds, maxDurationMs: duration * 60_000, turnTimeoutMs: timeout * 60_000, maxModeratorCalls: hostCalls } });
    }}>
      <section className="cf-section" id="cf-topic" aria-labelledby="cf-topic-h"><h2 className="cf-heading" id="cf-topic-h"><span className="step-no">1</span>題目</h2>
        <div className="cf-stage"><textarea aria-label="討論題目" autoFocus={!narrow} required rows={5} maxLength={32000} value={topic} onChange={e => setTopic(e.target.value)} placeholder="寫下題目、需要解決的問題與背景。"/>
          <div className="cf-stage-foot"><details className="supplement"><summary>＋ 補充目標與限制</summary><div className="supplement-fields"><label>顯示名稱（選填）<input aria-label="顯示名稱" maxLength={120} value={displayName} onChange={e => setDisplayName(e.target.value)}/></label><div className="grid-two"><label>期望成果<textarea aria-label="期望成果" rows={2} value={goal} maxLength={32000} onChange={e => setGoal(e.target.value)}/></label><label>限制<textarea aria-label="限制" rows={2} value={constraints} maxLength={32000} onChange={e => setConstraints(e.target.value)}/></label></div></div></details>
            <span className="cf-count" aria-hidden="true">{topic.length ? `${topic.length.toLocaleString()} 字` : ''}</span></div></div></section>

      <section className="cf-section" id="cf-seats" aria-labelledby="cf-seats-h"><h2 className="cf-heading" id="cf-seats-h"><span className="step-no">2</span>座位與主持<small>發言者 {seats.length} / 4</small></h2>
        <div className="connection-check" role="status" aria-label="連線檢查"><ul>{PROVIDERS.map(p => { const info = availability(p); return <li key={p} className={info.ready ? '' : 'bad'}><i/><span><b>{providerNames[p]}</b> · {info.ready ? '就緒' : info.label}</span></li>; })}</ul><button type="button" onClick={onConnection}>查看連線與重新檢查</button></div>
        <div className="preset-row">{picking
          ? <><div className="provider-picker" role="group" aria-label="選擇要重複使用的 AI"><span>用哪一個 AI？</span>{PROVIDERS.map(p => <button type="button" key={p} onClick={() => pick(p)}><SeatAvatar seat={providerSeat(p)} size="sm"/>{providerNames[p]}</button>)}</div><button type="button" className="preset-cancel" onClick={() => { setPicking(false); setPreset(''); }}>取消</button></>
          : presets.map(([key, label, preview]) => <button type="button" key={key} aria-pressed={preset === key} onClick={() => applyPreset(key)}><span className="preset-seats" aria-hidden="true">{preview.map((p, i) => <SeatAvatar key={i} size="sm" seat={p === 'moderator' ? moderatorSeat : { ...providerSeat(p), symbol: key === 'same' && i === 1 ? 'C2' : providerSeat(p).symbol, alt: key === 'same' && i === 1 }}/>)}</span><span className="preset-label">{label}</span></button>)}</div>
        <div className="cf-seats">
          {seats.map((seat, index) => { const n = names[index]!, label = `座位 ${index + 1}`, info = availability(seat.provider);
            return <div className={'seat-row' + (leaving === seat.uid ? ' leaving' : '')} key={seat.uid} style={{ '--dot': `var(--${seat.provider})`, '--i': index } as CSSProperties}>
              <div className="seat-head"><SeatAvatar size="lg" seat={{ ...providerSeat(seat.provider), symbol: n.symbol, alt: n.alt }}/>
                <input className="seat-name" aria-label={`${label} 名稱`} maxLength={40} value={seat.label} placeholder={n.fallback} ref={el => { if (el && focusSeat.current === seat.uid) { focusSeat.current = null; el.focus(); } }} onChange={e => patchSeat(seat.uid, { label: e.target.value })}/>
                <ProviderPicker label={label} value={seat.provider} status={status} onChange={provider => { patchSeat(seat.uid, { provider, model: '', effort: defaultEffort(provider) }); setPreset(''); }}/>
                <button type="button" className="seat-remove" aria-label={`移除${label}`} disabled={seats.length <= 2} onClick={() => removeSeat(seat.uid)}><Icon name="x"/></button></div>
              {picker(seat.provider, seat, next => patchSeat(seat.uid, next), label)}
              <div className="seat-stance-row">{kind === 'debate' && <Segmented label={`${label} 立場方向`} name={`side-${seat.uid}`} value={seat.side as 'support' | 'oppose'} options={[['support', '支持'], ['oppose', '反對']]} onChange={side => patchSeat(seat.uid, { side })}/>}
                <input className="seat-stance" aria-label={`${label} 立場`} maxLength={4000} value={seat.stance} placeholder={kind === 'debate' ? '補充主張（選填）' : '角度或任務（選填），例如：維運成本'} onChange={e => patchSeat(seat.uid, { stance: e.target.value })}/></div>
              <div className="seat-foot">{live ? <span className={'chip ' + (info.ready ? 'ok' : 'warn')}>{info.label}</span> : <span className="chip">示範</span>}</div></div>; })}
          {seats.length < 4 && <button type="button" className="add-seat" onClick={() => { const added = newSeat(PROVIDERS.find(p => !seats.some(s => s.provider === p)) ?? 'codex'); focusSeat.current = added.uid; setSeats(list => [...list, added]); setPreset(''); }}><Icon name="plus"/>加一個座位</button>}
        </div>
        <p className="seat-hint">同一個 AI 可以坐多個座位，各自使用獨立 session；你私訊某個座位時，其他座位都看不到。</p>
        <div className={'host-card' + (host ? ' on' : '')}><SeatAvatar size="lg" seat={moderatorSeat}/><div className="host-copy"><strong>獨立主持人{host && live && <span className={'chip ' + (availability(hostProvider).ready ? 'ok' : 'warn')}>{providerNames[hostProvider]} · {availability(hostProvider).label}</span>}</strong><small>預設協調發言，由其他 AI 主導討論並確認共識。只看公開對話，永遠使用另一個獨立 session。</small></div>
          <input type="checkbox" className="switch" role="switch" aria-label="啟用獨立主持人" checked={host} onChange={e => setHost(e.target.checked)}/>
          {host && <div className="host-settings"><ProviderPicker label="主持人" value={hostProvider} status={status} onChange={p => { setHostProvider(p); setHostSettings({ model: '', effort: defaultEffort(p) }); }}/>{picker(hostProvider, hostSettings, setHostSettings, '主持人')}<label><input type="checkbox" aria-label="主持人裁判模式" checked={hostJudge} onChange={e => setHostJudge(e.target.checked)}/>裁判模式 · 允許強制介入</label><small>{hostJudge ? '允許中止發言、靜音、改題（先通知）及主持裁決；裁決不代表全體共識。' : '只協調與整理；不能強制中止、改題或單方結束討論。'}</small></div>}</div>
      </section>

      <section className="cf-section" id="cf-rules" aria-labelledby="cf-rules-h"><h2 className="cf-heading" id="cf-rules-h"><span className="step-no">3</span>規則</h2>
        <div className="cf-rules">
          <div className="rule-card"><span className="rule-title">回覆來源</span><Segmented label="回覆來源" name="room-backend" value={backend} onChange={setBackend} options={[['live', '真實 AI'], ['fake', '示範']]}/><span className="rule-note">{live ? '僅使用官方 CLI 的訂閱登入。' : '測試回覆，不呼叫 AI。'}</span></div>
          <div className="rule-card"><span className="rule-title">討論形式</span><Segmented label="討論方式" name="room-kind" value={kind} onChange={setKind} options={[['discussion', '共同分析'], ['debate', '正反辯論']]}/><span className="rule-note">{kind === 'debate' ? '每個座位需要明確立場。' : '互相補充與核對；立場欄可留白。'}</span></div>
          <div className="rule-card"><span className="rule-title">執行模式</span><Segmented label="進行方式" name="room-mode" value={mode} onChange={setMode} options={[['manual', '手動'], ['auto', '自動'], ['conclusion', '有結論就停']]}/><span className="rule-note">{mode === 'manual' ? '每次回覆後等你。' : mode === 'auto' ? '持續進行到上限。' : '座位確認同一版結論就停。'}</span></div>
          <div className="rule-card"><span className="rule-title">發言順序</span><Segmented label="發言方式" name="room-flow" value={flow} disabled={host && hostJudge} onChange={setFlow} options={[['free', '自由對話'], ['alternating', '輪流發言']]}/><span className="rule-note">{host && hostJudge ? '裁判模式由主持人安排。' : flow === 'free' ? '誰有話就接。' : '依座位順序輪流。'}</span></div>
          <label className="rule-card switch-card"><span className="rule-title">網路研究</span><input type="checkbox" className="switch" aria-label="網路研究" disabled={!live || !researchReady} checked={live && research && researchReady} onChange={e => setResearch(e.target.checked)}/><span className="rule-note">{!live ? '示範模式不呼叫 AI，也不查詢網路。' : researchReady ? '可查公開網頁及授權的本機文字資料。' : '所選供應商的研究隔離尚未驗證。'}</span></label>
          <details className="rule-card limits"><summary>執行上限 · {rounds} 輪 · {duration} 分鐘{host ? ` · 主持人 ${hostCalls} 次` : ''}</summary><div className="grid-two">{([['最多輪次', rounds, setRounds, 1000], ['總時間（分鐘）', duration, setDuration, 1440], ['單次回覆（分鐘）', timeout, setTimeout_, 60], ['主持人最多呼叫次數', hostCalls, setHostCalls, 10000]] as const).map(([name, value, change, max]) => <label key={name}>{name}<input aria-label={name} type="number" required min={1} max={max} value={value} onChange={e => change(e.target.valueAsNumber)}/></label>)}</div></details>
        </div>
        {live && research && researchReady && <label className="settings-detail">可讀取的本機目錄<textarea aria-label="可讀取的本機目錄" value={roots} onChange={e => setRoots(e.target.value)} placeholder="每行一個完整路徑"/></label>}
      </section>
      {live && seats.some(s => s.provider === 'codex') && models.error && <div className="notice warning" role="status">{models.error}<button type="button" onClick={onConnection}>查看連線</button></div>}
      <div className="start-bar"><div className={'start-bar-inner' + (problem ? '' : ' ready')}><span className="seat-strip" aria-hidden="true">{seats.map((s, i) => <SeatAvatar key={s.uid} seat={{ ...providerSeat(s.provider), symbol: names[i]!.symbol, alt: names[i]!.alt }} size="sm"/>)}{host && <SeatAvatar seat={moderatorSeat} size="sm"/>}</span>
        <span className="summary">{summary}</span>{problem && <span className="why">{problem.text}</span>}{problem?.connection && <button type="button" onClick={onConnection}>查看連線</button>}
        <button className="primary" disabled={busy || !!problem}>{kind === 'debate' ? '建立並開始辯論 →' : '建立並開始討論 →'}</button></div></div>
    </form></section>;
}
