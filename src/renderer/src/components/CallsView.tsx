import { useEffect, useMemo, useState } from 'react';
import type { CallRecord } from '../../../shared/types';
import { formatChatTime, formatDay, formatDuration, formatTime } from '../format';
import { Avatar } from './Avatar';
import { ChatsIcon, PhoneIcon, PhoneIncomingIcon, PhoneMissedIcon, PhoneOutgoingIcon, VideoIcon } from './Icons';

function describe(call: CallRecord): string {
  const kind = call.isVideo ? 'video call' : 'voice call';
  switch (call.status) {
    case 'missed':
      return `Missed ${kind}`;
    case 'rejected':
      return `Declined ${kind}`;
    case 'auto-rejected':
      return `Declined automatically`;
    case 'answered':
      return `Incoming ${kind}`;
    case 'outgoing':
      return `Outgoing ${kind}`;
  }
}

export function CallsView({
  onCall,
  onOpenChat,
}: {
  onCall: (chatId?: string) => void;
  onOpenChat: (chatId: string) => void;
}) {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [filter, setFilter] = useState<'all' | 'missed'>('all');

  useEffect(() => {
    const load = () => void window.wapp.listCalls().then(setCalls);
    load();
    return window.wapp.onEvent((e) => e.type === 'calls-changed' && load());
  }, []);

  const visible = useMemo(
    () => calls.filter((c) => filter === 'all' || c.status === 'missed' || c.status === 'auto-rejected'),
    [calls, filter],
  );

  return (
    <div className="scheduled">
      <header className="content-header">
        <div>
          <h2>Calls</h2>
          <p>
            Calls to and from this account while WA Premium Plus was running, and calls from your chat history. Calling
            opens WhatsApp Web.
          </p>
        </div>
        <button className="button primary" onClick={() => onCall()}>
          <PhoneIcon size={16} />
          Open WhatsApp Web
        </button>
      </header>
      <div className="filters padded">
        <button className={`chip${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
          All
        </button>
        <button className={`chip${filter === 'missed' ? ' active' : ''}`} onClick={() => setFilter('missed')}>
          Missed
        </button>
      </div>
      <div className="scheduled-body">
        {visible.length === 0 ? (
          <div className="empty-inline">No calls yet.</div>
        ) : (
          <ul className="call-list">
            {visible.map((call, i) => {
              const prev = visible[i - 1];
              const day = formatDay(call.startedAt / 1000);
              const missed = call.status === 'missed' || call.status === 'auto-rejected' || call.status === 'rejected';
              const Icon = call.fromMe ? PhoneOutgoingIcon : missed ? PhoneMissedIcon : PhoneIncomingIcon;
              const seconds = call.endedAt && call.status !== 'missed' ? (call.endedAt - call.startedAt) / 1000 : 0;
              return (
                <li key={call.id}>
                  {(!prev || formatDay(prev.startedAt / 1000) !== day) && <div className="day-heading">{day}</div>}
                  <div className="call-row">
                    <Avatar id={call.chatId} name={call.chatName} size={40} />
                    <div className="call-main">
                      <strong className={missed && !call.fromMe ? 'missed' : ''}>{call.chatName}</strong>
                      <span className={`call-kind${missed && !call.fromMe ? ' missed' : ''}`}>
                        <Icon size={14} />
                        {describe(call)}
                        {seconds >= 1 && call.status === 'answered' ? ` · ${formatDuration(seconds)}` : ''}
                      </span>
                    </div>
                    <span className="muted small" title={formatChatTime(call.startedAt / 1000)}>
                      {formatTime(call.startedAt / 1000)}
                    </span>
                    {!call.isGroup && (
                      <button className="icon-button" title="Message" onClick={() => onOpenChat(call.chatId)}>
                        <ChatsIcon size={18} />
                      </button>
                    )}
                    {!call.isGroup && (
                      <button className="icon-button" title="Call back (opens WhatsApp Web)" onClick={() => onCall(call.chatId)}>
                        {call.isVideo ? <VideoIcon size={18} /> : <PhoneIcon size={18} />}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
