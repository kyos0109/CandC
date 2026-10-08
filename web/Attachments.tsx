import { useRef, useState } from 'react';
import { attachmentAccept, attachmentLimits, type Attachment } from '../src/attachment-contract.js';
import { api } from './api.js';
import { translate } from './i18n.js';

export function AttachmentPicker({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null), [error, setError] = useState('');
  const add = (incoming: File[]) => {
    if (disabled) return;
    const next = [...files, ...incoming];
    if (next.length > attachmentLimits.files || next.some(f => !f.size || f.size > attachmentLimits.fileBytes) || next.reduce((n, f) => n + f.size, 0) > attachmentLimits.totalBytes) {
      setError(translate("最多 5 個檔案，單檔 10 MiB、合計 25 MiB；不可上傳空檔。")); return;
    }
    if (incoming.some(f => !attachmentAccept.split(',').some(ext => f.name.toLowerCase().endsWith(ext)))) { setError(translate("不支援此檔案格式。")); return; }
    setError(''); onChange(next);
  };
  return <div className="attachment-picker" data-has-attachments={files.length > 0} onDragOver={e => { e.preventDefault(); }} onDrop={e => { e.preventDefault(); add(Array.from(e.dataTransfer.files)); }}>
    <input ref={input} type="file" multiple accept={attachmentAccept} aria-label={translate("新增附件")} disabled={disabled} hidden onChange={e => { add(Array.from(e.target.files ?? [])); e.target.value = ''; }}/>
    <div className="attachment-picker-heading"><button type="button" disabled={disabled} onClick={() => input.current?.click()}>{translate("新增附件")}</button><small>{translate("或拖曳檔案至此 · 最多 5 個")}</small></div>
    <small>{translate("支援文字、程式碼、PDF、DOCX、XLSX；僅擷取文字，不讀取圖片、圖表或掃描內容。")}</small>
    {files.length > 0 && <ul>{files.map((file, index) => <li key={index}><span>{file.name}</span><small>{(file.size / 1024).toFixed(1)} KiB</small><button type="button" disabled={disabled} aria-label={translate("移除附件 {0}", file.name)} onClick={() => { setError(''); onChange(files.filter((_, i) => i !== index)); }}>×</button></li>)}</ul>}
    {disabled && files.length > 0 && <p role="status">{translate("正在上傳、解析並保存附件…")}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
function AttachmentCard({ attachment, discussionId }: { attachment: Attachment; discussionId: string }) {
  const [open, setOpen] = useState(false), [text, setText] = useState<string | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const base = `/api/discussions/${discussionId}/attachments/${attachment.id}`;
  const show = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true); if (text !== null) return;
    setLoading(true); setError('');
    try { setText((await api<{ text: string }>(base + '/text')).text); }
    catch (e) { setError(e instanceof Error ? e.message : translate("操作失敗。")); }
    finally { setLoading(false); }
  };
  return <div className="attachment-card"><div className="attachment-card-heading"><strong>{attachment.name}</strong><small>{translate("已保存")} · {(attachment.bytes / 1024).toFixed(1)} KiB</small></div>
    <div className="attachment-actions"><a href={base + '/original'} download>{translate("下載原檔")}</a><button type="button" disabled={loading} aria-expanded={open} onClick={() => void show()}>{translate("提供給 AI 的文字")}</button></div>
    {attachment.warnings.includes('text-only') && <small>{translate("僅擷取文字；圖片、圖表與掃描內容未解析。")}</small>}
    {attachment.warnings.includes('redacted') && <small>{translate("擷取文字已套用秘密遮罩；下載原檔保留原始內容。")}</small>}
    {open && <div>{loading ? <p role="status">{translate("載入附件中…")}</p> : error ? <p role="alert">{error}</p> : <pre className="attachment-text">{text}</pre>}</div>}
  </div>;
}
export function AttachmentCards({ attachments, discussionId }: { attachments: Attachment[]; discussionId: string }) {
  return <div className="attachment-cards">{attachments.map(a => <AttachmentCard key={a.id} attachment={a} discussionId={discussionId}/>)}</div>;
}
