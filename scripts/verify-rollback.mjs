import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const revision = process.argv[2];
if (!revision || !/^[a-f0-9]{7,40}$/i.test(revision)) throw new Error('Pass the pre-upgrade baseline commit SHA.');
const git = args => execFileSync('git', args, { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
const baseline = git(['rev-parse', '--verify', `${revision}^{commit}`]).trim();
const cache = path.resolve('.cache');
const build = path.resolve(process.env.CANDC_VERIFY_DIR ?? '.cache/verification');
if (!build.startsWith(cache + path.sep)) throw new Error('Verification build must be inside the workspace cache.');
await mkdir(cache, { recursive: true });
const work = await mkdtemp(path.join(cache, 'rollback-check-'));
try {
  const source = path.join(work, 'src'), data = path.join(work, 'data'), restore = path.join(work, 'restore');
  await Promise.all([source, data, restore].map(dir => mkdir(dir)));
  for (const file of ['domain.ts', 'store.ts']) await writeFile(path.join(source, file), git(['show', `${baseline}:src/${file}`]));
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--ignoreConfig', '--types', 'node', '--target', 'ES2023',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--skipLibCheck', '--outDir', path.join(work, 'dist'),
    path.join(source, 'domain.ts'), path.join(source, 'store.ts')], { windowsHide: true, timeout: 60_000 });
  const { DiscussionStore: OldStore } = await import(pathToFileURL(path.join(work, 'dist/store.js')).href);
  const load = file => import(pathToFileURL(path.join(build, 'dist', file)).href);
  const { DiscussionStore } = await load('store.js');
  const { DiscussionController } = await load('controller.js');
  const { FakeAdapter } = await load('adapters/fake.js');
  const id = randomUUID(), now = new Date().toISOString(), topic = 'Isolated rollback fixture';
  const oldState = { id, topic, backend: 'fake', kind: 'discussion', mode: 'manual', flow: 'free', roles: { codex: '', claude: '' },
    research: false, roots: [], agents: { codex: { model: 'fixture', effort: 'medium' }, claude: { model: 'fixture', effort: 'medium' } },
    limits: { maxRounds: 50, maxDurationMs: 14_400_000, turnTimeoutMs: 600_000 }, status: 'ready', round: 1, nextSpeaker: 'codex',
    completedInRound: [], sessions: {}, messages: [{ id: randomUUID(), sender: 'user', recipient: 'both', text: topic, round: 0,
      inReplyTo: null, status: 'completed', createdAt: now }], createdAt: now, elapsedMs: 0, pauseReason: null, operationIds: [],
    sequence: 1, rolesConfirmed: true, activity: null, evidence: [] };
  await new OldStore(data).commit(oldState, { sequence: 1, discussionId: id, type: 'created', at: now, data: {} });
  const original = await readFile(path.join(data, `${id}.jsonl`));
  const store = new DiscussionStore(data);
  assert.equal((await store.records(id)).at(-1).state.behaviorVersion, 1);
  const controller = new DiscussionController(store, { codex: new FakeAdapter('codex'), claude: new FakeAdapter('claude') });
  try {
    await controller.initialize();
    const upgraded = await controller.upgrade(id, randomUUID());
    assert.equal(upgraded.v2.sourceDiscussionId, id);
    assert.deepEqual(await readFile(path.join(data, `${id}.jsonl`)), original);
    await assert.rejects(new OldStore(data).records(upgraded.id), /invalid compact schema/);
    await writeFile(path.join(restore, `${id}.jsonl`), original);
    assert.deepEqual((await new OldStore(restore).records(id)).at(-1).state, oldState);
  } finally { await controller.close(); }
  const report = { baseline, legacyReadByNewCode: true, sourceJournalUnchangedByUpgrade: true,
    upgradedJournalRejectedByOldCode: true, preUpgradeBackupReadableByOldCode: true, userDataTouched: false, liveCalls: 0 };
  await writeFile(path.join(cache, 'rollback-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  const target = path.resolve(work);
  if (!target.startsWith(cache + path.sep)) throw new Error('Unsafe rollback fixture cleanup target.');
  await rm(target, { recursive: true, force: true });
}
