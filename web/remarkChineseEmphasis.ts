// CommonMark can leave Chinese emphasis literal when punctuation touches its closing
// delimiter. Repair only leftover, balanced pairs in inline text after normal parsing.
// Code nodes and explicitly escaped delimiters retain their original meaning.
type InlineNode = { type: string; value?: string; children?: InlineNode[]; position?: { start: { offset?: number }; end: { offset?: number } } };
export function remarkChineseEmphasis() {
  return (root: InlineNode, file: { value: unknown }) => {
    const source = String(file.value);
    const visit = (parent: InlineNode) => {
      if (!parent.children || ['code', 'inlineCode', 'strong'].includes(parent.type)) return;
      parent.children.forEach(visit);
      if (!['paragraph', 'heading', 'tableCell'].includes(parent.type)) return;
      const tokens: (InlineNode | 'delimiter')[] = [];
      for (const node of parent.children) {
        const raw = source.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);
        if (node.type !== 'text' || !node.value?.includes('**') || raw.includes('\\**')) { tokens.push(node); continue; }
        const fragments = node.value.split('**');
        fragments.forEach((value, index) => {
          if (index) tokens.push('delimiter');
          if (value) tokens.push({ type: 'text', value });
        });
      }
      const result: InlineNode[] = [];
      for (let index = 0; index < tokens.length; index++) {
        const node = tokens[index]!;
        if (node !== 'delimiter') { result.push(node); continue; }
        const end = tokens.indexOf('delimiter', index + 1);
        const content = end < 0 ? [] : tokens.slice(index + 1, end).filter((item): item is InlineNode => item !== 'delimiter');
        // Restrict the tolerance to CJK content so other Markdown syntax stays standard.
        const value = content.map(item => item.value ?? '').join('');
        if (content.length && /[\u3400-\u9fff]/.test(value) && value.trim() === value) {
          result.push({ type: 'strong', children: content }); index = end;
        } else result.push({ type: 'text', value: '**' });
      }
      parent.children = result;
    };
    visit(root);
  };
}
