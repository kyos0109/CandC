import { translate } from './i18n.js';
import type { ReactNode } from 'react';
import type { EnvironmentStatus, Models } from './api';
import { providerAvailability, providerStatus, readyProviders } from './providers';
import { SeatAvatar } from './SeatAvatar';
import { PROVIDERS, providerNames, providerSeat } from './seats';

const defaultLogin = { codex: 'codex login', claude: 'claude auth login', gemini: 'gemini', grok: 'grok login' } as const;

/** Full page for CLI readiness: one row per provider, with the login command and a recheck. Replaces the narrow connection drawer. */
export function ConnectionsPage({ environment, models, checking, onCheck, onBack, historyToggle, controls }: {
  environment: EnvironmentStatus | null; models: Models; checking: boolean; onCheck: () => void; onBack: () => void; historyToggle: ReactNode; controls: ReactNode;
}) {
  return <section className="connections-page">
    <header className="creation-header">{historyToggle}<button onClick={onBack}>{translate("返回討論")}</button><span>{translate("本機工作空間")}</span>{controls}</header>
    <div className="room-page"><div className="room-page-inner">
      <h1>{translate("連線與設定")}</h1><p className="lead">{translate("僅本機 · 127.0.0.1 · 對話保存在這台電腦。")}{environment ? translate(" {0} / {1} 家供應商就緒。", readyProviders(environment), PROVIDERS.length) : ''}</p>
      <div className="surface-card" role="list" aria-label={translate("供應商連線狀態")}>{PROVIDERS.map(provider => {
        const info = providerAvailability(environment, provider), status = providerStatus(environment, provider), login = environment?.providers?.[provider]?.loginCommand ?? defaultLogin[provider];
        return <div className="provider-row" role="listitem" key={provider}><SeatAvatar seat={providerSeat(provider)} size="lg"/>
          <h3>{providerNames[provider]}<span className={'chip ' + (info.ready ? 'ok' : 'warn')}>{info.label}</span></h3>
          <button disabled={checking} onClick={onCheck}>{checking ? translate("檢查中…") : translate("重新檢查")}</button>
          <small>{[info.ready ? translate("討論開始時才啟動 CLI，不必先開著。") : info.reason, status && 'version' in status && status.version ? translate("版本 {0}", status.version) : ''].filter(Boolean).join(' ')}</small>
          {!info.ready && <code>{login}</code>}</div>;
      })}</div>
      {models.error && <div className="notice warning" role="status">{models.error && translate(models.error)}</div>}
      <section className="surface-card padded"><h3>{translate("登入方式")}</h3><p className="dock-note">{translate("在 PowerShell 執行上方的登入指令，完成後按「重新檢查」。計費與額度依供應商帳號及政策；關閉頁面後，會在目前發言完成後暫停。Gemini 與 Grok 的真實 AI 模式尚未開放，可先用示範模式。")}</p></section>
    </div></div>
  </section>;
}
