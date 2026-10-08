import { translate } from './i18n.js';
import type { Discussion } from '../src/domain.js';
import type { EnvironmentStatus } from '../src/environment.js';
import type { RoomDiscussion } from '../src/room-contract.js';
import type { DiscussionService } from '../src/discussion-service.js';
export type DiscussionIndex = Awaited<ReturnType<DiscussionService['index']>>;
export type { Discussion, EnvironmentStatus };
export type AnyDiscussion = Discussion | RoomDiscussion;
export type Models = { codex: { id: string; label: string; efforts: string[] }[]; claude: string[]; gemini?: string[]; grok?: string[]; error: string | null };
const errors: Record<string, string> = {
  get ATTACHMENT_FORMAT() { return translate("不支援此檔案格式。"); },
  get ATTACHMENT_NAME() { return translate("附件檔名無效。"); },
  get ATTACHMENT_SIZE() { return translate("最多 5 個檔案，單檔 10 MiB、合計 25 MiB；不可上傳空檔。"); },
  get ATTACHMENT_TEXT_LIMIT() { return translate("附件文字超過上限（單檔 100,000 字元、合計 200,000 字元），請拆分檔案；未截斷內容。"); },
  get ATTACHMENT_ENCODING() { return translate("無法辨識文字編碼，請轉成 UTF-8 或帶 BOM 的 UTF-16。"); },
  get ATTACHMENT_EMPTY() { return translate("附件沒有可擷取文字；不支援 OCR。"); },
  get ATTACHMENT_INVALID() { return translate("附件損壞、加密或無法解析。"); },
  get ATTACHMENT_ARCHIVE_LIMIT() { return translate("附件壓縮內容不符合安全限制。"); },
  get ATTACHMENT_TIMEOUT() { return translate("附件解析逾時，請縮小檔案後重試。"); },
  get ATTACHMENT_UNAVAILABLE() { return translate("附件遺失或損壞，無法讀取；不會略過附件繼續呼叫 AI。"); },
  get ATTACHMENT_UNSUPPORTED() { return translate("附件僅支援 v3 一般討論與辯論。"); },
  get DISCUSSION_READ_ONLY() { return translate("此對話唯讀，請先還原到一般分類。"); },
  get DISCUSSION_DELETED() { return translate("此對話已永久刪除。"); },
  get BUSY() { return translate("已有討論正在執行，請先暫停它。"); }, get LOGIN_REQUIRED() { return translate("請先完成兩個 CLI 登入，再重新檢查。"); },
  get ROUND_LIMIT() { return translate("已達輪次上限，請調整上限後續談。"); }, get TIME_LIMIT() { return translate("已達時間上限，請調整上限後續談。"); },
  get INVALID_INPUT() { return translate("輸入格式不符合要求，請檢查題目、模型與上限。"); }, get INVALID_ROOT() { return translate("目錄必須是可讀取的特定本機資料夾。"); },
  get RECONCILIATION_REQUIRED() { return translate("上次回覆狀態不確定，請重建工作階段後續談。"); }, get UNAUTHORIZED() { return translate("連線已失效，請重新整理頁面。"); },
  get STORAGE_UNCONFIRMED() { return translate("尚未確認保存，已封鎖寫入及 AI 排程。請先驗證保存，再明確重建工作階段。"); },
  get VERSION_CONFLICT() { return translate("設定或議題版本已更新，請重新整理後再操作。"); }, get INVALID_REFERENCE() { return translate("引用來源不在所選收件對象可取得的範圍內。"); },
};
export async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const multipart = body instanceof FormData;
  const response = await fetch(url, { method, credentials: 'same-origin', headers: body === undefined || multipart ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error((result.fileName ? `${result.fileName}: ` : '') + (errors[result.error] ?? (typeof result.message === 'string' ? translate(result.message) : translate("操作失敗 ({0})", response.status))));
  return result as T;
}
export function attachmentBody(payload: unknown, files: File[]): unknown {
  if (!files.length) return payload;
  const data = new FormData(); data.append('payload', JSON.stringify(payload));
  for (const file of files) data.append('files', file, file.name);
  return data;
}
export const operation = (id: string, action: string) => api<Discussion>(`/api/discussions/${id}/${action}`, 'POST', { operationId: crypto.randomUUID() });
export const statusText: Record<Discussion['status'], string> = { get ready() { return translate("尚未開始"); }, get running() { return translate("討論中"); }, get paused() { return translate("已暫停"); }, get stopped() { return translate("已停止"); }, get indeterminate() { return translate("回覆狀態待確認"); } };
export function reasonText(reason: string | null): string {
  const reasons: Record<string, string> = { 'Overall result explicitly confirmed by both agents.': translate("整場結果已由雙方明確確認；略過項目仍列為限制。"), 'Missing information prevents the next valid step.': translate("必要資料不足，已阻止有效下一步；請補充資料再續談。"), 'Required issue control is missing or invalid; the answer and delivery were saved.': translate("必要的議題控制缺漏或無效。公開回答與接收進度已保存；請檢查後明確續談，不會自動重送。"), 'Required issue control does not match the input snapshot.': translate("議題控制與本次輸入版本不符。回答與接收進度已保存，已暫停。"), 'Issue action is invalid; delivery was saved without applying the action.': translate("議題動作無效，回答與接收進度已保存；議題未變更。"), 'Journal storage is unconfirmed; explicit recovery is required.': translate("未確認保存。請先驗證 journal，復原成功後再重建 session；串流文字不保證已保存。"), 'Storage verified. Explicit session reconstruction is required before continuing.': translate("已核對並同步公開紀錄。請明確重建工作階段後續談。"), 'Complete conversation exceeds the application input limit; no history was omitted.': translate("完整對話超出程式的傳送上限，已暫停；沒有省略歷史或繼續呼叫 AI。請匯出保存，再建立範圍較小的新討論。"), 'Conclusion confirmed by both agents.': translate("雙方已確認結論，討論已暫停。可查看最後的結論與確認內容。"), 'No confirmed conclusion; additional input is required.': translate("尚未形成雙方確認的結論；缺少必要資料，請補充後續談。"), 'Both agents are waiting for new input.': translate("雙方目前沒有新的補充。你可以加入問題或按「繼續交流」。"), 'Round completed.': translate("本輪完成，可以補充意見或進入下一輪。"), 'Stopped by user.': translate("已停止。若要續談，請重建工作階段。"), 'Paused by user.': translate("已在目前回覆完成後暫停。"), 'Round limit reached.': translate("已達輪次上限，調整後可以續談。"), 'Duration limit reached.': translate("已達時間上限，調整後可以續談。"), 'User requested pause after the current answer.': translate("將在目前發言完成後暫停。"), 'Previous execution ended without a confirmed result.': translate("上次程式結束時沒有確認回覆結果；請重建後續談。") };
  return reason ? reasons[reason] ?? translate(reason) : '';
}

export const clock = (ms: number) => `${Math.floor(ms / 3_600_000)}:${String(Math.floor(ms / 60_000) % 60).padStart(2, '0')}`;
export const durationText = (ms: number) => { const minutes = Math.floor(ms / 60_000); return minutes >= 60 ? translate("{0} 小時{1}", Math.floor(minutes / 60), minutes % 60 ? translate(" {0} 分", minutes % 60) : '') : translate("{0} 分鐘", minutes); };
export const discussionName =(state: Pick<Discussion, 'topic' | 'displayName'>) => state.displayName?.trim() || state.topic.split(/\r?\n/).find(line => line.trim())?.trim() || translate("未命名討論");
