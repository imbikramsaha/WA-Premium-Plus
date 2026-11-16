import { Fragment, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import type { ChatMessage, ChatSummary, MessageAck } from '../../../shared/types';
import { formatDay, formatId, formatTime, kindLabel } from '../format';
import { Avatar } from './Avatar';
import { Composer, type ComposerHandle } from './Composer';
import { GroupInfoPanel } from './GroupInfoPanel';
import { ClockIcon, InfoIcon, PhoneIcon, VideoIcon } from './Icons';
import { MediaView } from './MediaView';

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
  if (ack === 'error')
    return (
      <span className="ack error" title="Not sent">
        !
      </span>
    );
  if (ack === 'sent')
    return (
      <span className="ack" title="Sent">
        ✓
      </span>
    );
  const read = ack === 'read' || ack === 'played';
  return (
    <span className={`ack${read ? ' read' : ''}`} title={read ? 'Read' : 'Delivered'}>
      ✓✓
    </span>
  );
}

const MEDIA_KINDS = new Set(['image', 'video', 'audio', 'document', 'sticker']);
const userIsLooking = () => document.visibilityState === 'visible' && document.hasFocus();

export function Conversation({
  chat,
  connected,
  onSchedule,
  onOpenImage,
  onCall,
}: {
  chat: ChatSummary;
  connected: boolean;
  onSchedule: (body: string, attachmentPath: string | undefined, clearComposer: () => void) => void;
  onOpenImage: (url: string) => void;
  /** Opens WhatsApp Web for calling this person. */
  onCall: (chatId: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    let active = true;
    setMessages([]);
    setShowInfo(false);
    stickToBottom.current = true;
    void window.wapp.listMessages(chat.id).then((list) => {
      if (!active) return;
      setMessages(list);
      setHasOlder(list.length >= 100);
    });
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
    return () => {
      active = false;
      off();
      window.removeEventListener('focus', markReadIfLooking);
    };
  }, [chat.id]);

  // Keep the newest message in view, unless the user scrolled up to read older ones.
  // Watching the content size also covers images that finish loading after the first render.
  useLayoutEffect(() => {
    const list = listRef.current;
    const inner = innerRef.current;
    if (!list || !inner) return;
    const toBottom = () => {
      if (stickToBottom.current) list.scrollTop = list.scrollHeight;
    };
    toBottom();
    const observer = new ResizeObserver(toBottom);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [messages]);

  async function loadOlder() {
    const el = listRef.current;
    const oldest = messages[0];
    if (!el || !oldest) return;
    const previousHeight = el.scrollHeight;
    const older = await window.wapp.listMessages(chat.id, oldest.timestamp);
    setHasOlder(older.length >= 100);
    stickToBottom.current = false;
    setMessages((prev) => [...older.filter((o) => !prev.some((p) => p.id === o.id)), ...prev]);
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight - previousHeight;
    });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    composer.current?.addFiles(Array.from(e.dataTransfer.files));
  }

  const isPerson = chat.id.endsWith('@s.whatsapp.net');

  return (
    <div className="conversation-wrap">
      <div
        className={`conversation${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={onDrop}
      >
        <header className="conversation-header">
          <button className="conversation-who" onClick={() => chat.isGroup && setShowInfo((v) => !v)}>
            <Avatar id={chat.id} name={chat.name} size={40} />
            <div className="conversation-title">
              <strong>{chat.name}</strong>
              <span>{chat.isGroup ? 'Group · click for info' : formatId(chat.id)}</span>
            </div>
          </button>
          {isPerson && (
            <>
              <button className="icon-button" title="Voice call (opens WhatsApp Web)" onClick={() => onCall(chat.id)}>
                <PhoneIcon />
              </button>
              <button className="icon-button" title="Video call (opens WhatsApp Web)" onClick={() => onCall(chat.id)}>
                <VideoIcon />
              </button>
            </>
          )}
          {chat.isGroup && (
            <button className="icon-button" title="Group info" onClick={() => setShowInfo((v) => !v)}>
              <InfoIcon />
            </button>
          )}
          <button className="button ghost" onClick={() => onSchedule('', undefined, () => undefined)}>
            <ClockIcon size={18} />
            Schedule
          </button>
        </header>

        <div
          className="messages"
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="messages-inner" ref={innerRef}>
          {hasOlder && (
            <button className="button small load-older" onClick={() => void loadOlder()}>
              Load older messages
            </button>
          )}
          {messages.length === 0 && <p className="messages-empty">No messages on this computer yet.</p>}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || formatDay(prev.timestamp) !== formatDay(m.timestamp);
            const isMedia = MEDIA_KINDS.has(m.kind) && m.media;
            return (
              <Fragment key={m.id}>
                {newDay && <div className="day-separator">{formatDay(m.timestamp)}</div>}
                <div className={`bubble-row ${m.fromMe ? 'out' : 'in'}`}>
                  <div className={`bubble${m.kind === 'sticker' ? ' sticker' : ''}${m.kind === 'deleted' ? ' deleted' : ''}`}>
                    {chat.isGroup && !m.fromMe && <div className="bubble-author">{m.authorName || formatId(m.author)}</div>}
                    {isMedia ? (
                      <MediaView message={m} onOpenImage={onOpenImage} />
                    ) : (
                      m.kind !== 'text' && m.kind !== 'other' && <div className="bubble-kind">{kindLabel(m.kind)}</div>
                    )}
                    {m.body && m.kind !== 'document' && <div className="bubble-text">{m.body}</div>}
                    {m.kind === 'other' && !m.body && <div className="bubble-kind">Message type not supported yet</div>}
                    <div className="bubble-meta">
                      {m.edited && <span>Edited</span>}
                      {formatTime(m.timestamp)}
                      {m.fromMe && m.kind !== 'deleted' && <Ack ack={m.ack} />}
                    </div>
                  </div>
                </div>
              </Fragment>
            );
          })}
          </div>
        </div>

        <Composer ref={composer} chatId={chat.id} connected={connected} onSchedule={onSchedule} />
        {dragging && <div className="drop-hint">Drop files to send them</div>}
      </div>
      {showInfo && chat.isGroup && <GroupInfoPanel chatId={chat.id} onClose={() => setShowInfo(false)} />}
    </div>
  );
}
