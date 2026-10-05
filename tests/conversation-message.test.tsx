import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConversationMessage } from '../web/ConversationMessage.js';
import { participantsFromAgents } from '../web/Participants.js';
import type { Message } from '../src/domain.js';
const base: Message = { id: 'fixture', sender: 'codex', recipient: 'both', text: 'Public answer.', round: 1,
  inReplyTo: null, responseTarget: 'source', status: 'completed', createdAt: '2026-10-03T12:00:00.000Z' };
const source: Message = { ...base, id: 'source', sender: 'user', responseTarget: null, text: 'Source requirement.' };
const identity = (id: string) => ({ id, name: id, symbol: id.slice(0, 1) });
function render(message: Message, messages: Message[]) { return renderToStaticMarkup(<ConversationMessage message={message} messages={messages} identity={identity} demonstration={false} readingMode="highlights" canReply jump={() => {}} draftReply={() => {}}/>); }
describe('eligible public conversation references', () => {
  it('never links absent, incomplete or another recipient\'s private source', () => {
    for (const sources of [[], [{ ...source, status: 'indeterminate' as const }], [{ ...source, recipient: 'claude' as const }]]) expect(render(base, sources)).not.toContain('source-jump');
    expect(render(base, [source])).toContain('source-jump');
    expect(render({ ...base, sender: 'user', inReplyTo: source.id }, [{ ...source, sender: 'claude', recipient: 'claude' }])).not.toContain('source-jump');
  });
  it('retains unknown annotations without presenting completion and excludes partial output from reply actions', () => {
    const html = render({ ...base, status: 'cancelled' }, [source]);
    expect(html).toContain('部分內容'); expect(html).toContain('未標註'); expect(html).not.toContain('已保存'); expect(html).not.toContain('引用追問');
  });
  it('renders future fixture identities without changing backend provider enums', () => {
    const participants = participantsFromAgents({ codex: { model: 'fixture', effort: 'low' }, host: { model: 'presentation-only', effort: 'fixture', name: '主持人', role: '主持', symbol: 'H' } });
    expect(participants.map(p => p.name)).toEqual(['你', 'Codex', '主持人']); expect(participants[2]!.role).toBe('主持');
  });
});
