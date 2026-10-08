import { selectionMarkdown } from './selection.js';
import { registerEventStream } from './event-stream.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { z, ZodError } from 'zod';
import { AppError, agentIdSchema, discussionInputSchema } from './domain.js';
import { DiscussionController } from './controller.js';
import { DiscussionService } from './discussion-service.js';
import { participantSchema, roomInputSchema } from './room-contract.js';
import { indexQuerySchema, managementActionSchema } from './management.js';
import { safeError } from './redaction.js';
import fastifyStatic from '@fastify/static';
import { stat } from 'node:fs/promises';
import { diagnose, codexCatalog, roomProviderStatuses, type EnvironmentStatus } from './environment.js';
import multipart from '@fastify/multipart';
import { attachmentLimits } from './attachment-contract.js';
import { withUpload, prepareAttachments, AttachmentUploadError } from './attachment-upload.js';
import { redact } from './redaction.js';

const idParams = z.object({ id: z.uuid() });
const operationBody = z.object({ operationId: z.uuid() }).strict();
const messageBody = z.object({ messageId: z.uuid(), text: z.string().trim().max(32_000),
  inReplyTo: z.uuid().nullable().default(null),
  recipient: z.union([participantSchema, z.literal('both'), z.literal('all')]).default('both') }).strict();

export function createServer(controller: DiscussionController | DiscussionService, options: { accessToken?: string; disconnectGraceMs?: number;
  webRoot?: string; environment?: () => Promise<EnvironmentStatus>; models?: typeof codexCatalog; testFixture?: boolean; instanceId?: string } = {}) {
  const token = options.accessToken ?? randomBytes(32).toString('hex');
  const server = Fastify({ logger: false, bodyLimit: 128 * 1024, requestTimeout: 30_000 });
  server.register(multipart, { preservePath: true, limits: { files: attachmentLimits.files, fields: 1, parts: attachmentLimits.files + 1,
    fileSize: attachmentLimits.fileBytes, fieldSize: 128 * 1024, fieldNameSize: 100 }, throwFileSizeLimit: false });

  server.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host ?? '';
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(host)) return reply.code(403).send({ error: 'INVALID_HOST' });
    const origin = request.headers.origin;
    if (origin && origin !== `http://${host}`) return reply.code(403).send({ error: 'INVALID_ORIGIN' });
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    reply.header('X-Frame-Options', 'DENY').header('Referrer-Policy', 'no-referrer');
    if (request.url === '/health' || request.url === '/api/session' || request.url === '/' || request.url.startsWith('/assets/') || request.url === '/favicon.svg') return;
    const bearer = request.headers.authorization?.replace(/^Bearer /, '');
    const cookie = request.headers.cookie?.split(';').map((value) => value.trim()).find((value) => value.startsWith('candc_session='))?.slice('candc_session='.length);
    const candidate = bearer ?? cookie ?? '';
    const valid = Buffer.byteLength(candidate) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(candidate), Buffer.from(token));
    if (!valid) return reply.code(401).send({ error: 'UNAUTHORIZED' });
  });

  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof Error && 'code' in error && ['FST_FILES_LIMIT', 'FST_PARTS_LIMIT', 'FST_REQ_FILE_TOO_LARGE'].includes(String(error.code))) return reply.code(413).send({ error: 'ATTACHMENT_SIZE' });
    if (error instanceof AttachmentUploadError) return reply.code(error.statusCode).send({ error: error.code, fileName: redact(error.fileName).slice(0, 240) });
    if (error instanceof ZodError) return reply.code(400).send({ error: 'INVALID_INPUT', message: 'Request does not match the API contract.' });
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: error.code, message: safeError(error) });
    const status = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500 ? error.statusCode : 500;
    return reply.code(status).send({ error: status < 500 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR' });
  });

  server.get('/health', async () => ({ application: 'candc', testFixture: options.testFixture === true, status: 'ok', phase: 2, backend: 'selectable', liveMessagesEnabled: true,
    ...(options.instanceId ? { instanceId: options.instanceId } : {}) }));
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
  server.get('/api/discussion-index', async request => {
    const query = indexQuerySchema.parse(request.query);
    if (controller instanceof DiscussionService) return controller.index(query);
    const all = controller.summaries(), counts = { active: 0, archived: 0, trash: 0 }; for (const s of all) counts[s.folder]++;
    const filtered = controller.summaries(query.q, query.before).filter(s => s.folder === query.folder)
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt) || a.id.localeCompare(b.id));
    const page = Math.min(query.page, Math.max(1, Math.ceil(filtered.length / query.limit)));
    return { items: filtered.slice((page - 1) * query.limit, page * query.limit), total: filtered.length, page, limit: query.limit, counts,
      runningIds: all.filter(s => s.runtime || s.status === 'running').map(s => s.id), pendingDeletions: await controller.deletionIssues() };
  });
  server.post('/api/discussions/:id/management', async request => {
    const { id } = idParams.parse(request.params);
    const body = z.object({ action: managementActionSchema, operationId: z.uuid(), expectedSequence: z.number().int().positive() }).strict().parse(request.body);
    return controller.manage(id, body.action, body.operationId, body.expectedSequence);
  });
  server.delete('/api/discussions/:id', async request => {
    const { id } = idParams.parse(request.params);
    const body = z.object({ operationId: z.uuid(), expectedSequence: z.number().int().positive() }).strict().parse(request.body);
    return controller.permanentDelete(id, body.operationId, body.expectedSequence);
  });
  server.get('/api/discussions/:id/performance', async request => controller.performanceView(idParams.parse(request.params).id));
  server.get('/api/performance/report', async (request, reply) => {
    const { format } = z.object({ format: z.enum(['json', 'markdown']).default('json') }).strict().parse(request.query);
    reply.header('Content-Disposition', `attachment; filename="candc-performance.${format === 'json' ? 'json' : 'md'}"`);
    if (format === 'markdown') reply.type('text/markdown; charset=utf-8');
    return controller.performanceBaseline(format);
  });
  server.get('/api/storage-issues', async () => controller.storageIssues());
  server.post('/api/discussions', async (request, reply) => withUpload(request, async (payload, files) => {
    const body = z.object({ id: z.uuid(), input: z.union([discussionInputSchema, roomInputSchema]) }).strict().parse(payload);
    if (files.length && (body.input.behaviorVersion !== 3 || body.input.kind === 'selection')) throw new AppError('ATTACHMENT_UNSUPPORTED', 'Attachments require a version 3 discussion or debate.', 400);
    if (body.input.behaviorVersion === 3) {
      if (!(controller instanceof DiscussionService)) throw new AppError('BACKEND_UNAVAILABLE', 'Version 3 controller unavailable.');
      return reply.code(201).send(await controller.createRoom(body.id, body.input, undefined, await prepareAttachments(files)));
    }
    return reply.code(201).send(await controller.create(body.id, body.input));
  }));
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
    const attachments = state.behaviorVersion === 3 && controller instanceof DiscussionService ? await controller.rooms.attachmentExport(state.id) : [];
    if (format === 'json') return attachments.length ? { ...state, attachmentContents: attachments } : state;
    reply.type('text/markdown; charset=utf-8');
    return `# ${state.topic}\n\nBackend: ${state.backend}\nStatus: ${state.status}\n\n` +
      state.messages.map((message) => `## ${message.sender} → ${message.recipient} · round ${message.round} · ${message.purpose ?? 'discussion'} · ${message.status}\n\n${message.text}`).join('\n\n') +
      (attachments.length ? '\n\n## Attachments\n\n' + attachments.map(a => `### ${a.name} (${a.id})\n\nMessage: ${a.messageId}; recipient: ${a.recipient}; SHA256: ${a.sha256}; text SHA256: ${a.textSha256}; warnings: ${a.warnings.join(', ')}\n\n${a.text}`).join('\n\n') : '') +
      '\n\n## Evidence\n\n' + state.evidence.map((item) => `- ${item.source} (${item.retrievedAt}, SHA256 ${item.sha256}, truncated=${item.truncated})`).join('\n') +
      (state.behaviorVersion === 3 && state.room.selection ? selectionMarkdown(state.room.selection) : '') +
      (state.behaviorVersion === 3 ? '\n\n## Moderation, topic changes and outcome\n\n```json\n' + JSON.stringify({ commands: state.room.commands, topicHistory: state.room.topicHistory, outcome: state.room.outcome, interimResults: state.room.interimResults, workflow: state.room.workflow }, null, 2) + '\n```' : state.v2 ? '\n\n## Issues and result limits\n\n' + state.v2.issues.map(i => `- ${i.title}: ${i.status}; ${i.result}; unresolved: ${i.unresolved.join('; ')}`).join('\n') +
        '\n\n## Call diagnostics\n\n```json\n' + JSON.stringify(state.v2.calls, null, 2) + '\n```' : '');
  });
  server.post('/api/discussions/:id/pause', async (request) => controller.pause(idParams.parse(request.params).id));
  server.post('/api/discussions/:id/stop', async (request) => controller.stop(idParams.parse(request.params).id));
  server.post('/api/shutdown', async (_request, reply) => {
    reply.send({ stopping: true });
    setImmediate(() => void server.close());
  });
  server.get('/api/discussions/:id/attachments/:attachmentId/:kind', async (request, reply) => {
    const { id, attachmentId, kind } = z.object({ id: z.uuid(), attachmentId: z.uuid(), kind: z.enum(['original', 'text']) }).parse(request.params);
    if (!(controller instanceof DiscussionService)) throw new AppError('NOT_FOUND', 'Attachment not found.', 404);
    const { attachment, bytes } = await controller.rooms.attachment(id, attachmentId, kind);
    if (kind === 'text') return reply.send({ attachment, text: bytes.toString('utf8') });
    reply.header('Content-Disposition', `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(attachment.name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16))}`);
    return reply.type('application/octet-stream').send(bytes);
  });
  server.post('/api/discussions/:id/messages', async (request) => withUpload(request, async (payload, files) => {
    const { id } = idParams.parse(request.params);
    const body = messageBody.parse(payload);
    if (!body.text && !files.length) throw new AppError('INVALID_INPUT', 'A message needs text or an attachment.', 400);
    const state = controller.get(id);
    if (files.length && (state.behaviorVersion !== 3 || state.kind === 'selection')) throw new AppError('ATTACHMENT_UNSUPPORTED', 'Attachments require a version 3 discussion or debate.', 400);
    if (controller instanceof DiscussionService) return controller.send(id, body.messageId, body.text, body.recipient, body.inReplyTo, await prepareAttachments(files));
    const recipient = z.union([agentIdSchema, z.literal('both')]).parse(body.recipient);
    return controller.send(id, body.messageId, body.text, recipient, body.inReplyTo);
  }));
  const closeStreams = registerEventStream(server, controller, options);

  server.addHook('preClose', async () => {
    closeStreams();
    await controller.close();
  });
  return server;
}
