import { describe, expect, it } from 'vitest';
import { plainSnippet } from '../web/snippet.js';

describe('quote preview of a Markdown message', () => {
  it('drops the Markdown markers instead of showing them', () => {
    expect(plainSnippet('**短期不建議自建。** 主要原因有三個：\n\n- 維運\n- 延遲')).toBe('短期不建議自建。 主要原因有三個： 維運 延遲');
    expect(plainSnippet('## 標題\n> 引用\n1. 第一點')).toBe('標題 引用 第一點');
  });
  it('keeps the text of links and inline code and skips code blocks and images', () => {
    expect(plainSnippet('見 [文件](https://example.invalid/a) 與 `max_tokens`')).toBe('見 文件 與 max_tokens');
    expect(plainSnippet('前\n```ts\nconst a = 1;\n```\n後 ![圖](x.png)')).toBe('前 後');
  });
  it('keeps underscores and asterisks that are part of words', () => {
    expect(plainSnippet('呼叫 snake_case_name 與 a*b 的結果')).toBe('呼叫 snake_case_name 與 a*b 的結果');
    expect(plainSnippet('這是 *重點* 與 _強調_')).toBe('這是 重點 與 強調');
  });
  it('limits the length after cleaning', () => {
    expect(plainSnippet('**' + 'a'.repeat(100) + '**', 10)).toBe('a'.repeat(10));
  });
});
