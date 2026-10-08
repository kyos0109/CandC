import { translate } from './i18n.js';
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
import { AttachmentPicker } from './Attachments.js';
import { applyDiscussionTemplate, discussionTemplates, emptyTemplateOrigins, retainTemplateSeats, type DiscussionTemplate, type TemplateOrigins, type TemplateSeat } from './discussion-templates.js';

type Settings = RoomInput['participants'][number]['settings'];
type Side = '' | 'support' | 'oppose';
type Seat = { uid: number; provider: ProviderId; label: string; model: string; effort: Settings['effort']; side: Side; stance: string };
type TemplateUndo = { goal: string; kind: RoomInput['kind']; mode: RoomInput['mode']; seats: TemplateSeat[]; origins: TemplateOrigins };
const sideText = { get support() { return translate("支持"); }, get oppose() { return translate("反對"); } } as const;
let nextUid = 0;
const defaultEffort = (provider: ProviderId): Settings['effort'] => provider === 'codex' || provider === 'claude' ? 'medium' : null;
const newSeat = (provider: ProviderId): Seat => ({ uid: ++nextUid, provider, label: '', model: '', effort: defaultEffort(provider), side: '', stance: '' });
const moderatorSeat = { ...userSeat, kind: 'moderator' as const, get symbol() { return translate("主"); }, id: 'moderator' };
// Each preset previews the table it creates, so the choice reads at a glance.
const presets = () => [['two', translate("雙人"), ['codex', 'claude']], ['three', translate("三方會審"), ['codex', 'claude', 'gemini']], ['same', translate("同一個 AI 多觀點"), ['codex', 'codex']], ['four', translate("四方＋主持"), ['codex', 'claude', 'gemini', 'grok', 'moderator']]] as const;
const steps = () => [['cf-topic', translate("題目")], ['cf-seats', translate("座位與主持")], ['cf-rules', translate("規則")]] as const;

export function RoomNewDiscussion({ environment, models, busy, onCreate: submitCreation, onConnection }: { environment: EnvironmentStatus | null; models: Models; busy: boolean; onCreate: (input: RoomInput, files?: File[], id?: string) => Promise<void>; onConnection: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const retry = useRef<{ key: string; files: File[]; id: string } | null>(null);
  const onCreate = async (input: RoomInput) => {
    const key = JSON.stringify(input);
    if (!retry.current || retry.current.key !== key || retry.current.files !== files) retry.current = { key, files, id: crypto.randomUUID() };
    await submitCreation(input, input.kind === 'selection' ? [] : files, retry.current.id);
  };
  const [backend, setBackend] = useState<'live' | 'fake'>('live'), live = backend === 'live', narrow = useNarrow('(max-width: 767px)');
  const [seats, setSeats] = useState<Seat[]>(() => [newSeat('codex'), newSeat('claude')]), [preset, setPreset] = useState(''), [picking, setPicking] = useState(false), [leaving, setLeaving] = useState<number | null>(null), focusSeat = useRef<number | null>(null);
  const [host, setHost] = useState(false), [hostProvider, setHostProvider] = useState<ProviderId>('codex'), [hostSettings, setHostSettings] = useState<Settings>({ model: '', effort: 'medium' });
  const [hostJudge, setHostJudge] = useState(false);
  const [displayName, setDisplayName] = useState(''), [topic, setTopic] = useState(''), [goal, setGoal] = useState(''), [constraints, setConstraints] = useState('');
  const [kind, setKind] = useState<RoomInput['kind']>('discussion'), [mode, setMode] = useState<RoomInput['mode']>('manual'), [flow, setFlow] = useState<RoomInput['flow']>('free');
  const [template, setTemplate] = useState<DiscussionTemplate | null>(null);
  const [templateOrigins, setTemplateOrigins] = useState(emptyTemplateOrigins), [templateUndo, setTemplateUndo] = useState<TemplateUndo | null>(null);
  const supplement = useRef<HTMLDetailsElement>(null), resetButton = useRef<HTMLButtonElement>(null);
  const templates = discussionTemplates();
  const applyTemplate = (choice: DiscussionTemplate, reset = false) => {
    if (busy || leaving !== null || kind === 'selection') return;
    const snapshot = template?.id === choice.id ? template : choice;
    setTemplateUndo(reset ? templateUndo ?? { goal, kind, mode, seats: seats.map(({ uid, label, stance }) => ({ uid, label, stance })), origins: templateOrigins } : null);
    const result = applyDiscussionTemplate({ goal, kind, mode, seats }, snapshot, templateOrigins, reset);
    setTemplateOrigins(result.origins);
    setGoal(result.draft.goal); setKind(result.draft.kind); setMode(result.draft.mode); setSeats(result.draft.seats);
    setTemplate(snapshot);
    if (supplement.current) supplement.current.open = true;
  };
  useEffect(() => { setTemplateOrigins(origins => retainTemplateSeats(origins, seats)); }, [seats]);
  const markTemplateField = (field: 'goal' | 'kind' | 'mode') => {
    setTemplateOrigins(origins => ({ ...origins, [field]: 'user' })); setTemplateUndo(null);
  };
  const undoTemplateReset = () => {
    if (busy || leaving !== null || !templateUndo || kind === 'selection') return;
    setGoal(templateUndo.goal); setKind(templateUndo.kind); setMode(templateUndo.mode);
    setSeats(list => list.map(seat => { const previous = templateUndo.seats.find(s => s.uid === seat.uid); return previous ? { ...seat, label: previous.label, stance: previous.stance } : seat; }));
    setTemplateOrigins(retainTemplateSeats(templateUndo.origins, seats)); setTemplateUndo(null); resetButton.current?.focus();
  };
  const selection = kind === 'selection';
  const [responseMode, setResponseMode] = useState<'standard' | 'single-sentence'>('standard');
  const [optionCount, setOptionCount] = useState(4);
  const [rounds, setRounds] = useState(50), [duration, setDuration] = useState(240), [timeout, setTimeout_] = useState(10), [hostCalls, setHostCalls] = useState(500);
  const [research, setResearch] = useState(false), [roots, setRoots] = useState(''), [current, setCurrent] = useState(0);
  const availability = (provider: ProviderId) => providerAvailability(environment, provider);
  const names = numberSeats(seats.map(s => ({ provider: s.provider, label: s.label })));
  const providersUsed = [...seats.map(s => s.provider), ...(host ? [hostProvider] : [])];
  const researchReady = providersUsed.every(p => p === 'codex' || p === 'claude');
  const seatProblems = (() => {
    const problems: { text: string; connection: boolean }[] = [];
    if (seats.length < 2) problems.push({ text: translate("至少需要兩個座位。"), connection: false });
    if (live) {
      for (const [index, seat] of seats.entries()) { const info = availability(seat.provider); if (!info.ready) problems.push({ text: `${names[index]!.name}：${info.label}`, connection: true }); else if (!validModelSettings(seat.provider, models, seat)) problems.push({ text: translate("{0}：請選擇模型與思考程度", names[index]!.name), connection: false }); }
      if (!selection && host) { const info = availability(hostProvider); if (!info.ready) problems.push({ text: translate("主持人：{0}", info.label), connection: true }); else if (!validModelSettings(hostProvider, models, hostSettings)) problems.push({ text: translate("主持人：請選擇模型與思考程度"), connection: false }); }
    }
    if (kind === 'debate' && seats.some(s => !s.side)) problems.push({ text: translate("正反辯論需要每個座位選擇支持或反對。"), connection: false });
    return problems;
  })();
  const seatsProblem = seatProblems[0] ?? null;
  const problem = !topic.trim() ? { text: translate("請輸入討論題目。"), connection: false } : seatsProblem;
  const done = [!!topic.trim(), !seatsProblem, !problem];
  const patchSeat = (uid: number, patch: Partial<Seat>) => {
    if (patch.label !== undefined || patch.stance !== undefined) {
      setTemplateUndo(null);
      setTemplateOrigins(previous => { const origins = previous.seats[uid] ?? { label: 'untouched', stance: 'untouched' };
        return { ...previous, seats: { ...previous.seats, [uid]: { ...origins, ...(patch.label !== undefined ? { label: 'user' as const } : {}), ...(patch.stance !== undefined ? { stance: 'user' as const } : {}) } } }; });
    }
    setSeats(list => list.map(s => s.uid === uid ? { ...s, ...patch } : s));
  };
  const pick = (provider: ProviderId, count = 2) => { setTemplateUndo(null); setSeats(Array.from({ length: count }, () => newSeat(provider))); setPicking(false); };
  const applyPreset = (key: string) => {
    setTemplateUndo(null); setPreset(key); setPicking(key === 'same');
    if (key === 'two') { setSeats([newSeat('codex'), newSeat('claude')]); setHost(false); }
    if (key === 'three') { setSeats([newSeat('codex'), newSeat('claude'), newSeat('gemini')]); setHost(false); }
    if (key === 'four') { setSeats(PROVIDERS.map(newSeat)); setHost(true); setHostProvider('claude'); setHostSettings({ model: '', effort: 'medium' }); }
  };
  const removeSeat = (uid: number) => { setTemplateUndo(null); setLeaving(uid); window.setTimeout(() => { setSeats(list => list.filter(s => s.uid !== uid)); setLeaving(null); setPreset(''); }, 180); };
  // The step rail follows the section nearest the middle of the window.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) setCurrent(steps().findIndex(([id]) => id === entry.target.id)); }), { rootMargin: '-35% 0px -55% 0px' });
    steps().forEach(([id]) => { const element = document.getElementById(id); if (element) observer.observe(element); });
    return () => observer.disconnect();
  }, []);
  const goto = (id: string) => { const element = document.getElementById(id); element?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); element?.querySelector<HTMLElement>('textarea, input, [role=combobox]')?.focus({ preventScroll: true }); };
  const status = live ? (provider: ProviderId) => { const info = availability(provider); return { label: info.label, ready: info.ready }; } : undefined;
  // Every seat and the moderator always render the same controls, so changing the reply source or the discussion form never changes their height.
  const picker = (provider: ProviderId, value: Settings, update: (next: Settings) => void, label: string) => { const info = availability(provider);
    return <ModelPicker provider={provider} label={label} value={value} models={models} demo={!live} disabled={live && !info.ready} disabledReason={live && !info.ready ? info.label : undefined} onChange={update}/>; };
  const summary = translate("{0} 個座位{1} · {2} · {3}{4}", seats.length, !selection && host ? translate(" ＋ 主持人") : '', selection ? translate("自動評選") : mode === 'manual' ? translate("手動") : mode === 'auto' ? translate("自動") : translate("有結論就停"), selection ? translate("選項評選") : kind === 'debate' ? translate("正反辯論") : translate("共同分析"), live ? '' : translate(" · 示範"));
  const progress = done.filter(Boolean).length;
  const customized = [
    ...(templateOrigins.goal === 'user' ? [translate("期望成果")] : []), ...(templateOrigins.kind === 'user' ? [translate("討論形式")] : []), ...(templateOrigins.mode === 'user' ? [translate("執行模式")] : []),
    ...seats.flatMap((seat, index) => { const origins = templateOrigins.seats[seat.uid], label = translate("座位 {0}", index + 1);
      return [...(origins?.label === 'user' ? [translate("{0} 名稱", label)] : []), ...(origins?.stance === 'user' ? [translate("{0} 立場", label)] : [])]; }),
  ];
  return <section className="create-page">
    <header className="cf-hero"><h1>{translate("新討論")}</h1><p className="lead">{translate("寫下題目，安排誰來討論。")}</p></header>
    <nav className="cf-rail" aria-label={translate("建立步驟")}><ol style={{ '--progress': progress } as CSSProperties}>{steps().map(([id, title], index) => <li key={id} className={(done[index] ? 'done ' : '') + (current === index ? 'current' : '')}>
      <a href={`#${id}`} aria-current={current === index ? 'step' : undefined} onClick={e => { e.preventDefault(); goto(id); }}><span className="cf-dot">{done[index] ? <Icon name="check"/> : index + 1}</span>{title}</a></li>)}</ol></nav>
    <form onSubmit={async e => { e.preventDefault();
      const ids = seatIdsFor(seats.map(s => s.provider)), resolve = (provider: ProviderId, s: Settings): Settings => live ? s : { model: `demo-${provider}`, effort: provider === 'gemini' || provider === 'grok' ? null : s.effort };
      await onCreate({ behaviorVersion: 3, ...(displayName.trim() ? { displayName } : {}), topic, goal, constraints, backend, kind, mode: selection ? 'conclusion' : mode, flow,
        ...(!selection && responseMode === 'single-sentence' ? { singleSentence: true } : {}),
        participants: seats.map((s, i) => ({ id: ids[i]!, provider: s.provider, role: 'speaker' as const, instructions: kind === 'debate' ? [sideText[s.side as 'support' | 'oppose'], s.stance.trim()].filter(Boolean).join('：') : s.stance, ...(s.label.trim() ? { label: s.label.trim() } : {}), settings: resolve(s.provider, { model: s.model, effort: s.effort }) })),
        moderator: !selection && host ? { id: 'moderator', role: 'moderator', provider: hostProvider, settings: resolve(hostProvider, hostSettings) } : null,
        ...(!selection && host ? { moderatorMode: hostJudge ? 'judge' as const : 'facilitator' as const } : {}),
        ...(selection ? { selection: { version: 1 as const, optionCount } } : { discussionPolicyVersion: 1 as const }),
        research: !selection && live && research && researchReady, roots: !selection && live && research && researchReady ? roots.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [],
        limits: { maxRounds: rounds, maxDurationMs: duration * 60_000, turnTimeoutMs: timeout * 60_000, maxModeratorCalls: hostCalls } });
    }}>
      <section className="cf-section" id="cf-topic" aria-labelledby="cf-topic-h"><h2 className="cf-heading" id="cf-topic-h"><span className="step-no">1</span>{translate("題目")}</h2>
        <div className="scenario-picker" role="group" aria-labelledby="scenario-heading" aria-describedby="scenario-help">
          <div className="scenario-heading"><h3 id="scenario-heading">{translate("討論情境（選填）")}</h3><span>{translate("預填討論欄位，保留手動修改")}</span></div>
          <div className="scenario-grid">{templates.map(choice => <button className="scenario-card" type="button" key={choice.id} aria-pressed={template?.id === choice.id} disabled={busy || selection || leaving !== null} onClick={() => applyTemplate(choice)}>
            <Icon name={choice.icon}/><strong>{choice.name}</strong><span>{choice.description}</span>
          </button>)}</div>
          <p id="scenario-help">{selection ? translate("請先將討論形式改為共同分析或正反辯論，再套用情境範本。") : translate("套用後仍可自由編輯；保留你已修改的欄位。再次點選可重新套用至未修改欄位。")}</p>
          {template && <div className="scenario-summary" role="region" aria-label={translate("目前情境設定")}>
            <strong>{template.name}</strong><span>{summary}</span>
            <p>{customized.length ? translate("已自訂：{0}", customized.join(' · ')) : translate("範本欄位尚未手動修改。")}</p>
            {!!seatProblems.length && <ul className="scenario-missing" aria-label={translate("尚待完成的設定")}>{seatProblems.map((item, index) => <li key={index}>{item.text}</li>)}</ul>}
            <div className="scenario-actions"><button type="button" onClick={() => goto('cf-seats')}>{translate("前往座位與主持")}</button>
              <button type="button" ref={resetButton} disabled={busy || selection || !!leaving} onClick={() => applyTemplate(template, true)}>{translate("重設為範本預設")}</button>
              {templateUndo && <button type="button" disabled={busy || selection || !!leaving} onClick={undoTemplateReset}>{translate("復原重設")}</button>}</div>
            <small>{translate("重設只覆寫目標、討論形式、執行模式與角色文字；其他設定保留。")}</small>
            <span role="status">{templateUndo ? translate("已重設範本欄位。修改這些欄位、變更席位或套用情境後，復原操作會失效。") : ''}</span>
          </div>}
        </div>
        <div className="cf-stage"><textarea aria-label={translate("討論題目")} autoFocus={!narrow} required rows={5} maxLength={32000} value={topic} onChange={e => setTopic(e.target.value)} placeholder={translate("寫下題目、需要解決的問題與背景。")}/>
          {!selection && <AttachmentPicker files={files} onChange={setFiles} disabled={busy}/>}
          <div className="cf-stage-foot"><details className="supplement" ref={supplement}><summary>{translate("＋ 補充目標與限制")}</summary><div className="supplement-fields"><label>{translate("顯示名稱（選填）")}<input aria-label={translate("顯示名稱")} maxLength={120} value={displayName} onChange={e => setDisplayName(e.target.value)}/></label><div className="grid-two"><label>{translate("期望成果")}<textarea aria-label={translate("期望成果")} rows={2} value={goal} maxLength={32000} onChange={e => { markTemplateField('goal'); setGoal(e.target.value); }}/></label><label>{translate("限制")}<textarea aria-label={translate("限制")} rows={2} value={constraints} maxLength={32000} onChange={e => setConstraints(e.target.value)}/></label></div></div></details>
            <span className="cf-count" aria-hidden="true">{topic.length ? translate("{0} 字", topic.length.toLocaleString()) : ''}</span></div></div></section>

      <section className="cf-section" id="cf-seats" aria-labelledby="cf-seats-h"><h2 className="cf-heading" id="cf-seats-h"><span className="step-no">2</span>{translate("座位與主持")}<small>{translate("發言者")}{" "}{seats.length} / 4</small></h2>
        <div className="connection-check" role="status" aria-label={translate("連線檢查")}><ul>{PROVIDERS.map(p => { const info = availability(p); return <li key={p} className={info.ready ? '' : 'bad'}><i/><span><b>{providerNames[p]}</b> · {info.ready ? translate("就緒") : info.label}</span></li>; })}</ul><button type="button" onClick={onConnection}>{translate("查看連線與重新檢查")}</button></div>
        <div className="preset-row">{picking
          ? <><div className="provider-picker" role="group" aria-label={translate("選擇要重複使用的 AI")}><span>{translate("用哪一個 AI？")}</span>{PROVIDERS.map(p => <button type="button" key={p} onClick={() => pick(p)}><SeatAvatar seat={providerSeat(p)} size="sm"/>{providerNames[p]}</button>)}</div><button type="button" className="preset-cancel" onClick={() => { setPicking(false); setPreset(''); }}>{translate("取消")}</button></>
          : presets().filter(([key]) => !selection || key !== "four").map(([key, label, preview]) => <button type="button" key={key} aria-pressed={preset === key} onClick={() => applyPreset(key)}><span className="preset-seats" aria-hidden="true">{preview.map((p, i) => <SeatAvatar key={i} size="sm" seat={p === 'moderator' ? moderatorSeat : { ...providerSeat(p), symbol: key === 'same' && i === 1 ? 'C2' : providerSeat(p).symbol, alt: key === 'same' && i === 1 }}/>)}</span><span className="preset-label">{label}</span></button>)}</div>
        <div className="cf-seats">
          {seats.map((seat, index) => { const n = names[index]!, label = translate("座位 {0}", index + 1), info = availability(seat.provider);
            return <div className={'seat-row' + (leaving === seat.uid ? ' leaving' : '')} key={seat.uid} style={{ '--dot': `var(--${seat.provider})`, '--i': index } as CSSProperties}>
              <div className="seat-head"><SeatAvatar size="lg" seat={{ ...providerSeat(seat.provider), symbol: n.symbol, alt: n.alt }}/>
                <input className="seat-name" aria-label={translate("{0} 名稱", label)} maxLength={40} value={seat.label} placeholder={n.fallback} ref={el => { if (el && focusSeat.current === seat.uid) { focusSeat.current = null; el.focus(); } }} onChange={e => patchSeat(seat.uid, { label: e.target.value })}/>
                <ProviderPicker label={label} value={seat.provider} status={status} onChange={provider => { patchSeat(seat.uid, { provider, model: '', effort: defaultEffort(provider) }); setPreset(''); }}/>
                <button type="button" className="seat-remove" aria-label={translate("移除{0}", label)} disabled={seats.length <= 2} onClick={() => removeSeat(seat.uid)}><Icon name="x"/></button></div>
              {picker(seat.provider, { model: seat.model, effort: seat.effort }, next => patchSeat(seat.uid, { model: next.model, effort: next.effort }), label)}
              <div className="seat-stance-row">{kind === 'debate' && <Segmented label={translate("{0} 立場方向", label)} name={`side-${seat.uid}`} value={seat.side as 'support' | 'oppose'} options={[['support', translate("支持")], ['oppose', translate("反對")]]} onChange={side => patchSeat(seat.uid, { side })}/>}
                <input className="seat-stance" aria-label={translate("{0} 立場", label)} maxLength={4000} value={seat.stance} placeholder={kind === 'debate' ? translate("補充主張（選填）") : translate("角度或任務（選填），例如：維運成本")} onChange={e => patchSeat(seat.uid, { stance: e.target.value })}/></div>
              <div className="seat-foot">{live ? <span className={'chip ' + (info.ready ? 'ok' : 'warn')}>{info.label}</span> : <span className="chip">{translate("示範")}</span>}</div></div>; })}
          {seats.length < 4 && <button type="button" className="add-seat" onClick={() => { setTemplateUndo(null); const added = newSeat(PROVIDERS.find(p => !seats.some(s => s.provider === p)) ?? 'codex'); focusSeat.current = added.uid; setSeats(list => [...list, added]); setPreset(''); }}><Icon name="plus"/>{translate("加一個座位")}</button>}
        </div>
        {selection && <p className="seat-hint">{translate("第一個座位產生選項與標準；所有座位各自獨立評分，不查看其他評審分數。")}</p>}
        {!selection && <p className="seat-hint">{translate("同一個 AI 可以坐多個座位，各自使用獨立 session；你私訊某個座位時，其他座位都看不到。")}</p>}
        {!selection && <div className={'host-card' + (host ? ' on' : '')}><SeatAvatar size="lg" seat={moderatorSeat}/><div className="host-copy"><strong>{translate("獨立主持人")}{host && live && <span className={'chip ' + (availability(hostProvider).ready ? 'ok' : 'warn')}>{providerNames[hostProvider]} · {availability(hostProvider).label}</span>}</strong><small>{translate("預設協調發言，由其他 AI 主導討論並確認共識。只看公開對話，永遠使用另一個獨立 session。")}</small></div>
          <input type="checkbox" className="switch" role="switch" aria-label={translate("啟用獨立主持人")} checked={host} onChange={e => setHost(e.target.checked)}/>
          {host && <div className="host-settings"><ProviderPicker label={translate("主持人")} value={hostProvider} status={status} onChange={p => { setHostProvider(p); setHostSettings({ model: '', effort: defaultEffort(p) }); }}/>{picker(hostProvider, hostSettings, setHostSettings, translate("主持人"))}<label><input type="checkbox" aria-label={translate("主持人裁判模式")} checked={hostJudge} onChange={e => setHostJudge(e.target.checked)}/>{translate("裁判模式 · 允許強制介入")}</label><small>{hostJudge ? translate("允許中止發言、靜音、改題（先通知）及主持裁決；裁決不代表全體共識。") : translate("只協調與整理；不能強制中止、改題或單方結束討論。")}</small></div>}</div>}
      </section>

      <section className="cf-section" id="cf-rules" aria-labelledby="cf-rules-h"><h2 className="cf-heading" id="cf-rules-h"><span className="step-no">3</span>{translate("規則")}</h2>
        <div className="cf-rules">
          {!selection && <div className="rule-card"><span className="rule-title">{translate("回覆模式")}</span><Segmented label={translate("回覆模式")} name="room-response-mode" value={responseMode} onChange={setResponseMode} options={[['standard', translate("一般模式")], ['single-sentence', translate("一句模式")]]}/><span className="rule-note">{responseMode === 'single-sentence' ? translate("每個 AI 每次只用一句簡短的話回應，結論也適用") : translate("依討論需要決定回覆長度。")}</span></div>}
          <div className="rule-card"><span className="rule-title">{translate("回覆來源")}</span><Segmented label={translate("回覆來源")} name="room-backend" value={backend} onChange={setBackend} options={[['live', translate("真實 AI")], ['fake', translate("示範")]]}/><span className="rule-note">{live ? translate("僅使用官方 CLI 的訂閱登入。") : translate("測試回覆，不呼叫 AI。")}</span></div>
          <div className="rule-card" onClickCapture={e => { if ((e.target as HTMLInputElement).name === 'room-kind' && (e.target as HTMLInputElement).value === kind) markTemplateField('kind'); }}><span className="rule-title">{translate("討論形式")}</span><Segmented label={translate("討論方式")} name="room-kind" value={kind} onChange={value => { markTemplateField('kind'); setKind(value); }} options={[['discussion', translate("共同分析")], ['debate', translate("正反辯論")], ['selection', translate("選項評選")]]}/><span className="rule-note">{selection ? translate("自動產生選項，再由每個座位依三項共同標準評分。") : kind === 'debate' ? translate("每個座位需要明確立場。") : translate("互相補充與核對；立場欄可留白。")}</span></div>
          {!selection && <div className="rule-card" onClickCapture={e => { if ((e.target as HTMLInputElement).name === 'room-mode' && (e.target as HTMLInputElement).value === mode) markTemplateField('mode'); }}><span className="rule-title">{translate("執行模式")}</span><Segmented label={translate("進行方式")} name="room-mode" value={mode} onChange={value => { markTemplateField('mode'); setMode(value); }} options={[['manual', translate("手動")], ['auto', translate("自動")], ['conclusion', translate("有結論就停")]]}/><span className="rule-note">{mode === 'manual' ? translate("每輪討論後等你續談。") : mode === 'auto' ? translate("持續討論；階段共識不會自動結束，仍受停止、執行上限與可推進內容限制。") : translate("座位確認同一版結論就停。")}</span></div>}
          {!selection && <div className="rule-card"><span className="rule-title">{translate("發言順序")}</span><Segmented label={translate("發言方式")} name="room-flow" value={flow} disabled={host && hostJudge} onChange={setFlow} options={[['free', translate("自由對話")], ['alternating', translate("輪流發言")]]}/><span className="rule-note">{host && hostJudge ? translate("裁判模式由主持人安排。") : flow === 'free' ? translate("誰有話就接。") : translate("依座位順序輪流。")}</span></div>}
          {!selection && <label className="rule-card switch-card"><span className="rule-title">{translate("網路研究")}</span><input type="checkbox" className="switch" aria-label={translate("網路研究")} disabled={!live || !researchReady} checked={live && research && researchReady} onChange={e => setResearch(e.target.checked)}/><span className="rule-note">{!live ? translate("示範模式不呼叫 AI，也不查詢網路。") : researchReady ? translate("可查公開網頁及授權的本機文字資料。") : translate("所選供應商的研究隔離尚未驗證。")}</span></label>}
          {!selection && <details className="rule-card limits"><summary>{translate("執行上限 ·")}{" "}{rounds}{" "}{translate("輪 ·")}{" "}{duration}{" "}{translate("分鐘")}{host ? translate(" · 主持人 {0} 次", hostCalls) : ''}</summary><div className="grid-two">{([[translate("最多輪次"), rounds, setRounds, 1000], [translate("總時間（分鐘）"), duration, setDuration, 1440], [translate("單次回覆（分鐘）"), timeout, setTimeout_, 60], [translate("主持人最多呼叫次數"), hostCalls, setHostCalls, 10000]] as const).map(([name, value, change, max]) => <label key={name}>{name}<input aria-label={name} type="number" required min={1} max={max} value={value} onChange={e => change(e.target.valueAsNumber)}/></label>)}</div></details>}
          {selection && <><label className="rule-card">{translate("選項數量")}<input type="number" min={2} max={6} required value={optionCount} onChange={e => setOptionCount(e.target.valueAsNumber)}/></label><label className="rule-card">{translate("總時間（分鐘）")}<input type="number" min={1} max={1440} required value={duration} onChange={e => setDuration(e.target.valueAsNumber)}/></label><label className="rule-card">{translate("單次回覆（分鐘）")}<input type="number" min={1} max={60} required value={timeout} onChange={e => setTimeout_(e.target.valueAsNumber)}/></label></>}
        </div>
        {!selection && live && research && researchReady && <label className="settings-detail">{translate("可讀取的本機目錄")}<textarea aria-label={translate("可讀取的本機目錄")} value={roots} onChange={e => setRoots(e.target.value)} placeholder={translate("每行一個完整路徑")}/></label>}
      </section>
      {live && seats.some(s => s.provider === 'codex') && models.error && <div className="notice warning" role="status">{models.error}<button type="button" onClick={onConnection}>{translate("查看連線")}</button></div>}
      <div className="start-bar"><div className={'start-bar-inner' + (problem ? '' : ' ready')}><span className="seat-strip" aria-hidden="true">{seats.map((s, i) => <SeatAvatar key={s.uid} seat={{ ...providerSeat(s.provider), symbol: names[i]!.symbol, alt: names[i]!.alt }} size="sm"/>)}{!selection && host && <SeatAvatar seat={moderatorSeat} size="sm"/>}</span>
        <span className="summary">{summary}</span>{problem && <span className="why">{problem.text}</span>}{problem?.connection && <button type="button" onClick={onConnection}>{translate("查看連線")}</button>}
        <button className="primary" disabled={busy || !!problem}>{selection ? translate("建立並開始評選 →") : kind === 'debate' ? translate("建立並開始辯論 →") : translate("建立並開始討論 →")}</button></div></div>
    </form></section>;
}
