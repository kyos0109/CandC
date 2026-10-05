// A deliberate, standalone public Details heading is the only supported reading boundary.
// Fenced code, quoted headings, tables and ordinary prose never become inferred summaries.
export function readingSegments(text: string): { keyPoints: string; details: string } | null {
  let fence: { character: string; length: number } | null = null, offset = 0;
  const boundaries: number[] = [];
  for (const line of text.split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (match) {
      const marker = match[1]!;
      if (!fence) fence = { character: marker[0]!, length: marker.length };
      else if (fence.character === marker[0] && marker.length >= fence.length && !match[2]!.trim()) fence = null;
    } else if (!fence && /^## (?:Details|細節|詳細說明)\s*$/.test(line)) boundaries.push(offset);
    offset += line.length + 1;
  }
  if (boundaries.length !== 1 || !text.slice(0, boundaries[0]).trim() || !text.slice(boundaries[0]!).replace(/^## [^\n]+/, '').trim()) return null;
  return { keyPoints: text.slice(0, boundaries[0]!).trimEnd(), details: text.slice(boundaries[0]!) };
}
