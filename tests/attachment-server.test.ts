import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { DiscussionController } from '../src/controller.js';
import { DiscussionService } from '../src/discussion-service.js';
import { RoomController } from '../src/room-controller.js';
import { DiscussionStore } from '../src/store.js';
import { FakeAdapter } from '../src/adapters/fake.js';
import { RoomFakeAdapter } from '../src/adapters/room-fake.js';
import { roomInputSchema, roomStateSchema } from '../src/room-contract.js';
import { input as legacyInput } from './helpers.js';

const headers = { host: '127.0.0.1:4317', authorization: 'Bearer fixture-token' };
const roomInput = () => roomInputSchema.parse({ behaviorVersion: 3, topic: 'Attachment HTTP fixture', backend: 'fake',
  participants: ['codex', 'claude'].map(provider => ({ id: provider, provider, role: 'speaker', settings: { model: 'fixture', effort: 'medium' } })),
  moderator: null, limits: { maxRounds: 5, maxDurationMs: 30_000, turnTimeoutMs: 2_000, maxModeratorCalls: 20 } });
function multipart(payload: unknown, files: Array<{ name: string; text: string | Buffer }>) {
  const boundary = 'candc-fixture-' + randomUUID(), chunks: Buffer[] = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n`)];
  for (const file of files) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), Buffer.from(file.text), Buffer.from('\r\n'));
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat(chunks) };
}
async function setup() {
  const dir = await mkdtemp(path.resolve('.cache/attachment-http-'));
  const legacy = new DiscussionController(new DiscussionStore(dir), { codex: new FakeAdapter('codex'), claude: new FakeAdapter('claude') });
  const rooms = new RoomController(new DiscussionStore(dir, undefined, roomStateSchema), p => new RoomFakeAdapter(p, undefined, 0));
  const service = new DiscussionService(legacy, rooms); await service.initialize();
  const server = createServer(service, { accessToken: 'fixture-token' });
  return { dir, service, server, cleanup: async () => { await server.close(); await rm(dir, { recursive: true, force: true }); } };
}
describe('attachment HTTP contract', () => {
  it('atomically creates, retries, downloads, exports and adds attachment-only messages', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID(), payload = { id, input: roomInput() }, files = [{ name: '中文.txt', text: 'HTTP fixture body' }];
      const first = await ctx.server.inject({ method: 'POST', url: '/api/discussions', ...multipart(payload, files) });
      expect(first.statusCode, first.body).toBe(201); const state = first.json(), attachment = state.messages[0].attachments[0];
      expect(state.room.calls).toHaveLength(0); expect(first.body).not.toContain('HTTP fixture body');
      const again = await ctx.server.inject({ method: 'POST', url: '/api/discussions', ...multipart(payload, files) });
      expect(again.json().sequence).toBe(state.sequence); expect(again.json().messages[0].attachments[0].id).toBe(attachment.id);
      expect((await ctx.server.inject({ method: 'POST', url: '/api/discussions', ...multipart(payload, [{ name: '中文.txt', text: 'changed' }]) })).statusCode).toBe(409);
      const url = `/api/discussions/${id}/attachments/${attachment.id}`;
      const download = await ctx.server.inject({ url: url + '/original', headers }); expect(download.body).toBe(files[0]!.text);
      expect(download.headers['content-disposition']).toContain("filename*=UTF-8''"); expect(download.headers['content-type']).toContain('application/octet-stream');
      expect((await ctx.server.inject({ url: url + '/text', headers })).json().text).toBe('HTTP fixture body');
      expect((await ctx.server.inject({ url: `/api/discussions/${id}/export?format=json`, headers })).json().attachmentContents[0].text).toBe('HTTP fixture body');
      expect((await ctx.server.inject({ url: `/api/discussions/${id}/export?format=markdown`, headers })).body).toContain('HTTP fixture body');
      const message = { messageId: randomUUID(), text: '', recipient: 'claude' };
      const sent = await ctx.server.inject({ method: 'POST', url: `/api/discussions/${id}/messages`, ...multipart(message, [{ name: 'private.txt', text: 'Private fixture' }]) });
      expect(sent.statusCode, sent.body).toBe(200); expect(sent.json().messages.at(-1)).toMatchObject({ text: '', recipient: 'claude' });
      const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('雙'.repeat(70_000), 'utf16le')]);
      const large = await ctx.server.inject({ method: 'POST', url: `/api/discussions/${id}/messages`, ...multipart({ ...message, messageId: randomUUID() }, [{ name: 'utf16.txt', text: utf16 }]) });
      expect(large.statusCode, large.body).toBe(200); expect(large.json().messages.at(-1).attachments[0].characters).toBe(70_000);
      expect((await ctx.server.inject({ method: 'POST', url: `/api/discussions/${id}/messages`, headers, payload: { messageId: randomUUID(), text: '' } })).statusCode).toBe(400);
    } finally { await ctx.cleanup(); }
  }, 15_000);
  it('enforces authorization, ownership, format/size/count limits and all-or-nothing parsing', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID(); await ctx.service.createRoom(id, roomInput());
      const message = { messageId: randomUUID(), text: 'Read these' }, url = `/api/discussions/${id}/messages`;
      const rejected = await ctx.server.inject({ method: 'POST', url, ...multipart(message, [{ name: 'good.txt', text: 'good' }, { name: 'bad.pdf', text: 'bad' }]) });
      expect(rejected.statusCode).toBe(422); expect(rejected.json()).toMatchObject({ fileName: 'bad.pdf', error: 'ATTACHMENT_INVALID' });
      expect(ctx.service.get(id).messages).toHaveLength(1);
      for (const files of [Array.from({ length: 6 }, (_, i) => ({ name: `${i}.txt`, text: 'text' })), [{ name: 'large.txt', text: Buffer.alloc(10 * 1024 * 1024 + 1, 65) }],
        [1, 2, 3].map(i => ({ name: `${i}.txt`, text: Buffer.alloc(9 * 1024 * 1024, 65) }))]) {
        expect((await ctx.server.inject({ method: 'POST', url, ...multipart(message, files) })).statusCode).toBe(413);
      }
      expect((await ctx.server.inject({ method: 'POST', url, ...multipart(message, [{ name: '../escape.txt', text: 'text' }]) })).json().error).toBe('ATTACHMENT_NAME');
      const result = (await ctx.server.inject({ method: 'POST', url, ...multipart(message, [{ name: 'good.txt', text: '<script>fixture</script>' }]) })).json();
      const a = result.messages.at(-1).attachments[0], attachmentUrl = `/api/discussions/${id}/attachments/${a.id}/text`;
      expect((await ctx.server.inject({ url: attachmentUrl, headers: { host: headers.host } })).statusCode).toBe(401);
      expect((await ctx.server.inject({ url: attachmentUrl, headers: { ...headers, origin: 'https://example.com' } })).statusCode).toBe(403);
      const other = randomUUID(); await ctx.service.createRoom(other, roomInput());
      expect((await ctx.server.inject({ url: `/api/discussions/${other}/attachments/${a.id}/text`, headers })).statusCode).toBe(404);
      expect((await ctx.server.inject({ method: 'POST', url, headers, payload: { ...message, attachments: [a] } })).statusCode).toBe(400);
      expect((await ctx.server.inject({ method: 'POST', url, headers, payload: { text: 'x'.repeat(150_000) } })).statusCode).toBe(413);
      expect((await ctx.server.inject({ method: 'POST', url, headers: { ...headers, 'content-type': 'application/json' }, payload: ' '.repeat(140_000) + '{}' })).statusCode).toBe(413);
    } finally { await ctx.cleanup(); }
  }, 20_000);
  it('preserves JSON-only legacy and rejects legacy/selection attachments', async () => {
    const ctx = await setup();
    try {
      const id = randomUUID();
      expect((await ctx.server.inject({ method: 'POST', url: '/api/discussions', headers, payload: { id, input: legacyInput() } })).statusCode).toBe(201);
      expect((await ctx.server.inject({ method: 'POST', url: `/api/discussions/${id}/messages`, headers, payload: { messageId: randomUUID(), text: 'legacy' } })).statusCode).toBe(200);
      const selection = { ...roomInput(), kind: 'selection', mode: 'conclusion', selection: { version: 1, optionCount: 4 } };
      for (const input of [legacyInput(), selection]) {
        const response = await ctx.server.inject({ method: 'POST', url: '/api/discussions', ...multipart({ id: randomUUID(), input }, [{ name: 'a.txt', text: 'text' }]) });
        expect(response.json().error).toBe('ATTACHMENT_UNSUPPORTED');
      }
      expect((await ctx.server.inject({ method: 'POST', url: `/api/discussions/${id}/messages`, ...multipart({ messageId: randomUUID(), text: '' }, [{ name: 'a.txt', text: 'text' }]) })).json().error).toBe('ATTACHMENT_UNSUPPORTED');
    } finally { await ctx.cleanup(); }
  });
});
