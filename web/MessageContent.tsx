import { translate } from './i18n.js';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkChineseEmphasis } from './remarkChineseEmphasis.js';
import { useEffect, useState } from 'react';
import { readingSegments } from './readingSegments.js';

export function MessageContent({ text, plain = false, readingMode = 'full' }: { text: string; plain?: boolean; readingMode?: 'highlights' | 'full' }) {
  const [open, setOpen] = useState(readingMode === 'full');
  useEffect(() => { setOpen(readingMode === 'full'); }, [readingMode]);
  if (plain) return <div className="user-text">{text}</div>;
  const sections = readingSegments(text);
  if (sections) return <div className="public-sections"><MarkdownBody text={sections.keyPoints}/><details className="public-details" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>{open ? translate("收合細節") : translate("展開細節")}</summary><MarkdownBody text={sections.details}/></details></div>;
  return <MarkdownBody text={text}/>;
}
function MarkdownBody({ text }: { text: string }) {
  return <div className="markdown"><Markdown remarkPlugins={[remarkGfm, remarkChineseEmphasis]} components={{
    a: ({ children, href }) => <a href={href} target={href?.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a>,
    img: ({ src, alt }) => <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noopener noreferrer">{alt || translate("外部圖片")}</a>,
    table: ({ children }) => <div className="table-scroll" tabIndex={0} role="region" aria-label={translate("表格內容")}><table>{children}</table></div>,
  }}>{text}</Markdown></div>;
}
