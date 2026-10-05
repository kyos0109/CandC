import { useEffect, useState } from 'react';
import type { PerformanceView } from '../src/performance';
import { api } from './api';

const names: Record<string, string> = {
  lock: '取得執行鎖', login: '登入與版本檢查', catalog: '模型清單檢查', selection: '輸入選取', prepared: '準備快照保存',
  research: '研究設定準備', inspectSpawn: '前置程序啟動', inspectRead: '繼承設定讀取', inspectCleanup: '前置程序清理',
  inferenceSpawn: '推論程序啟動', rpc: 'RPC 初始化', policy: '政策驗證', session: '工作階段建立／恢復',
  preparation: '回合前置準備', codexPreparation: 'Codex 前置與工作階段準備', waitFirstReply: '等待首段回覆', generation: '首段至協定完成', cleanup: '推論程序清理',
  answerCommit: '公開回答正式保存', diagnosticCommit: '既有診斷保存', total: '處理總耗時',
};
const outcomes: Record<string, string> = { success: '完成', cancelled: '已取消', timeout: '逾時', 'startup-error': '啟動失敗',
  'protocol-error': '協定失敗', 'cleanup-error': '清理失敗', 'storage-unknown': '未確認保存', failed: '失敗' };
const purposes = { discussion: '一般發言', moderation: '主持裁決', monitor: '主持監看', summary: '整理', roles: '立場提議' };
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
  return <section aria-label="AI 呼叫效能量測"><h3>AI 呼叫效能量測</h3>
    <p>等待首段回覆可能包含 CLI、網路、排隊、推理與工具時間；無法區分服務端內部耗時。只使用日常討論樣本，不推估帳單。</p>
    <div className="performance-downloads"><a href="/api/performance/report?format=json" download>下載 JSON 基準報表</a><a href="/api/performance/report?format=markdown" download>下載 Markdown 基準報表</a></div>
    {error && <p role="status">效能診斷讀取失敗。</p>}
    {!view && !error && <p>載入量測中…</p>}
    {view && <><p>保留樣本：開始操作 {view.records.filter(r => r.kind === 'execution').length} 次、回合 {view.records.filter(r => r.kind === 'turn').length} 次。基準預設只統計 live；同組至少 20 個完整成功回合、3 個討論，且 CLI／模型已知，才提供方向性判讀。</p>
      {!view.available && <p role="status">{view.enabled ? '診斷不可用' : '新增量測已停用'}；正式保存狀態請依討論紀錄判定。</p>}
      <p>本程序遺漏 {view.dropped} 筆，損壞記錄跳過 {view.corrupt} 筆。只涵蓋輪替檔保留期間；舊歷史不補算，重啟前遺漏數未知。</p>
      {view.records.length === 0 && <p>資料不足：目前沒有新格式量測樣本。</p>}
      {view.records.map(r => <details key={r.requestId ?? r.executionId}><summary>{r.kind === 'execution' ? '開始／續談' : `${r.provider} · 第 ${r.round} 輪 · ${r.session === 'new' ? '新工作階段' : '恢復工作階段'}`} · {r.incomplete ? '不完整（未觀測結束）' : outcomes[r.outcome ?? ''] ?? '未知'} · {r.backend}</summary>
        <p>{purposes[r.purpose]} · 座位 {r.participant ?? '未知／舊格式未記錄'} · {r.model ?? '模型未知'} · {r.effort ?? 'effort 未知'} · CLI {r.cliVersion ?? '未知'} · {r.characters === null ? '輸入大小未知' : `${r.characters.toLocaleString()} 字元`} · 工具事件 {r.incomplete ? '未知' : r.tools}</p>
        <p>程序啟動：前置 {r.processes.inspection ?? '未知'}、推論 {r.processes.inference ?? '未知'}。{r.textMode === 'final-only' ? '僅最終答案觀測到文字（final-only），不納入串流首段統計。' : r.textMode === 'stream' ? '首段公開串流文字已觀測。' : '首段文字未知。'}</p>
        <table><thead><tr><th>階段 duration</th><th>耗時</th></tr></thead><tbody>{Object.entries(r.durations).map(([name, value]) => <tr key={name}><td>{names[name] ?? name}</td><td>{value === null ? '未知' : `${value.toFixed(1)} ms`}</td></tr>)}</tbody></table>
        <p>公開回答正式提交：{r.purpose === 'monitor' ? '不適用（監看不新增公開回答）' : r.answerSaved === true ? '已確認' : '未確認'}；既有診斷提交：{r.diagnosticsSaved === true ? '已確認' : '未確認／不適用'}。模型完成不代表正式保存。</p>
        <p>用量來源：{r.usageSource ?? '未知'}。cached input 與 reasoning output 保留 provider 原生語意，不重複加總；不代表所有 CLI 內部請求。</p>
        <pre>{r.usage ? JSON.stringify(r.usage, null, 2) : '用量未知'}</pre>
        <details><summary>原始效能診斷（offset 為自開始的累計時間點）</summary><pre>{JSON.stringify(r, null, 2)}</pre></details>
      </details>)}
    </>}
  </section>;
}
