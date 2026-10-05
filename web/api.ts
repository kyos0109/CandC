import type { Discussion } from '../src/domain.js';
import type { EnvironmentStatus } from '../src/environment.js';
import type { RoomDiscussion } from '../src/room-contract.js';
export type { Discussion, EnvironmentStatus };
export type AnyDiscussion = Discussion | RoomDiscussion;
export type Models = { codex: { id: string; label: string; efforts: string[] }[]; claude: string[]; gemini?: string[]; grok?: string[]; error: string | null };
const errors: Record<string, string> = {
  BUSY: '已有討論正在執行，請先暫停它。', LOGIN_REQUIRED: '請先完成兩個 CLI 登入，再重新檢查。',
  ROUND_LIMIT: '已達輪次上限，請調整上限後續談。', TIME_LIMIT: '已達時間上限，請調整上限後續談。',
  INVALID_INPUT: '輸入格式不符合要求，請檢查題目、模型與上限。', INVALID_ROOT: '目錄必須是可讀取的特定本機資料夾。',
  RECONCILIATION_REQUIRED: '上次回覆狀態不確定，請重建工作階段後續談。', UNAUTHORIZED: '連線已失效，請重新整理頁面。',
  STORAGE_UNCONFIRMED: '尚未確認保存，已封鎖寫入及 AI 排程。請先驗證保存，再明確重建工作階段。',
  VERSION_CONFLICT: '設定或議題版本已更新，請重新整理後再操作。', INVALID_REFERENCE: '引用來源不在所選收件對象可取得的範圍內。',
};
export async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(errors[result.error] ?? result.message ?? `操作失敗 (${response.status})`);
  return result as T;
}
export const operation = (id: string, action: string) => api<Discussion>(`/api/discussions/${id}/${action}`, 'POST', { operationId: crypto.randomUUID() });
export const statusText: Record<Discussion['status'], string> = { ready: '尚未開始', running: '討論中', paused: '已暫停', stopped: '已停止', indeterminate: '回覆狀態待確認' };
export function reasonText(reason: string | null): string {
  const reasons: Record<string, string> = { 'Overall result explicitly confirmed by both agents.': '整場結果已由雙方明確確認；略過項目仍列為限制。', 'Missing information prevents the next valid step.': '必要資料不足，已阻止有效下一步；請補充資料再續談。', 'Required issue control is missing or invalid; the answer and delivery were saved.': '必要的議題控制缺漏或無效。公開回答與接收進度已保存；請檢查後明確續談，不會自動重送。', 'Required issue control does not match the input snapshot.': '議題控制與本次輸入版本不符。回答與接收進度已保存，已暫停。', 'Issue action is invalid; delivery was saved without applying the action.': '議題動作無效，回答與接收進度已保存；議題未變更。', 'Journal storage is unconfirmed; explicit recovery is required.': '未確認保存。請先驗證 journal，復原成功後再重建 session；串流文字不保證已保存。', 'Storage verified. Explicit session reconstruction is required before continuing.': '已核對並同步公開紀錄。請明確重建工作階段後續談。', 'Complete conversation exceeds the application input limit; no history was omitted.': '完整對話超出程式的傳送上限，已暫停；沒有省略歷史或繼續呼叫 AI。請匯出保存，再建立範圍較小的新討論。', 'Conclusion confirmed by both agents.': '雙方已確認結論，討論已暫停。可查看最後的結論與確認內容。', 'No confirmed conclusion; additional input is required.': '尚未形成雙方確認的結論；缺少必要資料，請補充後續談。', 'Both agents are waiting for new input.': '雙方目前沒有新的補充。你可以加入問題或按「繼續交流」。', 'Round completed.': '本輪完成，可以補充意見或進入下一輪。', 'Stopped by user.': '已停止。若要續談，請重建工作階段。', 'Paused by user.': '已在目前回覆完成後暫停。', 'Round limit reached.': '已達輪次上限，調整後可以續談。', 'Duration limit reached.': '已達時間上限，調整後可以續談。', 'User requested pause after the current answer.': '將在目前發言完成後暫停。', 'Previous execution ended without a confirmed result.': '上次程式結束時沒有確認回覆結果；請重建後續談。' };
  return reason ? reasons[reason] ?? reason : '';
}

export const clock = (ms: number) => `${Math.floor(ms / 3_600_000)}:${String(Math.floor(ms / 60_000) % 60).padStart(2, '0')}`;
export const durationText = (ms: number) => { const minutes = Math.floor(ms / 60_000); return minutes >= 60 ? `${Math.floor(minutes / 60)} 小時${minutes % 60 ? ` ${minutes % 60} 分` : ''}` : `${minutes} 分鐘`; };
export const discussionName =(state: Pick<Discussion, 'topic' | 'displayName'>) => state.displayName?.trim() || state.topic.split(/\r?\n/).find(line => line.trim())?.trim() || '未命名討論';
