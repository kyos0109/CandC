import { randomBytes, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { z, ZodError } from 'zod';
import { AppError, agentIdSchema, discussionInputSchema } from './domain.js';
import { DiscussionController } from './controller.js';
import { DiscussionService } from './discussion-service.js';
import { participantSchema, roomInputSchema } from './room-contract.js';
import { safeError } from './redaction.js';
import fastifyStatic from '@fastify/static';
import { stat } from 'node:fs/promises';
import { diagnose, codexCatalog, roomProviderStatuses, type EnvironmentStatus } from './environment.js';

const idParams = z.object({ id: z.uuid() });
const operationBody = z.object({ operationId: z.uuid() }).strict();
const messageBody = z.object({ messageId: z.uuid(), text: z.string().trim().min(1).max(32_000),
  inReplyTo: z.uuid().nullable().default(null),
  recipient: z.union([participantSchema, z.literal('both'), z.literal('all')]).default('both') }).strict();

export function createServer(controller: DiscussionController | DiscussionService, options: { accessToken?: string; disconnectGraceMs?: number;
  webRoot?: string; environment?: () => Promise<EnvironmentStatus>; models?: typeof codexCatalog; testFixture?: boolean } = {}) {
  const token = options.accessToken ?? randomBytes(32).toString('hex');
  const server = Fastify({ logger: false, bodyLimit: 128 * 1024, requestTimeout: 30_000 });
  const subscribers = new Map<string, number>();
  const disconnectTimers = new Map<string, NodeJS.Timeout>();
  const responses = new Set<import('node:http').ServerResponse>();

  server.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host ?? '';
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(host)) return reply.code(403).send({ error: 'INVALID_HOST' });
    const origin = request.headers.origin;
    if (origin && origin !== `http://${host}`) return reply.code(403).send({ error: 'INVALID_ORIGIN' });
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if (request.url === '/health' || request.url === '/api/session' || request.url === '/' || request.url.startsWith('/assets/') || request.url === '/favicon.svg') return;
    const bearer = request.headers.authorization?.replace(/^Bearer /, '');
    const cookie = request.headers.cookie?.split(';').map((value) => value.trim()).find((value) => value.startsWith('candc_session='))?.slice('candc_session='.length);
    const candidate = bearer ?? cookie ?? '';
    const valid = Buffer.byteLength(candidate) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(candidate), Buffer.from(token));
    if (!valid) return reply.code(401).send({ error: 'UNAUTHORIZED' });
  });

  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'INVALID_INPUT', message: 'Request does not match the API contract.' });
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: error.code, message: safeError(error) });
    const status = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500 ? error.statusCode : 500;
    return reply.code(status).send({ error: status < 500 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR' });
  });

  server.get('/health', async () => ({ application: 'candc', testFixture: options.testFixture === true, status: 'ok', phase: 2, backend: 'selectable', liveMessagesEnabled: true }));
  server.get('/api/session', async (_request, reply) => {
    reply.header('Set-Cookie', `candc_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
    return { backend: 'selectable', phase: 2, liveMessagesEnabled: true };
  });
  server.get('/api/environment', async () => options.environment ? options.environment() : { ...await diagnose(), providers: await roomProviderStatuses() });
  server.get('/api/models', async () => {
    try { return { codex: await (options.models ?? codexCatalog)(), claude: ['sonnet', 'opus', 'fable'], gemini: [], grok: [], error: null }; }
    catch { return { codex: [], claude: ['sonnet', 'opus', 'fable'], error: '無法讀取 Codex 模型清單。請確認 CLI 能正常啟動，再按左側「重新檢查」。' }; }
  });
  if (options.webRoot) {
    server.register(async (instance) => {
      await stat(options.webRoot!);
      await instance.register(fastifyStatic, { root: options.webRoot!, index: ['index.html'], wildcard: true });
    });
  }
  server.get('/api/discussions', async () => controller.list());
  server.get('/api/discussions/:id/performance', async request => controller.performanceView(idParams.parse(request.params).id));
  server.get('/api/performance/report', async (request, reply) => {
    const { format } = z.object({ format: z.enum(['json', 'markdown']).default('json') }).strict().parse(request.query);
    reply.header('Content-Disposition', `attachment; filename="candc-performance.${format === 'json' ? 'json' : 'md'}"`);
    if (format === 'markdown') reply.type('text/markdown; charset=utf-8');
    return controller.performanceBaseline(format);
  });
  server.get('/api/storage-issues', async () => controller.storageIssues());
  server.post('/api/discussions', async (request, reply) => {
    const body = z.object({ id: z.uuid(), input: z.union([discussionInputSchema, roomInputSchema]) }).strict().parse(request.body);
    if (body.input.behaviorVersion === 3) {
      if (!(controller instanceof DiscussionService)) throw new AppError('BACKEND_UNAVAILABLE', 'Version 3 controller unavailable.');
      return reply.code(201).send(await controller.createRoom(body.id, body.input));
    }
    return reply.code(201).send(await controller.create(body.id, body.input));
  });
  server.get('/api/discussions/:id', async (request) => controller.get(idParams.parse(request.params).id));
  server.patch('/api/discussions/:id/display-name', async request => {
    const { id } = idParams.parse(request.params);
    const body = z.object({ displayName: discussionInputSchema.shape.displayName.unwrap(), expectedVersion: z.number().int().nonnegative() }).strict().parse(request.body);
    return controller.rename(id, body.displayName, body.expectedVersion);
  });
  server.post('/api/discussions/:id/start', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { operationId } = operationBody.parse(request.body);
    return reply.code(202).send(await controller.start(id, operationId));
  });
  for (const purpose of ['roles', 'summary'] as const) {
    server.post(`/api/discussions/:id/${purpose}`, async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const { operationId } = operationBody.parse(request.body);
      return reply.code(202).send(await controller.start(id, operationId, purpose));
    });
  }
  server.patch('/api/discussions/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = z.object({ mode: discussionInputSchema.shape.mode.removeDefault().optional(),
      flow: discussionInputSchema.shape.flow.removeDefault().optional(),
      expectedVersion: z.number().int().positive().optional(),
      topic: discussionInputSchema.shape.topic.optional(), goal: discussionInputSchema.shape.goal.removeDefault().optional(),
      constraints: discussionInputSchema.shape.constraints.removeDefault().optional(), focused: z.boolean().optional(),
      roles: z.object({ codex: z.string().trim().min(1).max(4_000), claude: z.string().trim().min(1).max(4_000) }).optional(),
      maxModeratorCalls: z.number().int().min(1).max(10_000).optional(), confirmRoles: z.boolean().optional(),
      discussionPolicyVersion: z.literal(1).optional(), research: z.boolean().optional(), roots: roomInputSchema.shape.roots.removeDefault().optional(),
      moderatorMode: roomInputSchema.shape.moderatorMode,
      limits: discussionInputSchema.shape.limits.removeDefault().optional() }).strict().parse(request.body);
    return controller.configure(id, body);
  });
  server.post('/api/discussions/:id/fork', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = z.object({ newId: z.uuid() }).strict().parse(request.body);
    return controller.fork(id, body.newId);
  });
  server.post('/api/discussions/:id/upgrade', async request => {
    const { id } = idParams.parse(request.params);
    return controller.upgrade(id, z.object({ newId: z.uuid() }).strict().parse(request.body).newId);
  });
  server.post('/api/discussions/:id/upgrade-v3', async request => {
    if (!(controller instanceof DiscussionService)) throw new AppError('BACKEND_UNAVAILABLE', 'Version 3 unavailable.');
    const body = z.object({ newId: z.uuid(), moderator: roomInputSchema.shape.moderator.optional() }).strict().parse(request.body);
    return controller.upgradeRoom(idParams.parse(request.params).id, body.newId, body.moderator ?? null);
  });
  server.post('/api/discussions/:id/pending-topic', async request => {
    if (!(controller instanceof DiscussionService)) throw new AppError('BACKEND_UNAVAILABLE', 'Version 3 unavailable.');
    const body = z.object({ operationId: z.uuid(), expectedVersion: z.number().int().positive(), apply: z.boolean() }).strict().parse(request.body);
    return controller.resolveTopic(idParams.parse(request.params).id, body.operationId, body.expectedVersion, body.apply);
  });
  server.post('/api/discussions/:id/recover', async request => {
    const { id } = idParams.parse(request.params);
    return controller.recover(id, z.object({ repairTail: z.boolean().default(false) }).strict().parse(request.body).repairTail);
  });
  server.post('/api/discussions/:id/rebuild', async request => {
    const { id } = idParams.parse(request.params);
    const body = z.object({ operationId: z.uuid(), expectedVersion: z.number().int().positive() }).strict().parse(request.body);
    return controller.rebuild(id, body.operationId, body.expectedVersion);
  });
  server.post('/api/discussions/:id/issues', async request => {
    const { id } = idParams.parse(request.params);
    const body = z.object({ operationId: z.uuid(), expectedVersion: z.number().int().positive(), action: z.enum(['add', 'select', 'skip', 'dispose']),
      issueId: z.uuid().optional(), title: z.string().trim().min(1).max(32_000).optional() }).strict().parse(request.body);
    return controller.issueAction(id, body.operationId, body.expectedVersion, body.action, body.issueId, body.title);
  });
  server.get('/api/discussions/:id/export', async (request, reply) => {
    const state = controller.get(idParams.parse(request.params).id);
    const format = z.object({ format: z.enum(['json', 'markdown']).default('markdown') }).parse(request.query).format;
    reply.header('Content-Disposition', `attachment; filename="candc-${state.id}.${format === 'json' ? 'json' : 'md'}"`);
    if (format === 'json') return state;
    reply.type('text/markdown; charset=utf-8');
    return `# ${state.topic}\n\nBackend: ${state.backend}\nStatus: ${state.status}\n\n` +
      state.messages.map((message) => `## ${message.sender} → ${message.recipient} · round ${message.round} · ${message.purpose ?? 'discussion'} · ${message.status}\n\n${message.text}`).join('\n\n') +
      '\n\n## Evidence\n\n' + state.evidence.map((item) => `- ${item.source} (${item.retrievedAt}, SHA256 ${item.sha256}, truncated=${item.truncated})`).join('\n') +
      (state.behaviorVersion === 3 ? '\n\n## Moderation, topic changes and outcome\n\n```json\n' + JSON.stringify({ commands: state.room.commands, topicHistory: state.room.topicHistory, outcome: state.room.outcome, workflow: state.room.workflow }, null, 2) + '\n```' : state.v2 ? '\n\n## Issues and result limits\n\n' + state.v2.issues.map(i => `- ${i.title}: ${i.status}; ${i.result}; unresolved: ${i.unresolved.join('; ')}`).join('\n') +
        '\n\n## Call diagnostics\n\n```json\n' + JSON.stringify(state.v2.calls, null, 2) + '\n```' : '');
  });
  server.post('/api/discussions/:id/pause', async (request) => controller.pause(idParams.parse(request.params).id));
  server.post('/api/discussions/:id/stop', async (request) => controller.stop(idParams.parse(request.params).id));
  server.post('/api/shutdown', async (_request, reply) => {
    reply.send({ stopping: true });
    setImmediate(() => void server.close());
  });
  server.post('/api/discussions/:id/messages', async (request) => {
    const { id } = idParams.parse(request.params);
    const body = messageBody.parse(request.body);
    if (controller instanceof DiscussionService) return controller.send(id, body.messageId, body.text, body.recipient, body.inReplyTo);
    const recipient = z.union([agentIdSchema, z.literal('both')]).parse(body.recipient);
    return controller.send(id, body.messageId, body.text, recipient, body.inReplyTo);
  });
  server.get('/api/discussions/:id/events', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const query = z.object({ after: z.coerce.number().int().nonnegative().default(0) }).parse(request.query);
    const header = request.headers['last-event-id'];
    let lastSequence = header ? z.coerce.number().int().nonnegative().parse(header) : query.after;
    controller.get(id);
    // Subscribe before reading the journal; sequence filtering prevents replay/live overlap duplicates.
    let replaying = true;
    let pumping = false;
    let pendingBytes = 0;
    const pending: import('./domain.js').RunEvent[] = [];
    const write = async (event: import('./domain.js').RunEvent) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return;
      if (event.type !== 'progress' && event.sequence <= lastSequence) return;
      const frame = event.type === 'progress' ? `event: progress\ndata: ${JSON.stringify(event)}\n\n` :
        `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      if (event.type !== 'progress') lastSequence = event.sequence;
      if (!reply.raw.write(frame)) {
        await new Promise<void>(resolve => {
          const done = () => {
            clearTimeout(timeout);
            reply.raw.off('drain', done).off('close', done).off('error', done);
            resolve();
          };
          const timeout = setTimeout(() => reply.raw.destroy(), 15_000);
          reply.raw.once('drain', done).once('close', done).once('error', done);
          if (reply.raw.destroyed) done();
        });
      }
    };
    const pump = async () => {
      if (pumping || replaying) return;
      pumping = true;
      try {
        while (pending.length && !reply.raw.destroyed && !reply.raw.writableEnded) {
          const event = pending.shift()!;
          pendingBytes -= Buffer.byteLength(JSON.stringify(event));
          await write(event);
        }
      } catch { reply.raw.destroy(); }
      finally { pumping = false; }
    };
    const unsubscribe = controller.subscribe(id, event => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return;
      pendingBytes += Buffer.byteLength(JSON.stringify(event));
      // Bound concurrent live updates, not the total persisted history being replayed.
      if (pendingBytes > 8 * 1024 * 1024) { reply.raw.destroy(); return; }
      pending.push(event);
      void pump();
    });
    let replay: import('./domain.js').RunEvent[];
    try { replay = await controller.events(id, lastSequence); }
    catch (error) { unsubscribe(); throw error; }
    if (reply.raw.destroyed) { unsubscribe(); return; }
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    reply.raw.flushHeaders();
    responses.add(reply.raw);
    clearTimeout(disconnectTimers.get(id));
    disconnectTimers.delete(id);
    subscribers.set(id, (subscribers.get(id) ?? 0) + 1);
    const heartbeat = setInterval(() => {
      if (!replaying && !pumping && !reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(': heartbeat\n\n');
    }, 10_000);
    reply.raw.once('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      pending.length = 0;
      pendingBytes = 0;
      responses.delete(reply.raw);
      const count = (subscribers.get(id) ?? 1) - 1;
      subscribers.set(id, count);
      if (count === 0) {
        const timer = setTimeout(() => {
          disconnectTimers.delete(id);
          if (controller.get(id).status === 'running') void controller.pause(id).catch(() => undefined);
        }, options.disconnectGraceMs ?? 15_000);
        timer.unref();
        disconnectTimers.set(id, timer);
      }
    });
    try {
      for (const event of replay) {
        if (reply.raw.destroyed || reply.raw.writableEnded) break;
        await write(event);
      }
      replaying = false;
      await pump();
    } catch { reply.raw.destroy(); }
  });

  server.addHook('preClose', async () => {
    for (const response of responses) response.end();
    for (const timer of disconnectTimers.values()) clearTimeout(timer);
    await controller.close();
  });
  return server;
}
