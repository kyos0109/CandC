import { observe, type PerformanceObserver } from './performance.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { codexArguments } from './adapters/codex.js';
import { JsonLineProcess, RpcConnection } from './adapters/process.js';
import { AppError } from './domain.js';
import type { Discussion } from './domain.js';
import type { ProviderId, RoomDiscussion } from './room-contract.js';

const execute = promisify(execFile);
export const executablePaths = () => ({ codex: process.env.CANDC_CODEX_PATH ?? 'codex', claude: process.env.CANDC_CLAUDE_PATH ?? 'claude',
  gemini: process.env.CANDC_GEMINI_PATH ?? 'gemini', grok: process.env.CANDC_GROK_PATH ?? 'grok' });
export const codexEnvironment = (): NodeJS.ProcessEnv => ({ ...process.env, CODEX_HOME: process.env.CANDC_CODEX_HOME ?? process.env.CODEX_HOME ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.codex') });
async function output(executable: string, args: string[], observer?: PerformanceObserver) {
  try { const running = execute(executable, args, { windowsHide: true, timeout: 10_000, maxBuffer: 256 * 1024, env: executable === executablePaths().codex ? codexEnvironment() : process.env }); running.child.once('spawn', () => observe(observer, 'loginProcessStarted')); const result = await running; return result.stdout || result.stderr; }
  catch (error) {
    if (!(error instanceof Error)) return '';
    const stdout = 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : '';
    const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';
    return stdout || stderr;
  }
}
export async function diagnose(observer?: PerformanceObserver) {
  const paths = executablePaths();
  const [cv, av, ca, aa] = await Promise.all([
    output(paths.codex, ['--version'], observer), output(paths.claude, ['--version'], observer),
    output(paths.codex, ['login', 'status'], observer), output(paths.claude, ['auth', 'status'], observer),
  ]);
  let claudeAuth: { loggedIn: boolean; method: string } | null = null;
  try {
    const auth = z.object({ loggedIn: z.boolean(), authMethod: z.enum(['none', 'claude.ai', 'oauth_token', 'api_key', 'api_key_helper', 'third_party']) }).parse(JSON.parse(aa));
    claudeAuth = { loggedIn: auth.loggedIn, method: auth.authMethod };
  } catch { /* Unclassified output is never returned or logged. */ }
  const codexAuth = ca.includes('ChatGPT') ? 'chatgpt' : ca.includes('API key') ? 'api_key' : ca.includes('Not logged in') ? 'not_logged_in' : 'unknown';
  const codexVersion = cv.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null;
  const claudeVersion = av.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null;
  return {
    node: process.version,
    codex: { version: codexVersion, authentication: codexAuth, ready: Boolean(codexVersion && codexAuth === 'chatgpt') },
    claude: { version: claudeVersion, authentication: claudeAuth, ready: Boolean(claudeVersion && claudeAuth?.loggedIn && claudeAuth.method === 'claude.ai') },
    ready: Boolean(codexVersion && claudeVersion && codexAuth === 'chatgpt' && claudeAuth?.loggedIn && claudeAuth.method === 'claude.ai'),
    loginCommands: { codex: 'codex login', claude: 'claude auth login' },
  };
}
export type EnvironmentStatus = Awaited<ReturnType<typeof diagnose>> & { providers?: Record<ProviderId, ProviderStatus> };
export type ProviderState = 'missing' | 'start-failed' | 'unverified' | 'login-required' | 'auth-check-failed' | 'ready';
export type ProviderStatus = { version: string | null; ready: boolean; validated: boolean; reason: string | null; loginCommand: string; research: boolean; state: ProviderState };
export type CliProbeResult = { ok: boolean; output: string; missing: boolean };
export type CliProbe = (executable: string, args: string[], observer?: PerformanceObserver) => Promise<CliProbeResult>;
const probeCli: CliProbe = async (executable, args, observer) => {
  try {
    const running = execute(executable, args, { windowsHide: true, timeout: 10_000, maxBuffer: 256 * 1024,
      env: executable === executablePaths().codex ? codexEnvironment() : process.env });
    running.child.once('spawn', () => observe(observer, 'loginProcessStarted'));
    const result = await running;
    return { ok: true, output: result.stdout || result.stderr, missing: false };
  } catch (error) {
    const result = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    return { ok: false, missing: result?.code === 'ENOENT', output: typeof result?.stdout === 'string' && result.stdout ? result.stdout : typeof result?.stderr === 'string' ? result.stderr : '' };
  }
};
export async function providerStatus(provider: ProviderId, probe: CliProbe = probeCli, observer?: PerformanceObserver): Promise<ProviderStatus> {
  const executable = executablePaths()[provider];
  const loginCommand = provider === 'codex' ? 'codex login' : provider === 'claude' ? 'claude auth login' : provider;
  const versionProbe = await probe(executable, ['--version'], observer);
  const base = { version: null, ready: false, validated: false, research: false, loginCommand };
  if (versionProbe.missing) return { ...base, state: 'missing', reason: '找不到 CLI；請先安裝，或確認執行路徑，再重新檢查。' };
  if (!versionProbe.ok) return { ...base, state: 'start-failed', reason: 'CLI 無法啟動或檢查逾時；請確認執行路徑與權限，再重新檢查。' };
  const version = versionProbe.output.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null;
  if (!version) return { ...base, state: 'unverified', reason: 'CLI 已回應，但版本無法辨識；尚未通過驗證，不能使用真實 AI。' };
  if (provider === 'gemini' || provider === 'grok') return { ...base, version, state: 'unverified',
    reason: 'CLI 已找到；尚未完成此版本登入、工具隔離及 session 真實驗證。' };
  const validated = version === (provider === 'codex' ? '0.160.0' : '2.1.287');
  if (!validated) return { ...base, version, state: 'unverified', reason: '此 CLI 版本尚未通過驗證，不能使用真實 AI。' };
  const authProbe = await probe(executable, provider === 'codex' ? ['login', 'status'] : ['auth', 'status'], observer);
  let loggedIn = false;
  let knownLogin = false;
  if (provider === 'codex') { loggedIn = authProbe.ok && authProbe.output.includes('ChatGPT'); knownLogin = loggedIn || /Not logged in|API key/.test(authProbe.output); }
  else {
    try { const auth = z.object({ loggedIn: z.boolean(), authMethod: z.string() }).parse(JSON.parse(authProbe.output)); loggedIn = authProbe.ok && auth.loggedIn && auth.authMethod === 'claude.ai'; knownLogin = authProbe.ok || !auth.loggedIn; } catch { /* No raw authentication output. */ }
  }
  return { version, ready: loggedIn, validated, research: validated, loginCommand,
    state: loggedIn ? 'ready' : knownLogin ? 'login-required' : 'auth-check-failed',
    reason: loggedIn ? null : knownLogin ? '尚未完成官方 CLI 訂閱登入；請登入後重新檢查。' : '無法確認 CLI 登入狀態；請確認 CLI 能啟動，再重新檢查。' };
}
export async function roomProviderStatuses() {
  const ids: ProviderId[] = ['codex', 'claude', 'gemini', 'grok'];
  return Object.fromEntries(await Promise.all(ids.map(async id => [id, await providerStatus(id)]))) as Record<ProviderId, ProviderStatus>;
}
export async function requireRoomReady(state: RoomDiscussion, observer?: PerformanceObserver) {
  const participants = [...state.participants, ...(state.moderator ? [state.moderator] : [])];
  const ids = [...new Set(participants.map(p => p.provider))];
  observe(observer, 'loginStart');
  const statuses = await Promise.all(ids.map(async id => ({ id, status: await providerStatus(id, undefined, observer) })));
  observe(observer, 'loginEnd');
  for (const { id, status } of statuses) {
    if (!status.ready) throw new AppError(status.validated ? 'LOGIN_REQUIRED' : 'CLI_VERSION_UNVERIFIED', `${id}: ${status.reason}`);
    if (state.research && !status.research) throw new AppError('RESEARCH_UNVERIFIED', `${id}: 研究權限尚未驗證。`);
  }
  if (ids.includes('codex')) {
    observe(observer, 'catalogStart');
    const catalog = await codexCatalog(observer);
    observe(observer, 'catalogEnd');
    for (const p of participants.filter(p => p.provider === 'codex')) {
      if (!catalog.some(m => m.id === p.settings.model && p.settings.effort && m.efforts.includes(p.settings.effort))) throw new AppError('MODEL_UNAVAILABLE', 'Codex 模型／推理等級不在目前清單。');
    }
  }
  if (participants.some(p => p.provider === 'claude' && (!p.settings.effort || p.settings.effort === 'xhigh'))) throw new AppError('EFFORT_UNAVAILABLE', 'Claude 推理等級不支援。');
  return Object.fromEntries(statuses.map(({ id, status }) => [id, status.version])) as Partial<Record<ProviderId, string | null>>;
}

export async function codexCatalog(observer?: PerformanceObserver) {
  const cwd = path.resolve('.cache/agents/catalog');
  await mkdir(cwd, { recursive: true });
  const process = new JsonLineProcess({ executable: executablePaths().codex, args: codexArguments(), cwd, signal: AbortSignal.timeout(15_000), env: codexEnvironment(), observePerformance: observer, startedPhase: 'catalogProcessStarted' });
  const rpc = new RpcConnection(process);
  try {
    await rpc.request('initialize', { clientInfo: { name: 'candc', title: 'CandC', version: '0.2.0' }, capabilities: null });
    rpc.notify('initialized');
    const response = z.object({ data: z.array(z.object({
      id: z.string(), model: z.string(), displayName: z.string(),
      supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })),
    })), nextCursor: z.string().nullable().optional() }).parse(await rpc.request('model/list', { limit: 100, includeHidden: false }));
    return response.data.map((model) => ({ id: model.model, label: model.displayName, efforts: model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort) }));
  } finally { await process.close(); }
}
export async function requireLiveReady(state?: Discussion, observer?: PerformanceObserver) {
  observe(observer, 'loginStart');
  const status = await diagnose(observer);
  observe(observer, 'loginEnd');
  if (!status.ready) throw new AppError('LOGIN_REQUIRED', '請先在本機終端完成 codex login 與 claude auth login，再按重新檢查。', 409);
  if (status.codex.version !== '0.160.0' || status.claude.version !== '2.1.287') throw new AppError('CLI_VERSION_UNVERIFIED', 'CLI 版本與已驗證的協定不符，請先更新 CandC 接線與測試。');
  if (state) {
    observe(observer, 'catalogStart');
    const catalog = await codexCatalog(observer);
    observe(observer, 'catalogEnd');
    const model = catalog.find((model) => model.id === state.agents.codex.model);
    if (!model || !model.efforts.includes(state.agents.codex.effort)) throw new AppError('MODEL_UNAVAILABLE', 'Codex 模型或思考程度不在目前 CLI 提供的清單中。');
    if (state.agents.claude.effort === 'xhigh') throw new AppError('EFFORT_UNAVAILABLE', '請選擇介面提供的 Claude 思考程度。');
  }
  return { codex: status.codex.version, claude: status.claude.version };
}
