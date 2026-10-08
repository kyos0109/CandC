import type { RoomInput } from '../src/room-contract.js';
import type { IconName } from './Icon.js';
import { translate } from './i18n.js';

export type DiscussionTemplate = {
  id: string;
  name: string;
  description: string;
  icon: IconName;
  goal: string;
  kind: 'discussion';
  mode: RoomInput['mode'];
  roles: ReadonlyArray<{ label: string; stance: string }>;
};

// Resolve application text in the current locale. Selecting a template retains that snapshot.
export function discussionTemplates(): DiscussionTemplate[] {
  return [
    { id: 'decision-lab', name: 'Decision Lab', description: translate("方案評估與決策"), icon: 'scale', kind: 'discussion', mode: 'conclusion',
      goal: translate("請產出決策紀錄，包含問題背景、可行選項、建議決定與理由、主要取捨、風險與回復方式，以及仍待確認的假設。若證據不足，請保留不確定性，不強制形成一致立場。"),
      roles: [
        { label: translate("方案分析"), stance: translate("比較可行選項、成立條件與主要取捨。") },
        { label: translate("假設與反例審查"), stance: translate("檢查前提、反例與可能改變判斷的資訊。") },
        { label: translate("風險與可靠性"), stance: translate("評估失敗情境、影響與可執行的回復方式。") },
        { label: translate("成本與維護"), stance: translate("評估建置、運作與長期維護的成本及取捨。") },
      ] },
    { id: 'engineering-review', name: 'Engineering Review', description: translate("架構與技術審查"), icon: 'server', kind: 'discussion', mode: 'conclusion',
      goal: translate("請審查系統架構，整理主要發現、嚴重程度及其依據、可靠性與安全風險、效能與成本取捨、替代方案、尚待確認的問題，以及可實際執行的驗證方式。未經驗證的風險應標示為假設。"),
      roles: [
        { label: translate("軟體／系統架構師"), stance: translate("檢查系統邊界、資料流與替代設計。") },
        { label: translate("SRE／維運"), stance: translate("檢查故障模式、可觀測性與復原方式。") },
        { label: translate("安全審查員"), stance: translate("檢查信任邊界、安全假設與具體風險。") },
        { label: translate("效能／成本審查員"), stance: translate("檢查容量、瓶頸、成本與量測方式。") },
      ] },
    { id: 'research-council', name: 'Research Council', description: translate("研究與證據核對"), icon: 'search', kind: 'discussion', mode: 'conclusion',
      goal: translate("請整理研究問題、主要主張、支持與反對證據、來源及限制，區分已知事實、推論與待查證事項，指出哪些新證據可能改變判斷。請保留分歧，不把未查證內容當成事實。"),
      roles: [
        { label: translate("主張與證據整理"), stance: translate("對照研究問題、各項主張與支持依據。") },
        { label: translate("來源與方法審查"), stance: translate("檢查來源品質、時效與研究方法限制。") },
        { label: translate("反證與替代解釋"), stance: translate("尋找反證與其他合理解釋，說明判別方式。") },
        { label: translate("綜合與不確定性"), stance: translate("整理共同接受的部分、分歧與待查事項。") },
      ] },
    { id: 'incident-war-room', name: 'Incident War Room', description: translate("故障分析與推演"), icon: 'pulse', kind: 'discussion', mode: 'manual',
      goal: translate("請依提供資料整理故障時間線、影響範圍、已知事實、原因假設及反證，提出緩解、回復與驗證步驟，列出待補資料。請區分已觀察結果與待執行操作。"),
      roles: [
        { label: translate("時間線與影響分析"), stance: translate("依提供資料重建事件順序與影響範圍。") },
        { label: translate("原因假設與反證"), stance: translate("提出原因假設、反證與可區分原因的檢查。") },
        { label: translate("緩解與復原"), stance: translate("提出可回復的緩解措施及恢復驗證方式。") },
        { label: translate("驗證與預防"), stance: translate("確認恢復條件與避免故障復發的方式。") },
      ] },
    { id: 'code-review-board', name: 'Code Review Board', description: translate("程式碼交叉審查"), icon: 'branch', kind: 'discussion', mode: 'conclusion',
      goal: translate("請審查提供的程式碼或差異，整理具體問題、位置、影響、觸發條件、修正方向與回歸測試。請區分已證實問題、推測風險及未檢查範圍，不宣稱已執行未執行的測試。"),
      roles: [
        { label: translate("行為與正確性"), stance: translate("核對需求、程式邏輯與實際行為。") },
        { label: translate("邊界與測試"), stance: translate("檢查失敗路徑、邊界條件與回歸案例。") },
        { label: translate("安全審查"), stance: translate("檢查輸入、權限與敏感資料處理。") },
        { label: translate("效能與維護"), stance: translate("評估資源成本與程式可理解性。") },
      ] },
    { id: 'simulation-arena', name: 'Simulation Arena', description: translate("角色與情境模擬"), icon: 'masks', kind: 'discussion', mode: 'manual',
      goal: translate("請依提供情境進行角色推演，明列角色、假設、限制、決策節點與可能後果，比較不同回應並整理觀察及待驗證事項。模擬內容應明確標示為假設，不視為真實事件或證據。"),
      roles: [
        { label: translate("情境推演"), stance: translate("依使用者提供的條件推演決策與後果。") },
        { label: translate("利害關係人視角"), stance: translate("分析情境中不同角色的需求與可能反應。") },
        { label: translate("變因與反例"), stance: translate("測試關鍵假設改變後的結果與反例。") },
        { label: translate("觀察與回顧"), stance: translate("整理推演後果、限制與待驗證事項。") },
      ] },
  ];
}

type Origin = 'untouched' | 'template' | 'user';
type SeatOrigins = { label: Origin; stance: Origin };
export type TemplateOrigins = { goal: Origin; kind: Origin; mode: Origin; seats: Record<number, SeatOrigins> };
export const emptyTemplateOrigins = (): TemplateOrigins => ({ goal: 'untouched', kind: 'untouched', mode: 'untouched', seats: {} });
export type TemplateSeat = { uid: number; label: string; stance: string };
type TemplateDraft = { goal: string; kind: RoomInput['kind']; mode: RoomInput['mode']; seats: TemplateSeat[] };

/** Drop retired UIDs without transferring their edits to replacement seats. */
export function retainTemplateSeats(origins: TemplateOrigins, seats: readonly TemplateSeat[]): TemplateOrigins {
  return { ...origins, seats: Object.fromEntries(seats.filter(s => origins.seats[s.uid]).map(s => [s.uid, origins.seats[s.uid]!])) };
}

/** Only the explicitly managed fields are changed; all other draft/seat data survives. */
export function applyDiscussionTemplate<T extends TemplateDraft>(draft: T, template: DiscussionTemplate, origins: TemplateOrigins, reset = false): { draft: T; origins: TemplateOrigins } {
  if (draft.kind === 'selection') return { draft, origins };
  const next = { ...draft }, source = retainTemplateSeats(reset ? emptyTemplateOrigins() : origins, draft.seats);
  if (source.goal !== 'user') { next.goal = template.goal; source.goal = 'template'; }
  if (source.kind !== 'user') { next.kind = template.kind; source.kind = 'template'; }
  if (source.mode !== 'user') { next.mode = template.mode; source.mode = 'template'; }
  next.seats = draft.seats.map((seat, index) => {
    const role = template.roles[index];
    if (!role) return seat;
    const previous = source.seats[seat.uid] ?? { label: 'untouched', stance: 'untouched' };
    source.seats[seat.uid] = { label: previous.label === 'user' ? 'user' : 'template', stance: previous.stance === 'user' ? 'user' : 'template' };
    return { ...seat, ...(previous.label !== 'user' ? { label: role.label } : {}), ...(previous.stance !== 'user' ? { stance: role.stance } : {}) };
  });
  return { draft: next, origins: source };
}
