import { translate } from './i18n.js';
import type { ProviderId } from '../src/room-contract.js';
import type { EnvironmentStatus, Models } from './api.js';
import { PROVIDERS } from './seats.js';

export type Availability = { label: string; reason: string; ready: boolean };
export const providerStatus = (environment: EnvironmentStatus | null, provider: ProviderId) =>
  environment?.providers?.[provider] ?? (provider === 'codex' || provider === 'claude' ? environment?.[provider] : undefined);

const labels = { get missing() { return translate("CLI 未安裝／找不到"); }, get 'start-failed'() { return translate("CLI 啟動失敗"); }, get unverified() { return translate("CLI 尚未驗證"); }, get 'login-required'() { return translate("CLI 尚未登入"); }, get 'auth-check-failed'() { return translate("CLI 登入檢查失敗"); }, get ready() { return translate("CLI 已就緒"); } };
/** One readiness reading per provider, shared by the creation form and the connections page. */
export function providerAvailability(environment: EnvironmentStatus | null, provider: ProviderId): Availability {
  const current = providerStatus(environment, provider);
  if (!environment) return { label: translate("正在檢查 CLI"), reason: translate("取得狀態後才能使用真實 AI。"), ready: false };
  if (!current) return { label: translate("CLI 尚未驗證"), reason: translate("尚無可確認的 CLI 狀態；請重新檢查。"), ready: false };
  if (current.ready) return { label: translate("CLI 已就緒"), reason: translate("討論開始時會啟動 CLI，無須先手動開啟。"), ready: true };
  const state = 'state' in current ? current.state : undefined;
  const reason = 'reason' in current && current.reason ? current.reason : translate("請確認官方 CLI 已安裝並完成訂閱登入，再重新檢查。");
  return { label: state ? labels[state] : translate("CLI 尚未就緒"), reason: translate(reason), ready: false };
}
export const readyProviders = (environment: EnvironmentStatus | null) => PROVIDERS.filter(provider => providerAvailability(environment, provider).ready).length;

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];
const isEffort = (value: string): value is Effort => (EFFORTS as readonly string[]).includes(value);
export type ModelOption = { id: string; label: string; efforts: Effort[] };

/** Efforts a model accepts. Codex lists them per model; Claude's set excludes xhigh; Gemini and Grok have no verified effort control. */
export function supportedEfforts(provider: ProviderId, model: string, models: Models): Effort[] {
  if (provider === 'codex') return models.codex.find(m => m.id === model)?.efforts.filter(isEffort) ?? [];
  return provider === 'claude' ? ['low', 'medium', 'high', 'max'] : [];
}
/** One picker for every provider: Codex is a closed catalogue, the others suggest aliases and accept a full custom id. */
export function modelOptions(provider: ProviderId, models: Models): { options: ModelOption[]; custom: boolean } {
  if (provider === 'codex') return { options: models.codex.map(m => ({ id: m.id, label: m.label, efforts: m.efforts.filter(isEffort) })), custom: false };
  const ids = provider === 'claude' ? models.claude : models[provider] ?? [];
  return { options: ids.map(id => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1), efforts: supportedEfforts(provider, id, models) })), custom: true };
}
/** Keep the chosen effort when the new model still supports it; otherwise fall back to medium, then the first supported one. */
export function settingsAfterModel(provider: ProviderId, models: Models, current: Effort | null, model: string): { model: string; effort: Effort | null } {
  const efforts = supportedEfforts(provider, model, models);
  if (!efforts.length) return { model, effort: null };
  return { model, effort: current && efforts.includes(current) ? current : efforts.includes('medium') ? 'medium' : efforts[0]! };
}
/** Same rule the creation form enforced before the picker: a model is required, Codex must come from the catalogue, Claude needs an effort. */
export function validModelSettings(provider: ProviderId, models: Models, s: { model: string; effort: Effort | null }) {
  return !!s.model.trim() && (provider !== 'codex' || models.codex.some(m => m.id === s.model && m.efforts.includes(s.effort ?? ''))) && (provider !== 'claude' || s.effort !== null && s.effort !== 'xhigh');
}
