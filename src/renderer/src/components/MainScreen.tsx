import { useCallback, useEffect, useState } from 'react';
import type { ChatSummary, ConnectionState, ScheduledMessage } from '../../../shared/types';
import { errorMessage } from '../format';
import { ChatList } from './ChatList';
import { Conversation } from './Conversation';
import { ChatsIcon, ClockIcon, CloseIcon, LogoutIcon, PhoneIcon } from './Icons';
import { Logo } from './Logo';
import { ScheduleDialog, type ScheduleDraft } from './ScheduleDialog';
import { ScheduledList } from './ScheduledList';

type View = 'chats' | 'scheduled';

const CALLS_INTRO_KEY = 'wapp.callsIntroSeen';

function callsIntroSeen(): boolean {
  try {
    return localStorage.getItem(CALLS_INTRO_KEY) === '1';
  } catch {
    return false;
  }
}

export function MainScreen({ connection }: { connection: ConnectionState }) {
  const [view, setView] = useState<View>('chats');
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [callsIntro, setCallsIntro] = useState<{ chatId?: string } | null>(null);

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

  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setViewer(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewer]);

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

  function openCalls(chatId?: string) {
    if (!callsIntroSeen()) {
      setCallsIntro({ chatId });
      return;
    }
    void window.wapp.openCallsWindow(chatId).catch((err) => window.alert(errorMessage(err)));
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
        <button className={`rail-button${view === 'chats' ? ' active' : ''}`} onClick={() => setView('chats')} title="Chats">
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
        <button className="rail-button" onClick={() => openCalls()} title="Voice and video calls (opens WhatsApp Web)">
          <PhoneIcon />
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
              onClick={() => setDraft({ chatIds: [], body: '' })}
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
            onNew={() => setDraft({ chatIds: [], body: '' })}
            onEdit={(item) =>
              setDraft({
                id: item.id,
                target: item.target,
                chatIds: item.target === 'chat' ? [item.chatId] : [],
                body: item.body,
                sendAt: Math.max(item.sendAt, Date.now() + 5 * 60_000),
                rule: item.rule,
                existingAttachment: item.attachment,
              })
            }
          />
        ) : selectedChat ? (
          <Conversation
            key={selectedChat.id}
            chat={selectedChat}
            connected={connected}
            onOpenImage={setViewer}
            onCall={openCalls}
            onSchedule={(body, attachmentPath, clearComposer) =>
              setDraft({ chatIds: [selectedChat.id], body, attachmentPath, onSaved: clearComposer })
            }
          />
        ) : (
          <div className="empty-state">
            <div className="empty-logo">
              <Logo size={72} />
            </div>
            <h2>WA Premium Plus</h2>
            <p>Pick a chat to start messaging, or schedule a message to go out later.</p>
            <div className="feature-list">
              <div className="feature">
                <ClockIcon size={20} />
                Schedule and repeat messages
              </div>
              <div className="feature">
                <ChatsIcon size={20} />
                Send to many chats at once
              </div>
              <div className="feature">
                <PhoneIcon size={20} />
                Calls through WhatsApp Web
              </div>
            </div>
          </div>
        )}
      </main>

      {draft && <ScheduleDialog draft={draft} chats={chats} onClose={closeDialog} />}

      {viewer && (
        <div className="lightbox" onClick={() => setViewer(null)}>
          <img src={viewer} alt="" onClick={(e) => e.stopPropagation()} />
          <button className="icon-button lightbox-close" title="Close" onClick={() => setViewer(null)}>
            <CloseIcon />
          </button>
        </div>
      )}

      {callsIntro && (
        <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setCallsIntro(null)}>
          <div className="dialog narrow">
            <header className="dialog-header">
              <h2>Voice and video calls</h2>
              <button className="icon-button" onClick={() => setCallsIntro(null)} title="Close">
                <CloseIcon />
              </button>
            </header>
            <p>
              Calls open in the official <strong>WhatsApp Web</strong>, in a separate window. No open-source WhatsApp
              library can carry call audio and video, so this is the reliable way to call from your computer.
            </p>
            <ol className="steps">
              <li>The first time, the window shows a QR code. Scan it from Linked devices on your phone.</li>
              <li>Then use the call buttons in WhatsApp Web as usual. Allow the microphone and camera when asked.</li>
            </ol>
            <footer className="dialog-footer">
              <button className="button" onClick={() => setCallsIntro(null)}>
                Cancel
              </button>
              <button
                className="button primary"
                onClick={() => {
                  try {
                    localStorage.setItem(CALLS_INTRO_KEY, '1');
                  } catch {
                    // not remembered; the intro shows again next time
                  }
                  const chatId = callsIntro.chatId;
                  setCallsIntro(null);
                  void window.wapp.openCallsWindow(chatId).catch((err) => window.alert(errorMessage(err)));
                }}
              >
                Open WhatsApp Web
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
