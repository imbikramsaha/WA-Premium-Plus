import { useState } from 'react';
import { describeGroupAction } from '../../../shared/group-actions';
import { describeRule } from '../../../shared/schedule';
import { localZone, sameZone, zoneCity } from '../../../shared/timezones';
import type { ScheduledMessage, ScheduleStatus } from '../../../shared/types';
import { errorMessage, formatDateTime, formatDateTimeIn, formatRelative } from '../format';
import { Avatar } from './Avatar';
import { CalendarView } from './CalendarView';
import { CalendarIcon, ClockIcon, FileIcon, ListIcon, PlusIcon, RepeatIcon, UsersIcon } from './Icons';
import { Logo } from './Logo';

const STATUS_LABELS: Record<ScheduleStatus, string> = {
  pending: 'Scheduled',
  sent: 'Sent',
  failed: 'Failed',
  missed: 'Missed',
  cancelled: 'Cancelled',
};

function Row({ item, onEdit }: { item: ScheduledMessage; onEdit: (item: ScheduledMessage) => void }) {
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      window.alert(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const needsAttention = item.status === 'failed' || item.status === 'missed';
  const zone = item.rule.timeZone && !sameZone(item.rule.timeZone, localZone()) ? item.rule.timeZone : undefined;
  const when =
    item.status === 'pending'
      ? zone
        ? `${formatDateTimeIn(item.sendAt, zone)} ${zoneCity(zone)} time · ${formatDateTime(item.sendAt)} yours · ${formatRelative(item.sendAt)}`
        : `${formatDateTime(item.sendAt)} · ${formatRelative(item.sendAt)}`
      : item.status === 'sent' && item.lastSentAt
        ? `Sent ${formatDateTime(item.lastSentAt)}`
        : formatDateTime(item.sendAt);

  return (
    <li className="scheduled-row">
      {item.target === 'status' ? (
        <div className="status-avatar" title="My status">
          <Logo size={40} />
        </div>
      ) : (
        <Avatar id={item.chatId} name={item.chatName} size={40} />
      )}
      <div className="scheduled-main">
        <div className="scheduled-top">
          <strong>{item.chatName}</strong>
          <span className={`status status-${item.status}`}>{STATUS_LABELS[item.status]}</span>
        </div>
        {item.target === 'group' && item.groupAction && (
          <p className="scheduled-text group-change">
            <UsersIcon size={15} />
            {describeGroupAction(item.groupAction)}
          </p>
        )}
        {item.body && <p className="scheduled-text">{item.body}</p>}
        {item.attachment && (
          <span className="attachment-pill">
            <FileIcon size={14} />
            {item.attachment.name}
          </span>
        )}
        <div className="scheduled-meta">
          <ClockIcon size={14} />
          <span>{when}</span>
          {item.rule.repeat !== 'none' && (
            <span className="pill">
              <RepeatIcon size={12} />
              {describeRule(item.rule, item.anchorAt)}
            </span>
          )}
          {item.rule.repeat !== 'none' && item.sentCount > 0 && <span className="muted">· sent {item.sentCount}×</span>}
        </div>
        {item.lastError && item.status !== 'sent' && item.status !== 'cancelled' && (
          <p className="error small">
            {item.status === 'pending' ? `Retrying: ${item.lastError}` : item.lastError}
          </p>
        )}
      </div>
      <div className="scheduled-actions">
        {needsAttention && (
          <button className="button primary small" disabled={busy} onClick={() => run(() => window.wapp.sendScheduledNow(item.id))}>
            Send now
          </button>
        )}
        {(item.status === 'pending' || needsAttention) && (
          <button className="button small" disabled={busy} onClick={() => onEdit(item)}>
            Edit
          </button>
        )}
        {item.status === 'pending' ? (
          <button
            className="button small"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Cancel this scheduled message?')) void run(() => window.wapp.cancelScheduled(item.id));
            }}
          >
            Cancel
          </button>
        ) : (
          <button className="button small" disabled={busy} onClick={() => run(() => window.wapp.deleteScheduled(item.id))}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

function Section({
  title,
  items,
  onEdit,
}: {
  title: string;
  items: ScheduledMessage[];
  onEdit: (item: ScheduledMessage) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="scheduled-section">
      <h3>
        {title} <span className="count">{items.length}</span>
      </h3>
      <ul>
        {items.map((item) => (
          <Row key={item.id} item={item} onEdit={onEdit} />
        ))}
      </ul>
    </section>
  );
}

const MODE_KEY = 'wapp.scheduledMode';

export function ScheduledList({
  items,
  onNew,
  onEdit,
}: {
  items: ScheduledMessage[];
  /** Opens the schedule dialog, optionally at a given time. */
  onNew: (sendAt?: number) => void;
  onEdit: (item: ScheduledMessage) => void;
}) {
  const [mode, setMode] = useState<'list' | 'calendar'>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'calendar' ? 'calendar' : 'list';
    } catch {
      return 'list';
    }
  });
  const switchMode = (next: 'list' | 'calendar') => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // not remembered
    }
  };
  const attention = items.filter((i) => i.status === 'failed' || i.status === 'missed');
  const upcoming = items.filter((i) => i.status === 'pending').sort((a, b) => a.sendAt - b.sendAt);
  const history = items
    .filter((i) => i.status === 'sent' || i.status === 'cancelled')
    .sort((a, b) => (b.lastSentAt ?? b.sendAt) - (a.lastSentAt ?? a.sendAt))
    .slice(0, 100);

  return (
    <div className="scheduled">
      <header className="content-header">
        <div>
          <h2>Scheduled messages</h2>
          <p className="muted">Sent automatically from this computer while WA Premium Plus is running.</p>
        </div>
        <div className="segmented compact" role="tablist">
          <button className={mode === 'list' ? 'active' : ''} onClick={() => switchMode('list')} title="List">
            <ListIcon size={16} /> List
          </button>
          <button className={mode === 'calendar' ? 'active' : ''} onClick={() => switchMode('calendar')} title="Calendar">
            <CalendarIcon size={16} /> Calendar
          </button>
        </div>
        <button className="button primary" onClick={() => onNew()}>
          <PlusIcon size={18} />
          New
        </button>
      </header>
      <div className="scheduled-body">
        {mode === 'calendar' ? (
          <CalendarView items={items} onEdit={onEdit} onNewAt={(at) => onNew(at)} />
        ) : items.length === 0 ? (
          <div className="empty-state">
            <ClockIcon size={40} />
            <h3>Nothing scheduled yet</h3>
            <p className="muted">
              Write a message, pick a time, and WA Premium Plus sends it for you. Send to one chat or many,
              attach photos and documents, post to your status, and repeat on any schedule.
            </p>
            <button className="button primary" onClick={() => onNew()}>
              Schedule a message
            </button>
          </div>
        ) : (
          <>
            <Section title="Needs attention" items={attention} onEdit={onEdit} />
            <Section title="Upcoming" items={upcoming} onEdit={onEdit} />
            <Section title="History" items={history} onEdit={onEdit} />
          </>
        )}
      </div>
    </div>
  );
}
