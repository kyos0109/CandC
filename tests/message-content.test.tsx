import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageContent } from '../web/MessageContent.js';

describe('message rendering', () => {
  it('renders Chinese bold beside punctuation, including inline code, without changing the source', () => {
    const text = '**中文結論。**接續說明。 **採用 `demo`。**下一步。';
    const html = renderToStaticMarkup(<MessageContent text={text}/>);
    expect(html).toContain('<strong>中文結論。</strong>接續說明。');
    expect(html).toContain('<strong>採用 <code>demo</code>。</strong>下一步。');
    expect(text).toBe('**中文結論。**接續說明。 **採用 `demo`。**下一步。');
  });
  it('retains escaped stars and code literally', () => {
    const html = renderToStaticMarkup(<MessageContent text={'\\**中文結論。\\**接續說明。\n\n`**程式。**文字`\n\n**未配對'}/>);
    expect(html).not.toContain('<strong>');
    expect(html).toContain('**中文結論。**接續說明。');
    expect(html).toContain('<code>**程式。**文字</code>');
    expect(html).toContain('**未配對');
  });
  it('renders tables, task lists, deletion and fenced code while retaining all content', () => {
    const text = '| Choice | Cost |\n| --- | --- |\n| Reliable | 100 |\n\n- [x] Checked\n\n~~Previous~~\n\n```ts\nconst value = "<tag>";\n```\n\nLast paragraph.';
    const html = renderToStaticMarkup(<MessageContent text={text}/>);
    expect(html).toContain('<table>');
    expect(html).toContain('<td>Reliable</td>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<del>Previous</del>');
    expect(html).toContain('language-ts');
    expect(html).toContain('&lt;tag&gt;');
    expect(html).toContain('Last paragraph.');
  });
  it('shows user input literally, including line breaks, paths and Markdown symbols', () => {
    const html = renderToStaticMarkup(<MessageContent plain text={'C:\\temp\\log\n*Keep this*\n| a | b |'}/>);
    expect(html).toContain('C:\\temp\\log\n*Keep this*\n| a | b |');
    expect(html).not.toContain('<em>');
    expect(html).not.toContain('<table>');
  });
  it('does not execute HTML or allow unsafe links from model output', () => {
    const html = renderToStaticMarkup(<MessageContent text={'<script>alert(1)</script>\n\n[unsafe](javascript:alert%281%29)\n\n![external](https://example.com/image.png)'}/>);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<img');
    expect(html).toContain('external');
  });
});
