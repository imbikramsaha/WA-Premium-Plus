import { useEffect, useMemo, useState } from 'react';
import type { ChatSummary, Label, SearchResult } from '../../../shared/types';
import { chatMenuItems, isMuted, LABEL_COLORS } from '../chatMenu';
import { formatChatTime, kindLabel, messagePreview } from '../format';
import { Avatar } from './Avatar';
import { ArchiveIcon, BellOffIcon, ChevronLeftIcon, PinIcon, SearchIcon } from './Icons';
import { Menu, useMenu } from './Menu';

type Filter = 'all' | 'unread' | 'groups' | 'channels' | `label:${number}`;

/** Shows search matches: text between \u0002 and \u0003 is highlighted. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('\u0002') ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>,
      )}
    </>
  );
}

export function ChatList({
  chats,
  labels,
  selectedId,
  onSelect,
  onOpenMessage,
  onNewLabel,
}: {
  chats: ChatSummary[];
  labels: Label[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenMessage: (chatId: string, messageId: string) => void;
  onNewLabel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const { menu, close, openAt } = useMenu();

  // Search message text (debounced), alongside chat names.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void window.wapp.searchMessages(q).then((r) => active && setResults(r));
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const archivedChats = useMemo(() => chats.filter((c) => c.archived), [chats]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chats.filter((c) => {
      if (!q && c.archived !== showArchived) return false;
      if (filter === 'unread' && c.unreadCount === 0) return false;
      if (filter === 'groups' && !c.isGroup) return false;
      if (filter === 'channels' && !c.id.endsWith('@newsletter')) return false;
      if (filter.startsWith('label:') && !c.labels.includes(Number(filter.slice(6)))) return false;
      if (q) return c.name.toLowerCase().includes(q) || c.id.includes(q);
      // Chats WhatsApp lists but that were never used only clutter the list; search still finds them.
      return Boolean(c.lastMessage || c.lastActivity || c.unreadCount > 0 || c.pinned);
    });
  }, [chats, query, filter, showArchived]);

  const archivedUnread = archivedChats.filter((c) => c.unreadCount > 0).length;
  const filters: Array<[Filter, string]> = [
    ['all', 'All'],
    ['unread', 'Unread'],
    ['groups', 'Groups'],
    ...(chats.some((c) => c.id.endsWith('@newsletter')) ? [['channels', 'Channels'] as [Filter, string]] : []),
    ...labels.map((l) => [`label:${l.id}`, l.name] as [Filter, string]),
  ];
  const searching = query.trim().length > 0;

  return (
    <>
      <div className="search">
        <SearchIcon size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats and messages" />
      </div>
      {!searching && (
        <div className="filters">
          {filters.map(([f, label]) => (
            <button key={f} className={`chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
              {f.startsWith('label:') && (
                <span
                  className="label-dot"
                  style={{ background: LABEL_COLORS[(labels.find((l) => `label:${l.id}` === f)?.color ?? 0) % LABEL_COLORS.length] }}
                />
              )}
              {label}
            </button>
          ))}
        </div>
      )}
      <ul className="chat-list">
        {!searching &&
          (showArchived ? (
            <li>
              <button className="archived-row" onClick={() => setShowArchived(false)}>
                <ChevronLeftIcon size={18} />
                <span>Archived</span>
              </button>
            </li>
          ) : (
            archivedChats.length > 0 && (
              <li>
                <button className="archived-row" onClick={() => setShowArchived(true)}>
                  <ArchiveIcon size={18} />
                  <span>Archived</span>
                  <span className="muted small">{archivedUnread > 0 ? `${archivedUnread} unread` : archivedChats.length}</span>
                </button>
              </li>
            )
          ))}
        {searching && visible.length > 0 && <li className="list-heading">Chats</li>}
        {visible.map((chat) => {
          const muted = isMuted(chat);
          return (
            <li key={chat.id}>
              <button
                className={`chat-row${chat.id === selectedId ? ' selected' : ''}`}
                onClick={() => onSelect(chat.id)}
                onContextMenu={(e) => openAt(e, chatMenuItems(chat, labels, { onNewLabel }))}
              >
                <Avatar id={chat.id} name={chat.name} />
                <div className="chat-row-main">
                  <div className="chat-row-top">
                    <span className="chat-name">{chat.name}</span>
                    {(chat.lastMessage || chat.lastActivity) && (
                      <span className={`chat-time${chat.unreadCount > 0 && !muted ? ' unread' : ''}`}>
                        {formatChatTime(chat.lastMessage?.timestamp ?? chat.lastActivity!)}
                      </span>
                    )}
                  </div>
                  <div className="chat-row-bottom">
                    <span className="chat-preview">
                      {chat.lastMessage
                        ? `${chat.lastMessage.fromMe ? 'You: ' : ''}${messagePreview(chat.lastMessage)}`
                        : ''}
                    </span>
                    {chat.labels.length > 0 && (
                      <span className="chat-labels">
                        {chat.labels.slice(0, 3).map((id) => {
                          const label = labels.find((l) => l.id === id);
                          return label ? (
                            <span
                              key={id}
                              className="label-dot"
                              title={label.name}
                              style={{ background: LABEL_COLORS[label.color % LABEL_COLORS.length] }}
                            />
                          ) : null;
                        })}
                      </span>
                    )}
                    {muted && (
                      <span className="row-icon" title="Muted">
                        <BellOffIcon size={14} />
                      </span>
                    )}
                    {chat.pinned && (
                      <span className="row-icon" title="Pinned">
                        <PinIcon size={14} />
                      </span>
                    )}
                    {chat.unreadCount > 0 && <span className={`badge${muted ? ' muted' : ''}`}>{chat.unreadCount}</span>}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
        {searching && results.length > 0 && <li className="list-heading">Messages</li>}
        {searching &&
          results.map((r) => (
            <li key={`${r.chatId}/${r.messageId}`}>
              <button className="chat-row result-row" onClick={() => onOpenMessage(r.chatId, r.messageId)}>
                <Avatar id={r.chatId} name={r.chatName} size={36} />
                <div className="chat-row-main">
                  <div className="chat-row-top">
                    <span className="chat-name">{r.chatName}</span>
                    <span className="chat-time">{formatChatTime(r.timestamp)}</span>
                  </div>
                  <div className="result-snippet">
                    {r.fromMe ? 'You: ' : r.authorName && r.chatId.endsWith('@g.us') ? `${r.authorName}: ` : ''}
                    {r.kind !== 'text' && `${kindLabel(r.kind)}: `}
                    <Snippet text={r.snippet} />
                  </div>
                </div>
              </button>
            </li>
          ))}
        {visible.length === 0 && (!searching || results.length === 0) && (
          <li className="list-empty">
            {chats.length === 0
              ? 'Your chats will appear here as WhatsApp syncs them.'
              : searching
                ? 'No chats or messages match.'
                : showArchived
                  ? 'No archived chats.'
                  : filter === 'unread'
                    ? 'No unread chats.'
                    : 'No chats here yet.'}
          </li>
        )}
      </ul>
      {menu && <Menu {...menu} onClose={close} />}
    </>
  );
}
