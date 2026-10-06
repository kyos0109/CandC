/** A one-line plain-text preview of a Markdown message, for the quote shown above a reply. */
export function plainSnippet(markdown: string, limit = 72): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')                         // fenced code
    .replace(/`([^`]*)`/g, '$1')                              // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                     // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')                  // links keep their text
    .replace(/^\s{0,3}(?:#{1,6}|[-*+]|\d+[.)]|>)\s+/gm, '')   // heading, bullet and quote markers
    .replace(/\*\*|__|~~/g, '')                               // bold and strike-through markers
    .replace(/(^|\s)[*_]+(?=\S)|(?<=\S)[*_]+(?=\s|$)/g, '$1') // emphasis at word edges only, so snake_case survives
    .replace(/\s+/g, ' ').trim().slice(0, limit);
}
