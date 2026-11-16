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
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? chats.filter((c) => c.name.toLowerCase().includes(q) || c.id.includes(q)) : chats;
  }, [chats, query]);

  return (
    <>
      <div className="search">
        <SearchIcon size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" />
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
                  {chat.lastMessage && (
                    <span className={`chat-time${chat.unreadCount > 0 ? ' unread' : ''}`}>
                      {formatChatTime(chat.lastMessage.timestamp)}
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
            {chats.length === 0 ? 'Your chats will appear here as WhatsApp syncs them.' : 'No chats match your search.'}
          </li>
        )}
      </ul>
    </>
  );
}
