import type { Message } from '../src/domain.js';
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
    message.text.replace(/^\[FAKE (?:codex|claude)\] round \d+:\s*/i, '').replace(/^### 第 \d+ 輪$/gm, '### 觀點分析') : message.text;
  const actions = <div className="actions">
    {canReply && message.status === 'completed' && <button onClick={() => draftReply(message.id)}><span aria-hidden="true">↩</span>引用追問</button>}
    {canReply && message.status === 'completed' && message.sender !== 'user' && message.recipient === 'both' && <button onClick={() => draftReply(message.id, true)}>請另一方檢查</button>}
    <details className="message-more"><summary aria-label="訊息資訊">···</summary><p>回應標註：{message.annotation === 'valid' ? '有回應標註' : message.annotation === 'invalid' ? '回應標註不可用' : '未標註'} · {message.status}</p></details>
    {message.status === 'completed' && message.sender !== 'user' && <span className="message-saved">已保存</span>}
  </div>;
  return <article id={`message-${message.id}`} tabIndex={-1} className={`message ${message.sender}`}>
    <Avatar participant={author}/>
    <div className="message-main">
      <div className="message-meta"><strong>{author.name}</strong>{author.role && <span className="message-role">{author.role}</span>}
        {message.sender === 'user' && <span>{message.recipient === 'both' ? '傳給雙方' : `傳給 ${message.recipient}`}</span>}
        <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
        {message.purpose === 'roles' && <span className="message-role">立場提議</span>}{message.purpose === 'summary' && <span className="message-role">結論整理</span>}
        {message.status !== 'completed' && <span className="warning-text">{message.status === 'cancelled' ? '已中止 · 部分內容' : '未確認完成 · 部分內容'}</span>}
      </div>
      <div className="message-body">
        {target && <button className="source-jump" aria-label="回應來源" onClick={() => jump(target.id)}><b className={target.sender}>↳ {identity(target.sender).name}</b><span>{target.text.slice(0, 72)}</span></button>}
        <MessageContent readingMode={readingMode} plain={message.sender === 'user'} text={text || '此回覆沒有收到可顯示的內容。'}/>
        {message.sender !== 'user' && actions}
      </div>
      {message.sender === 'user' && actions}
    </div>
  </article>;
}
