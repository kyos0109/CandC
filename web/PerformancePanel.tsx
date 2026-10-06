import { translate } from './i18n.js';
import { useEffect, useState } from 'react';
import type { PerformanceView } from '../src/performance';
import { api } from './api';

const names: Record<string, string> = {
  get lock() { return translate("取得執行鎖"); }, get login() { return translate("登入與版本檢查"); }, get catalog() { return translate("模型清單檢查"); }, get selection() { return translate("輸入選取"); }, get prepared() { return translate("準備快照保存"); },
  get research() { return translate("研究設定準備"); }, get inspectSpawn() { return translate("前置程序啟動"); }, get inspectRead() { return translate("繼承設定讀取"); }, get inspectCleanup() { return translate("前置程序清理"); },
  get inferenceSpawn() { return translate("推論程序啟動"); }, get rpc() { return translate("RPC 初始化"); }, get policy() { return translate("政策驗證"); }, get session() { return translate("工作階段建立／恢復"); },
  get preparation() { return translate("回合前置準備"); }, get codexPreparation() { return translate("Codex 前置與工作階段準備"); }, get waitFirstReply() { return translate("等待首段回覆"); }, get generation() { return translate("首段至協定完成"); }, get cleanup() { return translate("推論程序清理"); },
  get answerCommit() { return translate("公開回答正式保存"); }, get diagnosticCommit() { return translate("既有診斷保存"); }, get total() { return translate("處理總耗時"); },
};
const outcomes: Record<string, string> = { get success() { return translate("完成"); }, get cancelled() { return translate("已取消"); }, get timeout() { return translate("逾時"); }, get 'startup-error'() { return translate("啟動失敗"); },
  get 'protocol-error'() { return translate("協定失敗"); }, get 'cleanup-error'() { return translate("清理失敗"); }, get 'storage-unknown'() { return translate("未確認保存"); }, get failed() { return translate("失敗"); } };
const purposes = { get discussion() { return translate("一般發言"); }, get moderation() { return translate("主持裁決"); }, get monitor() { return translate("主持監看"); }, get summary() { return translate("整理"); }, get roles() { return translate("立場提議"); } };
export function PerformancePanel({ discussionId }: { discussionId: string }) {
  const [view, setView] = useState<PerformanceView | null>(null), [error, setError] = useState(false);
  useEffect(() => {
    let active = true, pending = false;
    setView(null); setError(false);
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try { const result = await api<PerformanceView>(`/api/discussions/${discussionId}/performance`); if (active) { setView(result); setError(false); } }
      catch { if (active) setError(true); }
      finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, [discussionId]);
  return <section aria-label={translate("AI 呼叫效能量測")}><h3>{translate("AI 呼叫效能量測")}</h3>
    <p>{translate("等待首段回覆可能包含 CLI、網路、排隊、推理與工具時間；無法區分服務端內部耗時。只使用日常討論樣本，不推估帳單。")}</p>
    <div className="performance-downloads"><a href="/api/performance/report?format=json" download>{translate("下載 JSON 基準報表")}</a><a href="/api/performance/report?format=markdown" download>{translate("下載 Markdown 基準報表")}</a></div>
    {error && <p role="status">{translate("效能診斷讀取失敗。")}</p>}
    {!view && !error && <p>{translate("載入量測中…")}</p>}
    {view && <><p>{translate("保留樣本：開始操作")}{" "}{view.records.filter(r => r.kind === 'execution').length}{" "}{translate("次、回合")}{" "}{view.records.filter(r => r.kind === 'turn').length}{" "}{translate("次。基準預設只統計 live；同組至少 20 個完整成功回合、3 個討論，且 CLI／模型已知，才提供方向性判讀。")}</p>
      {!view.available && <p role="status">{view.enabled ? translate("診斷不可用") : translate("新增量測已停用")}{translate("；正式保存狀態請依討論紀錄判定。")}</p>}
      <p>{translate("本程序遺漏")}{" "}{view.dropped}{" "}{translate("筆，損壞記錄跳過")}{" "}{view.corrupt}{" "}{translate("筆。只涵蓋輪替檔保留期間；舊歷史不補算，重啟前遺漏數未知。")}</p>
      {view.records.length === 0 && <p>{translate("資料不足：目前沒有新格式量測樣本。")}</p>}
      {view.records.map(r => <details key={r.requestId ?? r.executionId}><summary>{r.kind === 'execution' ? translate("開始／續談") : translate("{0} · 第 {1} 輪 · {2}", r.provider, r.round, r.session === 'new' ? translate("新工作階段") : translate("恢復工作階段"))} · {r.incomplete ? translate("不完整（未觀測結束）") : outcomes[r.outcome ?? ''] ?? translate("未知")} · {r.backend}</summary>
        <p>{purposes[r.purpose]}{" "}{translate("· 座位")}{" "}{r.participant ?? translate("未知／舊格式未記錄")} · {r.model ?? translate("模型未知")} · {r.effort ?? translate("effort 未知")} · CLI {r.cliVersion ?? translate("未知")} · {r.characters === null ? translate("輸入大小未知") : translate("{0} 字元", r.characters.toLocaleString())}{" "}{translate("· 工具事件")}{" "}{r.incomplete ? translate("未知") : r.tools}</p>
        <p>{translate("程序啟動：前置")}{" "}{r.processes.inspection ?? translate("未知")}{translate("、推論")}{" "}{r.processes.inference ?? translate("未知")}。{r.textMode === 'final-only' ? translate("僅最終答案觀測到文字（final-only），不納入串流首段統計。") : r.textMode === 'stream' ? translate("首段公開串流文字已觀測。") : translate("首段文字未知。")}</p>
        <table><thead><tr><th>{translate("階段 duration")}</th><th>{translate("耗時")}</th></tr></thead><tbody>{Object.entries(r.durations).map(([name, value]) => <tr key={name}><td>{names[name] ?? name}</td><td>{value === null ? translate("未知") : `${value.toFixed(1)} ms`}</td></tr>)}</tbody></table>
        <p>{translate("公開回答正式提交：")}{r.purpose === 'monitor' ? translate("不適用（監看不新增公開回答）") : r.answerSaved === true ? translate("已確認") : translate("未確認")}{translate("；既有診斷提交：")}{r.diagnosticsSaved === true ? translate("已確認") : translate("未確認／不適用")}{translate("。模型完成不代表正式保存。")}</p>
        <p>{translate("用量來源：")}{r.usageSource ?? translate("未知")}{translate("。cached input 與 reasoning output 保留 provider 原生語意，不重複加總；不代表所有 CLI 內部請求。")}</p>
        <pre>{r.usage ? JSON.stringify(r.usage, null, 2) : translate("用量未知")}</pre>
        <details><summary>{translate("原始效能診斷（offset 為自開始的累計時間點）")}</summary><pre>{JSON.stringify(r, null, 2)}</pre></details>
      </details>)}
    </>}
  </section>;
}
