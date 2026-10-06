import { translate, dateLocale } from './i18n.js';
import type { Message } from '../src/domain.js';
import { plainSnippet } from './snippet.js';
import { MessageContent } from './MessageContent.js';
import { Avatar, ProcessNotice, type Participant } from './Participants.js';

export function ConversationMessage({ message, messages, identity, demonstration, readingMode, canReply, jump, draftReply }: {
  message: Message & { presentation?: string }; messages: Message[]; identity: (id: string) => Participant;
  demonstration: boolean; readingMode: 'highlights' | 'full'; canReply: boolean;
  jump: (id: string) => void; draftReply: (id: string, peerCheck?: boolean) => void;
}) {
  if (message.presentation === 'process') return <ProcessNotice>{message.text}</ProcessNotice>;
  const author = identity(message.sender);
  const targetId = message.sender === 'user' ? message.inReplyTo : message.responseTarget;
  const recipient = message.sender === 'user' ? message.recipient : message.sender;
  // A linked reference must exist, be complete and be eligible for this message's scope.
  const target = messages.find(m => m.id === targetId && m.status === 'completed' &&
    (m.recipient === 'both' || recipient !== 'both' && (m.recipient === recipient || m.sender === recipient)));
  const text = demonstration && message.sender !== 'user' ?
    message.text.replace(/^\[FAKE (?:codex|claude)\] round \d+:\s*/i, '').replace(/^### 第 \d+ 輪$/gm, translate("### 觀點分析")) : message.text;
  const actions = <div className="actions">
    {canReply && message.status === 'completed' && <button onClick={() => draftReply(message.id)}><span aria-hidden="true">↩</span>{translate("引用追問")}</button>}
    {canReply && message.status === 'completed' && message.sender !== 'user' && message.recipient === 'both' && <button onClick={() => draftReply(message.id, true)}>{translate("請另一方檢查")}</button>}
    <details className="message-more"><summary aria-label={translate("訊息資訊")}>···</summary><p>{translate("回應標註：")}{message.annotation === 'valid' ? translate("有回應標註") : message.annotation === 'invalid' ? translate("回應標註不可用") : translate("未標註")} · {message.status}</p></details>
    {message.status === 'completed' && message.sender !== 'user' && <span className="message-saved">{translate("已保存")}</span>}
  </div>;
  return <article id={`message-${message.id}`} tabIndex={-1} className={`message ${message.sender}`}>
    <Avatar participant={author}/>
    <div className="message-main">
      <div className="message-meta"><strong>{author.name}</strong>{author.role && <span className="message-role">{author.role}</span>}
        {message.sender === 'user' && <span>{message.recipient === 'both' ? translate("傳給雙方") : translate("傳給 {0}", message.recipient)}</span>}
        <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
        {message.purpose === 'roles' && <span className="message-role">{translate("立場提議")}</span>}{message.purpose === 'summary' && <span className="message-role">{translate("結論整理")}</span>}
        {message.status !== 'completed' && <span className="warning-text">{message.status === 'cancelled' ? translate("已中止 · 部分內容") : translate("未確認完成 · 部分內容")}</span>}
      </div>
      <div className="message-body">
        {target && <button className="source-jump" aria-label={translate("回應來源")} onClick={() => jump(target.id)}><b className={target.sender}>↳ {identity(target.sender).name}</b><span>{plainSnippet(target.text)}</span></button>}
        <MessageContent readingMode={readingMode} plain={message.sender === 'user'} text={text || translate("此回覆沒有收到可顯示的內容。")}/>
        {message.sender !== 'user' && actions}
      </div>
      {message.sender === 'user' && actions}
    </div>
  </article>;
}
