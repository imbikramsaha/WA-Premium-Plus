import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { ChatMessage, ChatSummary, GroupInfo, Label } from '../../../shared/types';
import { chatMenuItems, isMuted } from '../chatMenu';
import { errorMessage, formatDay, formatId } from '../format';
import { Avatar } from './Avatar';
import { ChannelInfoPanel } from './ChannelInfoPanel';
import { Composer, type ComposerHandle } from './Composer';
import { GroupInfoPanel } from './GroupInfoPanel';
import {
  BellOffIcon,
  ClockIcon,
  CopyIcon,
  EditIcon,
  ForwardIcon,
  InfoIcon,
  MoreIcon,
  PhoneIcon,
  ReplyIcon,
  TrashIcon,
  VideoIcon,
} from './Icons';
import { Menu, Modal, useMenu, type MenuItem } from './Menu';
import { MessageBubble, type BubbleActions } from './MessageBubble';
import { ContactCardDialog, ForwardDialog, LocationDialog, PollDialog } from './ShareDialogs';

function upsertMessage(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = list.findIndex((m) => m.id === message.id);
  if (index >= 0) {
    const next = list.slice();
    next[index] = { ...list[index], ...message };
    return next;
  }
  return [...list, message].sort((a, b) => a.timestamp - b.timestamp);
}

const userIsLooking = () => document.visibilityState === 'visible' && document.hasFocus();
const EDIT_WINDOW_S = 15 * 60;
const DELETE_FOR_EVERYONE_S = 2 * 24 * 60 * 60;

export interface ConversationExtras {
  /** Extra items for the conversation's "more" menu (export, reminders...). */
  menuItems?: (chat: ChatSummary) => MenuItem[];
  /** Extra items for a message's "more" menu. */
  messageMenuItems?: (message: ChatMessage, chat: ChatSummary) => MenuItem[];
  /** More actions for a group's member list. */
  groupMemberActions?: (info: GroupInfo) => MenuItem[];
}

export function Conversation({
  chat,
  chats,
  labels,
  connected,
  focus,
  extras,
  onSchedule,
  onOpenImage,
  onCall,
  onScheduleGroupChange,
  onOpenChat,
  onNewLabel,
}: {
  chat: ChatSummary;
  chats: ChatSummary[];
  labels: Label[];
  connected: boolean;
  /** A message to scroll to and highlight (from search). */
  focus?: { messageId: string; nonce: number };
  extras?: ConversationExtras;
  onSchedule: (body: string, attachmentPath: string | undefined, clearComposer: () => void) => void;
  onOpenImage: (url: string) => void;
  /** Opens WhatsApp Web for calling this person. */
  onCall: (chatId: string) => void;
  /** Opens the schedule dialog for a settings change in this group. */
  onScheduleGroupChange: (chatId: string) => void;
  onOpenChat: (chatId: string) => void;
  onNewLabel: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [share, setShare] = useState<'poll' | 'location' | 'contact' | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const stickToBottom = useRef(true);
  const { menu, close: closeMenu, openUnder } = useMenu();

  const isPerson = chat.id.endsWith('@s.whatsapp.net');
  const isChannel = chat.id.endsWith('@newsletter');

  const loadLatest = useCallback(() => {
    stickToBottom.current = true;
    setHasNewer(false);
    return window.wapp.listMessages(chat.id).then((list) => {
      setMessages(list);
      setHasOlder(list.length >= 100);
      return list;
    });
  }, [chat.id]);

  useEffect(() => {
    let active = true;
    setMessages([]);
    setShowInfo(false);
    setReplyTo(null);
    setHighlight(null);
    stickToBottom.current = true;
    void loadLatest().then(() => {
      // Messages synced by older versions may lack media keys or group senders; the main
      // process asks the phone to re-send the chat's history when that would help.
      if (active) void window.wapp.refreshChatMedia(chat.id);
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
      } else if (event.type === 'chats-changed') {
        // A message deleted for me: drop it from the list.
        void window.wapp.listMessages(chat.id).then((list) => {
          if (!active) return;
          const ids = new Set(list.map((m) => m.id));
          const oldestShown = list[0]?.timestamp ?? 0;
          setMessages((prev) => prev.filter((m) => m.timestamp < oldestShown || ids.has(m.id)));
        });
      }
    });
    window.addEventListener('focus', markReadIfLooking);
    return () => {
      active = false;
      off();
      window.removeEventListener('focus', markReadIfLooking);
    };
  }, [chat.id, loadLatest]);

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

  const jumpTo = useCallback(
    async (messageId: string) => {
      stickToBottom.current = false;
      if (!messages.some((m) => m.id === messageId)) {
        const around = await window.wapp.listMessagesAround(chat.id, messageId);
        if (!around.some((m) => m.id === messageId)) {
          window.alert("That message isn't on this computer.");
          return;
        }
        setMessages(around);
        setHasOlder(true);
        setHasNewer((around.at(-1)?.timestamp ?? 0) < (chat.lastMessage?.timestamp ?? 0));
      }
      setHighlight(messageId);
      window.setTimeout(() => setHighlight((h) => (h === messageId ? null : h)), 2400);
    },
    [chat.id, chat.lastMessage?.timestamp, messages],
  );

  useLayoutEffect(() => {
    if (!highlight) return;
    const el = innerRef.current?.querySelector(`[data-id="${CSS.escape(highlight)}"]`);
    el?.scrollIntoView({ block: 'center' });
  }, [highlight, messages]);

  useEffect(() => {
    if (focus) void jumpTo(focus.messageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

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

  const actions = useMemo<BubbleActions>(
    () => ({
      onReply: (m) => {
        setReplyTo(m);
        composer.current?.focus();
      },
      onReact: (m, emoji) => {
        void window.wapp.react(m.chatId, m.id, emoji).catch((err) => window.alert(errorMessage(err)));
      },
      onMore: (m, anchor) => {
        const now = Date.now() / 1000;
        const items: MenuItem[] = [
          { label: 'Reply', icon: <ReplyIcon size={15} />, onClick: () => actions.onReply(m), disabled: isChannel },
          { label: 'Forward', icon: <ForwardIcon size={15} />, onClick: () => setForwarding(m) },
          {
            label: 'Copy text',
            icon: <CopyIcon size={15} />,
            disabled: !m.body,
            onClick: () => void navigator.clipboard.writeText(m.body),
          },
        ];
        if (m.fromMe && m.kind === 'text' && now - m.timestamp < EDIT_WINDOW_S) {
          items.push({ label: 'Edit', icon: <EditIcon size={15} />, onClick: () => setEditing(m) });
        }
        items.push(...(extras?.messageMenuItems?.(m, chat) ?? []));
        items.push({
          label: 'Delete for me',
          icon: <TrashIcon size={15} />,
          danger: true,
          separator: true,
          onClick: () => {
            if (!window.confirm('Delete this message for you? It stays for everyone else.')) return;
            void window.wapp.deleteMessage(m.chatId, m.id, false).catch((err) => window.alert(errorMessage(err)));
          },
        });
        if (m.fromMe && now - m.timestamp < DELETE_FOR_EVERYONE_S) {
          items.push({
            label: 'Delete for everyone',
            icon: <TrashIcon size={15} />,
            danger: true,
            onClick: () => {
              if (!window.confirm('Delete this message for everyone?')) return;
              void window.wapp.deleteMessage(m.chatId, m.id, true).catch((err) => window.alert(errorMessage(err)));
            },
          });
        }
        openUnder(anchor, items);
      },
      onJump: (id) => void jumpTo(id),
      onOpenImage,
      onOpenChat,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jumpTo, isChannel, onOpenImage, onOpenChat, extras, chat],
  );

  const subtitle = chat.isGroup ? 'Group · click for info' : isChannel ? 'Channel · click for info' : formatId(chat.id);
  const hasPanel = chat.isGroup || isChannel;

  return (
    <div className="conversation-wrap">
      <div
        className={`conversation${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files') && !isChannel) {
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
          <button className="conversation-who" onClick={() => hasPanel && setShowInfo((v) => !v)}>
            <Avatar id={chat.id} name={chat.name} size={40} />
            <div className="conversation-title">
              <strong>
                {chat.name}
                {isMuted(chat) && (
                  <span className="title-icon" title="Muted">
                    <BellOffIcon size={13} />
                  </span>
                )}
              </strong>
              <span>{subtitle}</span>
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
          {hasPanel && (
            <button className="icon-button" title={isChannel ? 'Channel info' : 'Group info'} onClick={() => setShowInfo((v) => !v)}>
              <InfoIcon />
            </button>
          )}
          {!isChannel && (
            <button className="button ghost" title="Schedule a message" onClick={() => onSchedule('', undefined, () => undefined)}>
              <ClockIcon size={18} />
              <span className="button-label">Schedule</span>
            </button>
          )}
          <button
            className="icon-button"
            title="More"
            onClick={(e) =>
              openUnder(e.currentTarget, [...(extras?.menuItems?.(chat) ?? []), ...chatMenuItems(chat, labels, { onNewLabel })])
            }
          >
            <MoreIcon />
          </button>
        </header>

        <div
          className="messages"
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = !hasNewer && el.scrollHeight - el.scrollTop - el.clientHeight < 80;
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
              return (
                <Fragment key={m.id}>
                  {newDay && <div className="day-separator">{formatDay(m.timestamp)}</div>}
                  <MessageBubble
                    message={m}
                    isGroup={chat.isGroup}
                    connected={connected}
                    highlighted={highlight === m.id}
                    canReact={!isChannel}
                    actions={actions}
                  />
                </Fragment>
              );
            })}
          </div>
        </div>
        {hasNewer && (
          <button className="button small jump-latest" onClick={() => void loadLatest()}>
            Jump to latest
          </button>
        )}

        <Composer
          ref={composer}
          chatId={chat.id}
          personName={isPerson ? chat.name : undefined}
          connected={connected}
          readOnly={isChannel}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSchedule={onSchedule}
          onShare={setShare}
        />
        {dragging && <div className="drop-hint">Drop files to send them</div>}
      </div>
      {showInfo && chat.isGroup && (
        <GroupInfoPanel
          chatId={chat.id}
          onClose={() => setShowInfo(false)}
          onScheduleChange={() => onScheduleGroupChange(chat.id)}
          onOpenChat={onOpenChat}
          memberActions={extras?.groupMemberActions}
        />
      )}
      {showInfo && isChannel && <ChannelInfoPanel chatId={chat.id} onClose={() => setShowInfo(false)} />}

      {menu && <Menu {...menu} onClose={closeMenu} />}
      {forwarding && (
        <ForwardDialog chats={chats} chatId={chat.id} messageId={forwarding.id} onClose={() => setForwarding(null)} />
      )}
      {editing && <EditDialog message={editing} onClose={() => setEditing(null)} />}
      {share === 'poll' && <PollDialog chatId={chat.id} onClose={() => setShare(null)} />}
      {share === 'location' && <LocationDialog chatId={chat.id} onClose={() => setShare(null)} />}
      {share === 'contact' && <ContactCardDialog chatId={chat.id} onClose={() => setShare(null)} />}
    </div>
  );
}

function EditDialog({ message, onClose }: { message: ChatMessage; onClose: () => void }) {
  const [text, setText] = useState(message.body);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await window.wapp.editMessage(message.chatId, message.id, text);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Edit message"
      narrow
      onClose={onClose}
      footer={
        <>
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || !text.trim() || text === message.body} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <textarea className="edit-text" autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      {error && <p className="error small">{error}</p>}
    </Modal>
  );
}
