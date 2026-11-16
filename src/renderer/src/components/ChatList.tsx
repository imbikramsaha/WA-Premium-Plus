import { useMemo, useState } from 'react';
import type { ChatSummary } from '../../../shared/types';
import { formatChatTime, messagePreview } from '../format';
import { Avatar } from './Avatar';
import { SearchIcon } from './Icons';

export function ChatList({
  chats,
  selectedId,
  onSelect,
}: {
  chats: ChatSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'groups'>('all');
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chats.filter(
      (c) =>
        (filter === 'all' || (filter === 'unread' ? c.unreadCount > 0 : c.isGroup)) &&
        (q
          ? c.name.toLowerCase().includes(q) || c.id.includes(q)
          : // Chats WhatsApp lists but that were never used only clutter the list; search still finds them.
            Boolean(c.lastMessage || c.lastActivity || c.unreadCount > 0)),
    );
  }, [chats, query, filter]);

  return (
    <>
      <div className="search">
        <SearchIcon size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" />
      </div>
      <div className="filters">
        {(['all', 'unread', 'groups'] as const).map((f) => (
          <button key={f} className={`chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'unread' ? 'Unread' : 'Groups'}
          </button>
        ))}
      </div>
      <ul className="chat-list">
        {visible.map((chat) => (
          <li key={chat.id}>
            <button
              className={`chat-row${chat.id === selectedId ? ' selected' : ''}`}
              onClick={() => onSelect(chat.id)}
            >
              <Avatar id={chat.id} name={chat.name} />
              <div className="chat-row-main">
                <div className="chat-row-top">
                  <span className="chat-name">{chat.name}</span>
                  {(chat.lastMessage || chat.lastActivity) && (
                    <span className={`chat-time${chat.unreadCount > 0 ? ' unread' : ''}`}>
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
                  {chat.unreadCount > 0 && <span className="badge">{chat.unreadCount}</span>}
                </div>
              </div>
            </button>
          </li>
        ))}
        {visible.length === 0 && (
          <li className="list-empty">
            {chats.length === 0
              ? 'Your chats will appear here as WhatsApp syncs them.'
              : filter === 'unread' && !query
                ? 'No unread chats.'
                : 'No chats match.'}
          </li>
        )}
      </ul>
    </>
  );
}
