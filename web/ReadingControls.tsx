import { useEffect, useState } from 'react';

export function ReadingControls({ open, onToggle, settings = false, readingMode, setReadingMode }: { open?: boolean; onToggle?: () => void; settings?: boolean; readingMode: 'highlights' | 'full'; setReadingMode: (mode: 'highlights' | 'full') => void }) {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('candc-font-size') ?? '16';
    return ['14', '16', '18'].includes(saved) ? saved : '16';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('candc-theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => {
    const size = ['14', '16', '18'].includes(fontSize) ? fontSize : '16';
    document.documentElement.style.setProperty('--reading-size', `${size}px`);
    localStorage.setItem('candc-font-size', size);
  }, [fontSize]);
  if (!settings) return <button className="icon-button" aria-label="閱讀設定" aria-expanded={open} onClick={onToggle}>Aa</button>;
  return <div className="reading-controls" aria-label="閱讀設定">
    <label className="inline">閱讀<select aria-label="閱讀模式" value={readingMode} onChange={e => setReadingMode(e.target.value as 'highlights' | 'full')}><option value="highlights">重點閱讀</option><option value="full">完整閱讀</option></select></label>
    <label className="inline">字級<select aria-label="對話字級" value={fontSize} onChange={event => setFontSize(event.target.value)}><option value="14">小 · 14</option><option value="16">中 · 16</option><option value="18">大 · 18</option></select></label>
    <button onClick={() => setDark(!dark)} aria-label="深色模式" aria-pressed={dark}>{dark ? '☀ 淺色模式' : '☾ 深色模式'}</button>
  </div>;
}
