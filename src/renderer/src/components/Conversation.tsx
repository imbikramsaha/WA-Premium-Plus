import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChatMessage, ChatSummary, MessageAck } from '../../../shared/types';
import { errorMessage, formatDay, formatId, formatTime, kindLabel } from '../format';
import { Avatar } from './Avatar';
import { ClockIcon, SendIcon } from './Icons';

function upsertMessage(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = list.findIndex((m) => m.id === message.id);
  if (index >= 0) {
    const next = list.slice();
    next[index] = { ...list[index], ...message };
    return next;
  }
  return [...list, message].sort((a, b) => a.timestamp - b.timestamp);
}

function Ack({ ack }: { ack?: MessageAck }) {
  if (!ack || ack === 'pending')
    return (
      <span className="ack" title="Sending">
        <ClockIcon size={12} />
      </span>
    );
  if (ack === 'error') return <span className="ack error" title="Not sent">!</span>;
  if (ack === 'sent') return <span className="ack" title="Sent">✓</span>;
  const read = ack === 'read' || ack === 'played';
  return (
    <span className={`ack${read ? ' read' : ''}`} title={read ? 'Read' : 'Delivered'}>
      ✓✓
    </span>
  );
}

const userIsLooking = () => document.visibilityState === 'visible' && document.hasFocus();

export function Conversation({
  chat,
  connected,
  onSchedule,
}: {
  chat: ChatSummary;
  connected: boolean;
  /** Opens the schedule dialog for this chat with the composer's text. */
  onSchedule: (body: string, clearComposer: () => void) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    setMessages([]);
    void window.wapp.listMessages(chat.id).then((list) => active && setMessages(list));
    if (userIsLooking()) void window.wapp.markRead(chat.id);

    const markReadIfLooking = () => {
      if (userIsLooking()) void window.wapp.markRead(chat.id);
    };
    const off = window.wapp.onEvent((event) => {
      if (event.type === 'message' && event.message.chatId === chat.id) {
        setMessages((prev) => upsertMessage(prev, event.message));
        if (!event.message.fromMe) markReadIfLooking();
      } else if (event.type === 'ack' && event.chatId === chat.id) {
        setMessages((prev) => prev.map((m) => (m.id === event.messageId ? { ...m, ack: event.ack } : m)));
      }
    });
    window.addEventListener('focus', markReadIfLooking);
    inputRef.current?.focus();
    return () => {
      active = false;
      off();
      window.removeEventListener('focus', markReadIfLooking);
    };
  }, [chat.id]);

  // Keep the newest message in view.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Grow the composer with its content, up to a limit.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      await window.wapp.sendText(chat.id, body);
      setText('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="conversation">
      <header className="conversation-header">
        <Avatar id={chat.id} name={chat.name} size={40} />
        <div className="conversation-title">
          <strong>{chat.name}</strong>
          <span>{chat.isGroup ? 'Group' : formatId(chat.id)}</span>
        </div>
        <button className="button ghost" onClick={() => onSchedule(text, () => setText(''))}>
          <ClockIcon size={18} />
          Schedule
        </button>
      </header>

      <div className="messages" ref={listRef}>
        {messages.length === 0 && <p className="messages-empty">No messages on this computer yet.</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || formatDay(prev.timestamp) !== formatDay(m.timestamp);
          return (
            <Fragment key={m.id}>
              {newDay && <div className="day-separator">{formatDay(m.timestamp)}</div>}
              <div className={`bubble-row ${m.fromMe ? 'out' : 'in'}`}>
                <div className="bubble">
                  {chat.isGroup && !m.fromMe && (
                    <div className="bubble-author">{m.authorName || formatId(m.author)}</div>
                  )}
                  {m.kind !== 'text' && <div className="bubble-kind">{kindLabel(m.kind)}</div>}
                  {m.body && <div className="bubble-text">{m.body}</div>}
                  <div className="bubble-meta">
                    {formatTime(m.timestamp)}
                    {m.fromMe && <Ack ack={m.ack} />}
                  </div>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>

      {error && <div className="composer-error">{error}</div>}
      <footer className="composer">
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={connected ? 'Type a message' : 'Waiting for connection… you can still schedule'}
        />
        <button
          className="icon-button"
          title="Schedule this message"
          onClick={() => onSchedule(text, () => setText(''))}
        >
          <ClockIcon />
        </button>
        <button
          className="icon-button send"
          title="Send"
          onClick={() => void send()}
          disabled={!connected || sending || !text.trim()}
        >
          <SendIcon />
        </button>
      </footer>
    </div>
  );
}
