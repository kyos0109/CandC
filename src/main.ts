import { PerformanceStore } from './performance.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeAdapter } from './adapters/fake.js';
import { DiscussionController } from './controller.js';
import { DiscussionService } from './discussion-service.js';
import { RoomController } from './room-controller.js';
import { roomStateSchema, type ProviderId } from './room-contract.js';
import { RoomFakeAdapter } from './adapters/room-fake.js';
import { GeminiAdapter } from './adapters/gemini.js';
import { GrokAdapter } from './adapters/grok.js';
import { DiscussionStore } from './store.js';
import { createServer } from './server.js';
import { mkdir } from 'node:fs/promises';
import { CodexAdapter } from './adapters/codex.js';
import { ClaudeAdapter } from './adapters/claude.js';
import { executablePaths, requireLiveReady, requireRoomReady } from './environment.js';
import type { TurnRequest } from './adapters/types.js';

function demoContribution(agent: 'codex' | 'claude', request: TurnRequest): string {
  if (request.untilConclusion) {
    const peer = request.context.findLast(m => m.sender !== 'user' && m.sender !== agent && m.continuation === 'conclude');
    return peer ? `示範結論確認：我同意上述條件式結論，應先確認恢復時間與預算，再比較方案。這是示範回覆，沒有真實推論。\n[[CANDC:conclude:${peer.id}]]` : '示範結論提案：先訂出可接受的恢復時間與預算，再比較可靠性和成本；目前缺少實際數據，不能直接選定方案。這是示範回覆。\n[[CANDC:conclude]]';
  }
  const contributions = request.context.filter(m => m.sender === agent && m.purpose === 'discussion').length;
  const ideas = agent === 'codex'
    ? ['我會先檢視可靠性與維護成本。', '我想再補充：應先訂出可接受的故障恢復時間，再比較方案。', '補充完畢。還需要實際限制與數據，才能判斷方案是否適合。']
    : ['我會補充成本、效率與替代方案。', '我想追問：為可靠性增加的費用，是否低於預期故障損失？', '補充完畢。需要預算與故障損失估算，才能核對這個取捨。'];
  const control = contributions === 0 ? 'yield' : contributions === 1 ? 'continue' : 'done';
  return `[示範 ${agent === 'codex' ? 'Codex' : 'Claude'}]\n\n${ideas[Math.min(contributions, 2)]}\n\n這是示範回覆，沒有呼叫真實 AI。${request.autonomous ? `\n[[CANDC:${control}]]` : ''}`;
}

const root = process.env.CANDC_DATA_DIR ? path.resolve(process.env.CANDC_DATA_DIR) : path.resolve('data');
const paths = executablePaths();
const cwd = path.resolve('.cache/agents/live');
await mkdir(cwd, { recursive: true });
const performance = new PerformanceStore();
const legacy = new DiscussionController(new DiscussionStore(root), {
  codex: new FakeAdapter('codex', request => demoContribution('codex', request), 25),
  claude: new FakeAdapter('claude', request => demoContribution('claude', request), 25),
}, {
  codex: new CodexAdapter(paths.codex, cwd, { messagesAuthorized: true, toolPolicyVerified: true }),
  claude: new ClaudeAdapter(paths.claude, cwd, { messagesAuthorized: true, toolPolicyVerified: true }),
}, requireLiveReady, performance);
const fixtures = new Map<string, RoomFakeAdapter>();
const rooms = new RoomController(new DiscussionStore(root, undefined, roomStateSchema), (provider, workspace, backend, actor) => {
  if (backend === 'fake') {
    const key = `${workspace}:${actor}`; let fixture = fixtures.get(key);
    if (!fixture) { fixture = new RoomFakeAdapter(provider); fixtures.set(key, fixture); } return fixture;
  }
  const constructors = { codex: CodexAdapter, claude: ClaudeAdapter, gemini: GeminiAdapter, grok: GrokAdapter };
  // New providers stay locked until their installed protocol and effective policy have passed live validation.
  return new constructors[provider](paths[provider], workspace, { messagesAuthorized: true, toolPolicyVerified: provider === 'codex' || provider === 'claude' });
}, requireRoomReady, performance);
const controller = new DiscussionService(legacy, rooms);
await controller.initialize();
const server = createServer(controller, { webRoot: fileURLToPath(new URL('../web-dist/', import.meta.url)),
  ...(process.env.CANDC_INSTANCE_ID ? { instanceId: process.env.CANDC_INSTANCE_ID } : {}) });
const port = Number(process.env.CANDC_PORT ?? 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CANDC_PORT must be a valid local port.');
const address = await server.listen({ host: '127.0.0.1', port });
console.log(`CandC ready at ${address}. Select live AI or demo in the browser.`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void server.close().then(() => { process.exitCode = 0; }); });
}
