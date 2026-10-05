import type { ProviderId } from '../src/room-contract.js';
import type { EnvironmentStatus, Models } from './api.js';
import { PROVIDERS } from './seats.js';

export type Availability = { label: string; reason: string; ready: boolean };
export const providerStatus = (environment: EnvironmentStatus | null, provider: ProviderId) =>
  environment?.providers?.[provider] ?? (provider === 'codex' || provider === 'claude' ? environment?.[provider] : undefined);

const labels = { missing: 'CLI 未安裝／找不到', 'start-failed': 'CLI 啟動失敗', unverified: 'CLI 尚未驗證', 'login-required': 'CLI 尚未登入', 'auth-check-failed': 'CLI 登入檢查失敗', ready: 'CLI 已就緒' };
/** One readiness reading per provider, shared by the creation form and the connections page. */
export function providerAvailability(environment: EnvironmentStatus | null, provider: ProviderId): Availability {
  const current = providerStatus(environment, provider);
  if (!environment) return { label: '正在檢查 CLI', reason: '取得狀態後才能使用真實 AI。', ready: false };
  if (!current) return { label: 'CLI 尚未驗證', reason: '尚無可確認的 CLI 狀態；請重新檢查。', ready: false };
  if (current.ready) return { label: 'CLI 已就緒', reason: '討論開始時會啟動 CLI，無須先手動開啟。', ready: true };
  const state = 'state' in current ? current.state : undefined;
  const reason = 'reason' in current && current.reason ? current.reason : '請確認官方 CLI 已安裝並完成訂閱登入，再重新檢查。';
  return { label: state ? labels[state] : 'CLI 尚未就緒', reason, ready: false };
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
