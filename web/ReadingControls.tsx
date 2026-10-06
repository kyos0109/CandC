import { translate, useLocale, setLocale, type Locale } from './i18n.js';
import { useEffect, useState } from 'react';

export function ReadingControls({ open, onToggle, settings = false, readingMode, setReadingMode }: { open?: boolean; onToggle?: () => void; settings?: boolean; readingMode: 'highlights' | 'full'; setReadingMode: (mode: 'highlights' | 'full') => void }) {
  const locale = useLocale();
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
  const [density, setDensity] = useState(() => localStorage.getItem('candc-density') === 'compact' ? 'compact' : 'comfortable');
  useEffect(() => {
    document.documentElement.dataset.density = density;
    localStorage.setItem('candc-density', density);
  }, [density]);
  if (!settings) return <button className="icon-button" aria-label={translate("閱讀設定")} aria-expanded={open} onClick={onToggle}>Aa</button>;
  return <div className="reading-controls" aria-label={translate("閱讀設定")}>
    <label className="inline">{locale === 'en' ? 'Language' : '語言'}<select aria-label="Language / 語言" value={locale} onChange={event => setLocale(event.target.value as Locale)}><option value="zh-TW">繁體中文</option><option value="en">English</option></select></label>
    <label className="inline">{translate("閱讀")}<select aria-label={translate("閱讀模式")} value={readingMode} onChange={e => setReadingMode(e.target.value as 'highlights' | 'full')}><option value="highlights">{translate("重點閱讀")}</option><option value="full">{translate("完整閱讀")}</option></select></label>
    <label className="inline">{translate("字級")}<select aria-label={translate("對話字級")} value={fontSize} onChange={event => setFontSize(event.target.value)}><option value="14">{translate("小 · 14")}</option><option value="16">{translate("中 · 16")}</option><option value="18">{translate("大 · 18")}</option></select></label>
    <label className="inline">{translate("密度")}<select aria-label={translate("對話密度")} value={density} onChange={event => setDensity(event.target.value)}><option value="comfortable">{translate("舒適")}</option><option value="compact">{translate("緊湊")}</option></select></label>
    <button onClick={() => setDark(!dark)} aria-label={translate("深色模式")} aria-pressed={dark}>{dark ? translate("☀ 淺色模式") : translate("☾ 深色模式")}</button>
  </div>;
}
