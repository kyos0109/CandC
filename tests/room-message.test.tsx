import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RoomMessage as SavedMessage } from '../src/room-contract.js';
import { RoomMessage } from '../web/RoomParts.js';
import { providerSeat, userSeat } from '../web/seats.js';

const seats = {
  user: userSeat,
  codex: { ...providerSeat('codex'), name: 'Cost reviewer' },
  'codex-2': { ...providerSeat('codex'), id: 'codex-2', name: 'Safety reviewer', alt: true },
};
const base: SavedMessage = {
  id: 'reply', sender: 'codex-2', recipient: 'all', text: 'Saved answer.', round: 1,
  inReplyTo: null, status: 'completed', createdAt: '2026-10-06T00:00:00.000Z',
  purpose: 'discussion', taskVersion: 1,
};
const source: SavedMessage = { ...base, id: 'source', sender: 'user', text: '**Source** requirement.' };
function render(message: SavedMessage, messages: SavedMessage[] = [], canReply = true) {
  return renderToStaticMarkup(<RoomMessage message={message} seats={seats} messages={messages}
    demo={false} proposalId={null} readingMode="full" canReply={canReply} onReply={() => {}} jump={() => {}}/>);
}

describe('saved room message presentation', () => {
  it('keeps repeated-provider seats distinct and labels the private recipient by seat', () => {
    const html = render({ ...base, recipient: 'codex' });
    expect(html).toContain('prov-codex seat-alt');
    expect(html).toContain('<strong>Safety reviewer</strong>');
    expect(html).toContain('private-tag');
    expect(html).toContain('Cost reviewer');
    expect(render({ ...base, sender: 'codex' })).not.toContain('seat-alt');
    expect(render(base)).not.toContain('private-tag');
  });

  it('links only saved completed sources and renders their preview as plain text', () => {
    const reply = { ...base, inReplyTo: source.id };
    const html = render(reply, [source]);
    expect(html).toContain('source-jump');
    expect(html).toContain('Source requirement.');
    expect(html).not.toContain('**Source**');
    for (const status of ['cancelled', 'indeterminate'] as const) {
      expect(render(reply, [{ ...source, status }])).not.toContain('source-jump');
    }
    expect(render(reply)).not.toContain('source-jump');
  });

  it.each(['cancelled', 'indeterminate'] as const)('marks %s text as incomplete and preserves its content', status => {
    const html = render({ ...base, status }, [], false);
    expect(html).toContain('cancelled');
    expect(html).toContain('Saved answer.');
    expect(html).toContain('部分文字已保存，不作為完成回答或證據。');
    expect(html).toContain('<button disabled=""');
    expect(render({ ...base, status, text: '', interruptedBy: 'moderator' }, [], false))
      .toContain('主持人已中止發言');
    expect(render(base)).not.toContain('notice warning');
  });

  it('preserves user text literally without treating it as Markdown or executable HTML', () => {
    const html = render({ ...base, sender: 'user', text: '**literal** <script>alert(1)</script>' });
    expect(html).toContain('user-text');
    expect(html).toContain('**literal** &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('class="clip');
    expect(html).not.toContain('message-role');
  });
});
