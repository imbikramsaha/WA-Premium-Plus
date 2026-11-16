import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ChatSummary, ConnectionState, Label, ScheduledMessage } from '../../../shared/types';
import { LABEL_COLORS } from '../chatMenu';
import { errorMessage } from '../format';
import { AccountSwitcher } from './AccountSwitcher';
import { CallsView } from './CallsView';
import { ChatList } from './ChatList';
import { Conversation, type ConversationExtras } from './Conversation';
import { ChatsIcon, ClockIcon, CloseIcon, ComposeIcon, MegaphoneIcon, PhoneIcon, StatusIcon, UsersIcon } from './Icons';
import { Logo } from './Logo';
import { Menu, Modal, useMenu } from './Menu';
import { ScheduleDialog, type ScheduleDraft } from './ScheduleDialog';
import { ScheduledList } from './ScheduledList';
import { FollowChannelDialog, NewChatDialog, NewGroupDialog } from './ShareDialogs';
import { StatusView } from './StatusView';

export type View = 'chats' | 'status' | 'calls' | 'scheduled';

const CALLS_INTRO_KEY = 'wapp.callsIntroSeen';

function callsIntroSeen(): boolean {
  try {
    return localStorage.getItem(CALLS_INTRO_KEY) === '1';
  } catch {
    return false;
  }
}

/** Extra views and conversation actions, added by later features. */
export interface MainScreenExtras {
  railItems?: Array<{ view: string; title: string; icon: ReactNode; badge?: number }>;
  renderView?: (
    view: string,
    api: { openChat: (chatId: string, messageId?: string) => void; chats: ChatSummary[]; labels: Label[]; connected: boolean },
  ) => ReactNode;
  conversation?: ConversationExtras;
  /** Dialogs the extras open. */
  overlay?: ReactNode;
  /** Opens the dialog for exporting every chat. */
  openExport?: () => void;
}

export function MainScreen({ connection, extras }: { connection: ConnectionState; extras?: MainScreenExtras }) {
  const [view, setView] = useState<string>('chats');
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ messageId: string; nonce: number } | undefined>(undefined);
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [callsIntro, setCallsIntro] = useState<{ chatId?: string } | null>(null);
  const [dialog, setDialog] = useState<'chat' | 'group' | 'channel' | 'label' | null>(null);
  const { menu, close: closeMenu, openUnder } = useMenu();

  useEffect(() => {
    let timer: number | undefined;
    const loadChats = () => void window.wapp.listChats().then(setChats);
    const loadScheduled = () => void window.wapp.listScheduled().then(setScheduled);
    const loadLabels = () => void window.wapp.listLabels().then(setLabels);
    loadChats();
    loadScheduled();
    loadLabels();
    const off = window.wapp.onEvent((event) => {
      // History sync can fire many updates in a row; reload at most a few times a second.
      if (event.type === 'chats-changed' && timer === undefined) {
        timer = window.setTimeout(() => {
          timer = undefined;
          loadChats();
        }, 250);
      }
      if (event.type === 'scheduled-changed') loadScheduled();
      if (event.type === 'labels-changed') loadLabels();
      if (event.type === 'open-chat') {
        setView('chats');
        setSelectedId(event.chatId);
      }
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

  const openChat = useCallback((chatId: string, messageId?: string) => {
    setView('chats');
    setSelectedId(chatId);
    setFocus(messageId ? { messageId, nonce: Date.now() } : undefined);
    // A chat that was just created may not be in the list yet.
    void window.wapp.listChats().then(setChats);
  }, []);

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
  const sidebarView = view === 'chats';

  const rail: Array<{ view: string; title: string; icon: ReactNode; badge?: number; alert?: boolean }> = [
    { view: 'chats', title: 'Chats', icon: <ChatsIcon /> },
    { view: 'status', title: 'Status', icon: <StatusIcon /> },
    { view: 'calls', title: 'Calls', icon: <PhoneIcon /> },
    { view: 'scheduled', title: 'Scheduled', icon: <ClockIcon />, badge: attention || pending, alert: attention > 0 },
    ...(extras?.railItems ?? []),
  ];

  return (
    <div className={`layout view-${sidebarView ? 'chats' : 'full'}`}>
      <nav className="rail">
        <div className="rail-logo" title="WA Premium Plus">
          <Logo size={32} />
        </div>
        {rail.map((item) => (
          <button
            key={item.view}
            className={`rail-button${view === item.view ? ' active' : ''}`}
            onClick={() => setView(item.view)}
            title={item.title}
          >
            {item.icon}
            {item.badge ? <span className={`rail-badge${item.alert ? ' alert' : ''}`}>{item.badge}</span> : null}
          </button>
        ))}
        <div className="rail-spacer" />
        <AccountSwitcher />
      </nav>

      {sidebarView && (
        <aside className="sidebar">
          <header className="sidebar-header">
            <h1>Chats</h1>
            <button
              className="icon-button"
              title="New chat, group or channel"
              onClick={(e) =>
                openUnder(e.currentTarget, [
                  { label: 'New chat', icon: <ChatsIcon size={15} />, onClick: () => setDialog('chat'), disabled: !connected },
                  { label: 'New group', icon: <UsersIcon size={15} />, onClick: () => setDialog('group'), disabled: !connected },
                  { label: 'Follow a channel', icon: <MegaphoneIcon size={15} />, onClick: () => setDialog('channel'), disabled: !connected },
                  {
                    label: 'Schedule a message',
                    icon: <ClockIcon size={15} />,
                    separator: true,
                    onClick: () => setDraft({ chatIds: [], body: '' }),
                  },
                ])
              }
            >
              <ComposeIcon />
            </button>
          </header>
          <ChatList
            chats={chats}
            labels={labels}
            selectedId={selectedId}
            onSelect={(id) => openChat(id)}
            onOpenMessage={openChat}
            onNewLabel={() => setDialog('label')}
          />
        </aside>
      )}

      {view === 'status' ? (
        <StatusView connection={connection} />
      ) : (
        <main className="content">
          {!connected && (
            <div className="banner">
              Connecting to WhatsApp… Scheduled messages will be sent as soon as the connection is back.
            </div>
          )}
          {view === 'scheduled' ? (
            <ScheduledList
              items={scheduled}
              onNew={(sendAt) => setDraft({ chatIds: [], body: '', sendAt })}
              onEdit={(item) =>
                setDraft({
                  id: item.id,
                  target: item.target,
                  chatIds: item.target === 'status' ? [] : [item.chatId],
                  body: item.body,
                  sendAt: Math.max(item.sendAt, Date.now() + 5 * 60_000),
                  rule: item.rule,
                  existingAttachment: item.attachment,
                  groupAction: item.groupAction,
                })
              }
            />
          ) : view === 'calls' ? (
            <CallsView onCall={openCalls} onOpenChat={openChat} />
          ) : view !== 'chats' ? (
            extras?.renderView?.(view, { openChat, chats, labels, connected })
          ) : selectedChat ? (
            <Conversation
              key={selectedChat.id}
              chat={selectedChat}
              chats={chats}
              labels={labels}
              connected={connected}
              focus={focus}
              extras={extras?.conversation}
              onOpenImage={setViewer}
              onCall={openCalls}
              onOpenChat={openChat}
              onNewLabel={() => setDialog('label')}
              onScheduleGroupChange={(chatId) => setDraft({ target: 'group', chatIds: [chatId], body: '' })}
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
                  Search every message
                </div>
                <div className="feature">
                  <PhoneIcon size={20} />
                  Calls through WhatsApp Web
                </div>
              </div>
            </div>
          )}
        </main>
      )}

      {draft && <ScheduleDialog draft={draft} chats={chats} onClose={closeDialog} />}
      {extras?.overlay}
      {menu && <Menu {...menu} onClose={closeMenu} />}
      {dialog === 'chat' && <NewChatDialog onClose={() => setDialog(null)} onOpen={openChat} />}
      {dialog === 'group' && <NewGroupDialog onClose={() => setDialog(null)} onOpen={openChat} />}
      {dialog === 'channel' && <FollowChannelDialog onClose={() => setDialog(null)} onOpen={openChat} />}
      {dialog === 'label' && <LabelDialog onClose={() => setDialog(null)} />}

      {viewer && (
        <div className="lightbox" onClick={() => setViewer(null)}>
          <img src={viewer} alt="" onClick={(e) => e.stopPropagation()} />
          <button className="icon-button lightbox-close" title="Close" onClick={() => setViewer(null)}>
            <CloseIcon />
          </button>
        </div>
      )}

      {callsIntro && (
        <Modal
          title="Voice and video calls"
          narrow
          onClose={() => setCallsIntro(null)}
          footer={
            <>
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
            </>
          }
        >
          <p>
            Calls open in the official <strong>WhatsApp Web</strong>, in a separate window. No open-source WhatsApp library
            can carry call audio and video, so this is the reliable way to call from your computer.
          </p>
          <ol className="steps">
            <li>The first time, the window shows a QR code. Scan it from Linked devices on your phone.</li>
            <li>Then use the call buttons in WhatsApp Web as usual. Allow the microphone and camera when asked.</li>
          </ol>
        </Modal>
      )}
    </div>
  );
}

function LabelDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    try {
      await window.wapp.saveLabel({ name, color });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Modal
      title="New label"
      narrow
      onClose={onClose}
      footer={
        <>
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={!name.trim()} onClick={() => void save()}>
            Create label
          </button>
        </>
      }
    >
      <input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Customers, Family, To follow up…" />
      <div className="swatches">
        {LABEL_COLORS.map((c, i) => (
          <button key={c} className={i === color ? 'active' : ''} style={{ background: c }} title="Label colour" onClick={() => setColor(i)} />
        ))}
      </div>
      <p className="hint">Labels are kept on this computer. Add them to chats from a chat's menu (right-click it).</p>
      {error && <p className="error small">{error}</p>}
    </Modal>
  );
}
