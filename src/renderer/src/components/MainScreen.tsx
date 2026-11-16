import { useCallback, useEffect, useState } from 'react';
import type { ChatSummary, ConnectionState, ScheduledMessage } from '../../../shared/types';
import { errorMessage } from '../format';
import { ChatList } from './ChatList';
import { Conversation } from './Conversation';
import { ChatsIcon, ClockIcon, LogoutIcon } from './Icons';
import { Logo } from './Logo';
import { ScheduleDialog, type ScheduleDraft } from './ScheduleDialog';
import { ScheduledList } from './ScheduledList';

type View = 'chats' | 'scheduled';

export function MainScreen({ connection }: { connection: ConnectionState }) {
  const [view, setView] = useState<View>('chats');
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    const loadChats = () => void window.wapp.listChats().then(setChats);
    const loadScheduled = () => void window.wapp.listScheduled().then(setScheduled);
    loadChats();
    loadScheduled();
    const off = window.wapp.onEvent((event) => {
      // History sync can fire many updates in a row; reload at most a few times a second.
      if (event.type === 'chats-changed' && timer === undefined) {
        timer = window.setTimeout(() => {
          timer = undefined;
          loadChats();
        }, 250);
      }
      if (event.type === 'scheduled-changed') loadScheduled();
    });
    // Refresh relative times ("in 5 minutes") once a minute.
    const tick = window.setInterval(loadScheduled, 60_000);
    return () => {
      off();
      window.clearTimeout(timer);
      window.clearInterval(tick);
    };
  }, []);

  const closeDialog = useCallback(() => setDraft(null), []);

  async function logout() {
    const ok = window.confirm(
      'Log out of WhatsApp on this computer?\n\nThis removes your chats and scheduled messages from WA Premium Plus.',
    );
    if (!ok) return;
    try {
      await window.wapp.logout();
    } catch (err) {
      window.alert(errorMessage(err));
    }
  }

  const selectedChat = chats.find((c) => c.id === selectedId) ?? null;
  const pending = scheduled.filter((s) => s.status === 'pending').length;
  const attention = scheduled.filter((s) => s.status === 'failed' || s.status === 'missed').length;
  const connected = connection.status === 'open';

  return (
    <div className={`layout view-${view}`}>
      <nav className="rail">
        <div className="rail-logo" title="WA Premium Plus">
          <Logo size={32} />
        </div>
        <button
          className={`rail-button${view === 'chats' ? ' active' : ''}`}
          onClick={() => setView('chats')}
          title="Chats"
        >
          <ChatsIcon />
        </button>
        <button
          className={`rail-button${view === 'scheduled' ? ' active' : ''}`}
          onClick={() => setView('scheduled')}
          title="Scheduled messages"
        >
          <ClockIcon />
          {(attention > 0 || pending > 0) && (
            <span className={`rail-badge${attention > 0 ? ' alert' : ''}`}>{attention || pending}</span>
          )}
        </button>
        <div className="rail-spacer" />
        <button className="rail-button" onClick={() => void logout()} title="Log out">
          <LogoutIcon />
        </button>
      </nav>

      {view === 'chats' && (
        <aside className="sidebar">
          <header className="sidebar-header">
            <h1>Chats</h1>
            <button
              className="button ghost small"
              onClick={() => setDraft({ body: '', repeat: 'none' })}
              title="Schedule a message"
            >
              <ClockIcon size={16} />
              Schedule
            </button>
          </header>
          <ChatList chats={chats} selectedId={selectedId} onSelect={setSelectedId} />
        </aside>
      )}

      <main className="content">
        {!connected && (
          <div className="banner">
            Connecting to WhatsApp… Scheduled messages will be sent as soon as the connection is back.
          </div>
        )}
        {view === 'scheduled' ? (
          <ScheduledList
            items={scheduled}
            onNew={() => setDraft({ body: '', repeat: 'none' })}
            onEdit={(item) =>
              setDraft({
                id: item.id,
                chatId: item.chatId,
                body: item.body,
                sendAt: Math.max(item.sendAt, Date.now() + 5 * 60_000),
                repeat: item.repeat,
              })
            }
          />
        ) : selectedChat ? (
          <Conversation
            key={selectedChat.id}
            chat={selectedChat}
            connected={connected}
            onSchedule={(body, clearComposer) =>
              setDraft({ chatId: selectedChat.id, body, repeat: 'none', onSaved: clearComposer })
            }
          />
        ) : (
          <div className="empty-state">
            <Logo size={72} />
            <h2>WA Premium Plus</h2>
            <p className="muted">
              Pick a chat to start messaging, or schedule a message to go out later.
            </p>
          </div>
        )}
      </main>

      {draft && <ScheduleDialog draft={draft} chats={chats} onClose={closeDialog} />}
    </div>
  );
}
