import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageContent } from '../web/MessageContent.js';
import { readingSegments } from '../web/readingSegments.js';
describe('public reading sections', () => {
  it.each(['Short answer.', 'A'.repeat(20_000), '## Details\nNo opening.', 'Opening.\n> ## Details\nQuoted.', 'Opening\n```md\n## Details\ncode\n```', 'Opening\n    ## Details\n    indented', 'Opening\n## Details\nOne\n## Details\nTwo'])('falls back to unchanged full text without a reliable boundary', text => {
    expect(readingSegments(text)).toBeNull();
    expect(renderToStaticMarkup(<MessageContent text={text} readingMode="highlights"/>)).not.toContain('<summary>');
  });
  it('preserves full details, tables, code and source links in both modes without altering content', () => {
    const text = 'Main conclusion; material limits.\n\n## Details\n\n|A|B|\n|-|-|\n|one|two|\n\n```ts\nconst x = 1;\n```\n\n[source](https://example.com)';
    expect(readingSegments(text)?.keyPoints).toBe('Main conclusion; material limits.');
    for (const mode of ['highlights', 'full'] as const) {
      const html = renderToStaticMarkup(<MessageContent text={text} readingMode={mode}/>);
      expect(html).toContain('<table>'); expect(html).toContain('const x = 1;'); expect(html).toContain('https://example.com');
      expect(html.includes('<details class="public-details" open=""')).toBe(mode === 'full');
    }
    expect(text).toContain('Main conclusion; material limits.');
  });
  it('retains literal user headings and headings in chunked code', () => {
    const text = 'User\n## Details\nKeep everything';
    expect(renderToStaticMarkup(<MessageContent text={text} plain readingMode="highlights"/>)).not.toContain('<details');
    const chunks = 'Opening\n~~~ts\n## Details\ncode\n~~~';
    for (let length = 0; length <= chunks.length; length++) expect(readingSegments(chunks.slice(0, length))).toBeNull();
  });
});
