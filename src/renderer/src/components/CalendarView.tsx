// Content calendar: a month of scheduled messages, statuses and group changes.

import { useMemo, useState, type DragEvent } from 'react';
import { describeGroupAction } from '../../../shared/group-actions';
import { occurrencesBetween } from '../../../shared/schedule';
import { formatWallTime, parseWallTime } from '../../../shared/timezones';
import type { ScheduledMessage } from '../../../shared/types';
import { errorMessage, formatTime } from '../format';
import { ChevronLeftIcon, ChevronRightIcon, RepeatIcon } from './Icons';

interface Entry {
  item: ScheduledMessage;
  at: number;
  /** A later repeat of the item, not its next send. */
  repeat: boolean;
}

const MAX_PER_DAY = 4;

/** The first day of the week for the user's locale (0 = Sunday, 1 = Monday). */
function firstDayOfWeek(): number {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    if (info) return info.firstDay % 7;
  } catch {
    // fall through
  }
  return 1;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function label(item: ScheduledMessage): string {
  if (item.target === 'group' && item.groupAction) return `${item.chatName}: ${describeGroupAction(item.groupAction)}`;
  const text = item.body || item.attachment?.name || '';
  return text ? `${item.chatName}: ${text}` : item.chatName;
}

export function CalendarView({
  items,
  onEdit,
  onNewAt,
}: {
  items: ScheduledMessage[];
  onEdit: (item: ScheduledMessage) => void;
  onNewAt: (ms: number) => void;
}) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [dragOver, setDragOver] = useState<string | null>(null);
  const weekStart = useMemo(firstDayOfWeek, []);

  const gridStart = useMemo(() => {
    const offset = (month.getDay() - weekStart + 7) % 7;
    return new Date(month.getFullYear(), month.getMonth(), 1 - offset);
  }, [month, weekStart]);
  const days = useMemo(
    () => Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)),
    [gridStart],
  );

  const byDay = useMemo(() => {
    const from = days[0]!.getTime();
    const to = new Date(days[41]!.getFullYear(), days[41]!.getMonth(), days[41]!.getDate() + 1).getTime() - 1;
    const map = new Map<string, Entry[]>();
    const add = (entry: Entry) => {
      const key = dayKey(new Date(entry.at));
      map.set(key, [...(map.get(key) ?? []), entry]);
    };
    for (const item of items) {
      if (item.status === 'pending') {
        occurrencesBetween(item.sendAt, item.anchorAt, item.rule, from, to, 62).forEach((at, i) =>
          add({ item, at, repeat: i > 0 || at !== item.sendAt }),
        );
      } else if (item.status !== 'cancelled') {
        const at = item.lastSentAt ?? item.sendAt;
        if (at >= from && at <= to) add({ item, at, repeat: false });
      }
    }
    for (const list of map.values()) list.sort((a, b) => a.at - b.at);
    return map;
  }, [items, days]);

  async function moveTo(day: Date, e: DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const id = Number(e.dataTransfer.getData('text/x-wapp-schedule'));
    const item = items.find((i) => i.id === id);
    if (!item) return;
    // Keep the time of day (in the item's time zone), on the new date.
    const zone = item.rule.timeZone;
    const pad = (n: number) => String(n).padStart(2, '0');
    const time = zone ? formatWallTime(item.sendAt, zone).slice(11) : `${pad(new Date(item.sendAt).getHours())}:${pad(new Date(item.sendAt).getMinutes())}`;
    const wallTime = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T${time}`;
    const sendAt = zone ? parseWallTime(wallTime, zone) : new Date(wallTime).getTime();
    if (sendAt < Date.now()) {
      window.alert('That time has already passed. Pick a later day.');
      return;
    }
    try {
      await window.wapp.updateScheduled(item.id, {
        target: item.target,
        chatIds: item.target === 'status' ? [] : [item.chatId],
        body: item.body,
        sendAt,
        rule: item.rule,
        groupAction: item.groupAction,
        ...(zone ? { wallTime, timeZone: zone } : {}),
      });
    } catch (err) {
      window.alert(errorMessage(err));
    }
  }

  const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(month);
  const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const todayKey = dayKey(new Date());
  const startOfToday = new Date(new Date().toDateString()).getTime();

  return (
    <div className="calendar">
      <div className="calendar-bar">
        <button className="icon-button" title="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          <ChevronLeftIcon />
        </button>
        <h3>{monthLabel}</h3>
        <button className="icon-button" title="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          <ChevronRightIcon />
        </button>
        <button
          className="button small"
          onClick={() => {
            const now = new Date();
            setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
          }}
        >
          Today
        </button>
        <span className="calendar-legend">
          <i className="kind-chat" /> Message <i className="kind-status" /> Status <i className="kind-group" /> Group change
        </span>
      </div>
      <div className="calendar-grid">
        {days.slice(0, 7).map((d) => (
          <div key={`h${d.getDay()}`} className="calendar-weekday">
            {weekdayFormat.format(d)}
          </div>
        ))}
        {days.map((day) => {
          const key = dayKey(day);
          const entries = byDay.get(key) ?? [];
          const past = day.getTime() < startOfToday;
          const outside = day.getMonth() !== month.getMonth();
          return (
            <div
              key={key}
              className={`calendar-day${outside ? ' outside' : ''}${key === todayKey ? ' today' : ''}${past ? ' past' : ''}${dragOver === key ? ' drop' : ''}`}
              onDragOver={(e) => {
                if (!past && e.dataTransfer.types.includes('text/x-wapp-schedule')) {
                  e.preventDefault();
                  setDragOver(key);
                }
              }}
              onDragLeave={() => setDragOver((k) => (k === key ? null : k))}
              onDrop={(e) => void moveTo(day, e)}
              onDoubleClick={() => {
                if (past) return;
                const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0).getTime();
                onNewAt(Math.max(at, Date.now() + 15 * 60_000));
              }}
              title={past ? undefined : 'Double-click to schedule on this day'}
            >
              <span className="calendar-date">{day.getDate()}</span>
              {entries.slice(0, MAX_PER_DAY).map((entry) => {
                const draggable = entry.item.status === 'pending' && entry.item.rule.repeat === 'none';
                return (
                  <button
                    key={`${entry.item.id}-${entry.at}`}
                    className={`calendar-entry kind-${entry.item.target} status-${entry.item.status}`}
                    draggable={draggable}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/x-wapp-schedule', String(entry.item.id));
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => (entry.item.status === 'pending' || entry.item.status === 'failed' || entry.item.status === 'missed') && onEdit(entry.item)}
                    title={`${formatTime(entry.at / 1000)} · ${label(entry.item)}${draggable ? '\nDrag to another day to move it.' : ''}`}
                  >
                    <span className="calendar-time">{formatTime(entry.at / 1000)}</span>
                    {entry.item.rule.repeat !== 'none' && <RepeatIcon size={10} />}
                    <span className="calendar-label">{label(entry.item)}</span>
                  </button>
                );
              })}
              {entries.length > MAX_PER_DAY && <span className="calendar-more">+{entries.length - MAX_PER_DAY} more</span>}
            </div>
          );
        })}
      </div>
      <p className="fine-print">
        Repeating items show every upcoming time. Drag a one-off item to another day to move it; double-click a day to
        schedule something on it.
      </p>
    </div>
  );
}
