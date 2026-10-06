import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
const build = path.resolve(process.env.CANDC_VERIFY_DIR ?? '.cache/verification');
const load = file => import(pathToFileURL(path.join(build, 'dist', file)).href);
const { FakeAdapter } = await load('adapters/fake.js');
const { DiscussionController } = await load('controller.js');
const { RoomController } = await load('room-controller.js');
const { DiscussionService } = await load('discussion-service.js');
const { RoomFakeAdapter, fakeRoomResponse } = await load('adapters/room-fake.js');
const { ROOM_CONTROL_START, ROOM_CONTROL_END, parseRoomAnswer } = await load('room-contract.js');
const { roomStateSchema } = await load('room-contract.js');
const { DiscussionStore } = await load('store.js');
const { PerformanceStore } = await load('performance.js');
const { createServer } = await load('server.js');
const { CONTROL_START, CONTROL_END } = await load('focused.js');
const directory = await mkdtemp(path.resolve('.cache/e2e-'));
const contribution = agent => request => {
  if (request.topic.startsWith('介面驗證')) {
    const text = `先把閱讀空間還給對話，讓每一次回應都有清楚的作者與來源。\n\n- 所有 AI 靠左，你的訊息靠右。\n- 設定與來源放在側面板，需要時才開啟。\n\n## Details\n\n### 適用條件\n\n這是隔離的示範回覆，不含真實推論或外部查證。\n\n#### 閱讀與復原\n\n`;
    return text + '| 檢查項目 | 完整說明 | 預期結果 |\n| --- | --- | --- |\n| 保存 | 保留完整公開回答與可核對來源，不以縮小文字換取空間 | 可明確區分生成與保存 |\n\n' +
      '```ts\nconst message = "LongCode_' + '完整內容_'.repeat(32) + '";\n```\n\n' + Array.from({ length: 14 }, (_, i) => `段落 ${i + 1}：長文閱讀保留完整上下文，捲動時不自動拉回底部；缺少可靠的細節邊界時直接顯示全文。\n\n`).join('') + `END-${agent}`;
  }
  if (request.topic === 'Interruption fixture.') return 'Complete public input remains available. '.repeat(70);
  if (request.contract && ['Focused fixture.', 'Conclusion fixture.'].includes(request.topic)) {
    const t = request.contract.taskCard;
    const refs = request.context.filter(m => m.sender === 'user').map(m => ({ messageId: m.id, disposition: 'addressed', reason: 'Supplied requirements addressed.' }));
    const peer = request.context.findLast(m => m.sender !== 'user' && m.sender !== agent && m.purpose === 'discussion');
    if (peer) refs.push({ messageId: peer.id, disposition: 'checked', reason: 'Peer answer checked against eligible user requirements.' });
    const action = t.proposal && t.proposal.author !== agent ? { type: 'confirm', proposalId: t.proposal.id, proposalVersion: t.proposal.version } : t.issueId ?
      { type: 'propose', outcome: 'concluded', result: 'Use the supplied facts with stated conditions.', conditions: 'Fixture evidence only.', unresolved: [], blocking: false } :
      t.overall && t.overall.author !== agent ? { type: 'confirm-overall', messageId: t.overall.messageId, version: t.overall.version } : { type: 'overall', result: 'Confirmed result, with skipped issues retained as limitations.' };
    return `Main judgment: ${action.type}. Conditions: supplied fixture facts only.\n\n## Details\n\n| Evidence | Status |\n| --- | --- |\n| Fixture | Checked |\n\n` + '```ts\nconst complete = true;\n```\n\n' + `END-${agent}\n${CONTROL_START}\n` + JSON.stringify({ version: 2, issueId: t.issueId, issueVersion: t.issueVersion, taskVersion: t.version, continuation: 'yield', action, annotation: { references: refs } }) + `\n${CONTROL_END}`;
  }
  if (request.topic === 'Markdown rendering fixture.') {
    const opinion = request.context.findLast(m => m.sender === 'user' && m.round > 0)?.text;
    return `## Format check

| Choice | Cost |
| --- | --- |
| Reliability | 100 |

- [x] Verified

~~Previous~~

` + '```ts\nconst value = "<tag>";\n```\n\n' + (opinion ? 'Received opinion: ' + opinion : 'Complete answer.') + '\nEND-' + agent;
  }
  if (request.untilConclusion) {
    const peer = request.context.findLast(m => m.sender !== 'user' && m.sender !== agent && m.continuation === 'conclude');
    if (request.topic === 'Long reading fixture.') {
      const paragraphs = Array.from({ length: 28 }, (_, index) => `Paragraph ${index + 1}: complete shared context remains available.\n\n`).join('');
      return `${paragraphs}END-${agent}\n${peer ? `Verified fixture conclusion.\n[[CANDC:conclude:${peer.id}]]` : 'Fixture conclusion proposal.\n[[CANDC:conclude]]'}`;
    }
    return peer ? `Verified fixture conclusion.\n[[CANDC:conclude:${peer.id}]]` : 'Fixture conclusion proposal.\n[[CANDC:conclude]]';
  }
  const count = request.context.filter(m => m.sender === agent && m.purpose === 'discussion').length;
  return request.autonomous || request.contract ? `Autonomous ${agent} contribution ${count + 1}.\n[[CANDC:${count === 0 ? 'yield' : count === 1 ? 'continue' : 'done'}]]` : `Fixture ${agent} answer.`;
};
let failStage = null;
const fault = async stage => { if (stage === failStage) { failStage = null; throw new Error('Fixture injected storage failure.'); } };
const performance = new PerformanceStore(path.join(directory, 'performance'), true);
const legacy = new DiscussionController(new DiscussionStore(directory, fault), { codex: new FakeAdapter('codex', contribution('codex'), 15), claude: new FakeAdapter('claude', contribution('claude'), 15) }, undefined, undefined, performance);
const adapters = new Map();
const policyResponse = request => {
  const text = fakeRoomResponse(request);
  if (request.topic.startsWith('Review handoff fixture:')) {
    const { control } = parseRoomAnswer(text), r = request.room;
    if (r.actor === 'moderator') control.action = r.openingSpeaker ? { type: 'observe' } : { type: 'speak', target: 'claude', task: 'Respond to the public rebuttal.' };
    else if (!r.proposal) control.action = { type: 'propose', result: 'An unaccepted proposed answer.', dissent: [], unresolved: [], delivery: { status: 'complete', kind: 'answer', basis: ['Public reasoning.'] } };
    else if (r.actor === 'claude' && !r.proposal.reviews?.some(review => review.actor === 'claude')) control.action = { type: 'confirm', proposalId: r.proposal.id,
      review: { adequate: false, reason: 'The proposed trade-off remains disputed.', gaps: ['Address the cost.'] } };
    else control.action = { type: 'none' };
    control.continuation = 'yield';
    if (request.topic.endsWith('downgraded') && r.conclusionRequest?.kind === 'review' && r.conclusionRequest.target === r.actor) control.unknown = 'Rejected control field.';
    return `Public response by ${r.actor}.\n${ROOM_CONTROL_START}\n${JSON.stringify(control)}\n${ROOM_CONTROL_END}`;
  }
  if (request.topic === 'Control fallback fixture.' || request.topic === 'Repair limit fixture.') {
    const { control } = parseRoomAnswer(text);
    if (request.topic === 'Control fallback fixture.') control.review = { adequate: true, reason: 'Rejected root-level review.', gaps: [] };
    else control.action = { type: 'propose', result: 'Saved answer needing delivery metadata.', dissent: [], unresolved: [] };
    return `Saved public discussion by ${request.room.actor}.\n${ROOM_CONTROL_START}\n${JSON.stringify(control)}\n${ROOM_CONTROL_END}`;
  }
  if (request.topic === 'Discussion revision fixture.' && request.room.purpose === 'discussion') {
    const { control } = parseRoomAnswer(text), r = request.room;
    const first = !r.messages.some(m => m.sender !== 'user' && m.purpose === 'discussion');
    const answer = 'A reviewed interim answer {0}.';
    control.action = r.proposal ? { type: 'confirm', proposalId: r.proposal.id, review: { adequate: true, reason: 'Independent peer review of the exact answer.', gaps: [] } } :
      first ? { type: 'propose', result: answer, dissent: ['A retained objection.'], unresolved: ['An unverified limitation.'], delivery: { status: 'complete', kind: 'answer', basis: ['Public fixture reasoning.'] } } : { type: 'none' };
    control.continuation = 'yield';
    if (first) control.work = { tasks: [{ key: 'invalid key', task: 'Rejected fixture metadata.' }] };
    return `${first ? answer : r.proposal ? 'Independent peer review.' : 'Further discussion after the reviewed result.'}\n${ROOM_CONTROL_START}\n${JSON.stringify(control)}\n${ROOM_CONTROL_END}`;
  }
  if (request.topic.startsWith('Delivery fixture:') && request.room.purpose === 'discussion') {
    const { control } = parseRoomAnswer(text), r = request.room;
    const mode = request.topic.slice('Delivery fixture:'.length);
    const delivery = { status: mode === 'partial' ? 'partial' : 'complete', kind: mode === 'undetermined' ? 'undetermined' : mode === 'disagreement' ? 'disagreement' : 'answer', basis: ['這是保存的示範推理依據，不代表真實模型或外部查證。'] };
    if (r.actor === 'codex') {
      const revise = mode !== 'revision' || !!r.conclusionRequest;
      const result = revise ? mode === 'partial' ? '已完成第一部分；第二部分的答案尚未取得。' : mode === 'undetermined' ? '目前無法定論，因為缺少能區分兩種解釋的證據。' : mode === 'disagreement' ? '雙方保留不同判斷：一方重視自主，另一方重視共同責任；目前沒有共同立場。' : '採用公開發言與針對同儕意見的回應紀錄，讓每個質疑都有可追溯的回覆。' : '之後實作流程，再安排測試。';
      control.action = { type: 'propose', result, delivery, dissent: mode === 'disagreement' ? ['雙方立場不同。'] : [], unresolved: mode === 'partial' ? ['第二部分的答案仍缺少。'] : mode === 'undetermined' ? ['尚缺能區分兩種解釋的證據。'] : [] };
    } else {
      const adequate = !r.proposal.result.startsWith('之後');
      control.action = { type: 'confirm', proposalId: r.proposal.id, review: { adequate, reason: adequate ? '此份結果交付了所標示的答案並保留限制。' : '這份文字只有未來工作，沒有交付使用者要求的答案。', gaps: adequate ? [] : ['請補齊實際運作方式。'] } };
    }
    control.continuation = 'done';
    return `${control.action.result ?? control.action.review.reason}\n${ROOM_CONTROL_START}\n${JSON.stringify(control)}\n${ROOM_CONTROL_END}`;
  }
  if (request.topic !== 'Active discussion fixture.' || request.room.purpose !== 'discussion') return text;
  const parsed = parseRoomAnswer(text), control = parsed.control;
  const answered = request.room.messages.findLast(m => m.sender === 'user' && m.recipient === 'all' && m.text.includes('預算已提供'));
  control.work = { checkpoint: { answer: '先以不同條件比較可行選項，個人預算待補充不阻塞分析。', reasons: ['固定情境分析已完成。'], dissent: ['成本與便利性仍有取捨。'], unknowns: ['現行資料尚未查證。'], sources: [request.messageId] },
    questions: [{ key: 'budget', text: '你的預算範圍？', reason: '個人偏好；其他分析可繼續。', sources: [request.messageId] }],
    tasks: [{ key: 'verify-current-data', kind: 'research', task: '查核當期官方資料。', sources: [request.messageId] }, { key: 'compare-scenarios', kind: 'analysis', target: 'codex', task: '比較不同條件下的選項。', sources: [request.messageId] }],
    completedTasks: request.room.execution.currentTaskKey ? [{ key: request.room.execution.currentTaskKey, sources: [request.messageId] }] : [],
    answeredQuestions: answered ? [{ key: 'budget', sources: [answered.id] }] : [] };
  return parsed.text + '\n' + ROOM_CONTROL_START + '\n' + JSON.stringify(control) + '\n' + ROOM_CONTROL_END;
};
const rooms = new RoomController(new DiscussionStore(directory, fault, roomStateSchema), (provider, workspace) => { if (!adapters.has(workspace)) adapters.set(workspace, new RoomFakeAdapter(provider, policyResponse, 3)); return adapters.get(workspace); }, undefined, performance);
const controller = new DiscussionService(legacy, rooms);
await controller.initialize();
const server = createServer(controller, { testFixture: true, webRoot: path.join(build, 'web-dist'), environment: async () => ({ node: process.version, codex: { version: 'fixture', authentication: 'not_logged_in', ready: false }, claude: { version: 'fixture', authentication: null, ready: false }, ready: false, loginCommands: { codex: 'codex login', claude: 'claude auth login' } }), models: async () => [{ id: 'fixture-codex', label: 'Fixture Codex', efforts: ['low', 'high'] }] });
server.addHook('onClose', async () => { setImmediate(() => process.exit(0)); });
// Fixture-only fault injection is authenticated by the server hook and is absent from the application server.
server.post('/__fixture/storage-fault', async request => { failStage = request.body.stage; return { armed: true }; });
await server.listen({host:'127.0.0.1',port:Number(process.env.CANDC_FIXTURE_PORT ?? 4399)});
console.log(JSON.stringify({ testFixture: true, port: Number(process.env.CANDC_FIXTURE_PORT ?? 4399), historyDirectory: directory, buildDirectory: build, adapters: ['fake-codex', 'fake-claude'] }));
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>void server.close().then(()=>process.exit(0)));
