import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { fetchPublicPage } from '../src/research.js';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('node:https', () => ({ request: vi.fn() }));
afterEach(() => vi.resetAllMocks());
describe('public page successful fetch', () => {
  it.each([true, false])('returns pinned addresses in the lookup format for all=%s', async all => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    vi.mocked(request).mockImplementation(((_url: unknown, options: any, respond: any) => {
      const req = new EventEmitter() as any;
      req.end = () => {
        options.lookup('example.com', { all }, (error: unknown, address: unknown, family: unknown) => {
          expect(error).toBeNull();
          expect(address).toEqual(all ? [{ address: '93.184.216.34', family: 4 }] : '93.184.216.34');
          if (!all) expect(family).toBe(4);
        });
        const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'text/html' } });
        respond(response);
        response.emit('data', Buffer.from('<p>Verified fixture</p>'));
        response.emit('end');
        req.emit('close');
      };
      return req;
    }) as typeof request);
    expect(await fetchPublicPage('https://example.com')).toMatchObject({ text: 'Verified fixture', source: 'https://example.com/' });
  });
});
