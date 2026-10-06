import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DiscussionController } from './controller.js';
import type { DiscussionService } from './discussion-service.js';

const idParams = z.object({ id: z.uuid() });

/** Ordered durable replay and bounded live updates share one authenticated transport. */
export function registerEventStream(server: FastifyInstance, controller: DiscussionController | DiscussionService, options: { disconnectGraceMs?: number }) {
  const subscribers = new Map<string, number>();
  const disconnectTimers = new Map<string, NodeJS.Timeout>();
  const responses = new Set<import('node:http').ServerResponse>();
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
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(name, typeof value === 'string' || typeof value === 'number' ? value : [...value]);
    }
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

  return () => {
    for (const response of responses) response.end();
    for (const timer of disconnectTimers.values()) clearTimeout(timer);
  };
}
