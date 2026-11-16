import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { describeRule, nextOccurrence } from '../../../shared/schedule';
import type { AttachmentInfo, ChatSummary, Repeat, RepeatRule, ScheduleTarget } from '../../../shared/types';
import { errorMessage, formatBytes, formatDateTime, formatTime, fromLocalInputValue, toLocalInputValue } from '../format';
import { Avatar } from './Avatar';
import { CloseIcon, FileIcon, PaperclipIcon, SearchIcon } from './Icons';

export interface ScheduleDraft {
  /** Set when editing an existing scheduled message. */
  id?: number;
  target?: ScheduleTarget;
  chatIds: string[];
  body: string;
  sendAt?: number;
  rule?: RepeatRule;
  /** A file picked before opening the dialog (path on disk). */
  attachmentPath?: string;
  /** The current attachment of a scheduled message being edited. */
  existingAttachment?: AttachmentInfo;
  /** Called after a successful save. */
  onSaved?: () => void;
}

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const dayMonth = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' });

function roundUpToFiveMinutes(ms: number): number {
  const step = 5 * 60_000;
  return Math.ceil(ms / step) * step;
}

function atHour(daysFromToday: number, hour: number): number {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

function nextMonday(hour: number): number {
  const d = new Date();
  const days = (8 - d.getDay()) % 7 || 7;
  return atHour(days, hour);
}

/** End of the chosen day, so "until 31 Dec" includes sends on 31 Dec. */
function endOfDay(value: string): number | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 23, 59, 59, 999).getTime();
}

function toDateInput(ms: number): string {
  return toLocalInputValue(ms).slice(0, 10);
}

export function ScheduleDialog({
  draft,
  chats,
  onClose,
}: {
  draft: ScheduleDraft;
  chats: ChatSummary[];
  onClose: () => void;
}) {
  const editing = draft.id !== undefined;
  const [target, setTarget] = useState<ScheduleTarget>(draft.target ?? 'chat');
  const [chatIds, setChatIds] = useState<string[]>(draft.chatIds);
  const [picking, setPicking] = useState(draft.chatIds.length === 0);
  const [query, setQuery] = useState('');
  const [body, setBody] = useState(draft.body);
  const [when, setWhen] = useState(() =>
    toLocalInputValue(draft.sendAt ?? roundUpToFiveMinutes(Date.now() + 60 * 60_000)),
  );
  const [repeat, setRepeat] = useState<Repeat>(draft.rule?.repeat ?? 'none');
  const [interval, setIntervalValue] = useState(draft.rule?.interval ?? 1);
  const [unit, setUnit] = useState<'day' | 'week' | 'month'>(draft.rule?.unit ?? 'week');
  const [weekdays, setWeekdays] = useState<number[]>(draft.rule?.weekdays ?? []);
  const [endDate, setEndDate] = useState(draft.rule?.endAt ? toDateInput(draft.rule.endAt) : '');
  // undefined = keep the existing attachment, null = removed, string = new file
  const [attachmentPath, setAttachmentPath] = useState<string | null | undefined>(draft.attachmentPath);
  const [attachmentName, setAttachmentName] = useState<string | undefined>(
    draft.attachmentPath ? draft.attachmentPath.split(/[\\/]/).pop() : draft.existingAttachment?.name,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const sendAt = fromLocalInputValue(when);
  const anchor = Number.isNaN(sendAt) ? Date.now() : sendAt;
  const anchorDate = new Date(anchor);

  // Default the custom weekly days to the chosen date's weekday.
  useEffect(() => {
    if (repeat === 'custom' && unit === 'week' && weekdays.length === 0) setWeekdays([anchorDate.getDay()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeat, unit]);

  const rule: RepeatRule = useMemo(() => {
    const r: RepeatRule = { repeat };
    if (repeat === 'custom') {
      r.interval = Math.max(1, Math.floor(interval || 1));
      r.unit = unit;
      if (unit === 'week') r.weekdays = [...weekdays].sort();
    }
    if (repeat !== 'none') {
      const end = endOfDay(endDate);
      if (end !== undefined) r.endAt = end;
    }
    return r;
  }, [repeat, interval, unit, weekdays, endDate]);

  const preview = useMemo(() => {
    if (Number.isNaN(sendAt)) return [];
    const times = [sendAt];
    let after = sendAt;
    while (times.length < 4 && rule.repeat !== 'none') {
      const next = nextOccurrence(sendAt, rule, after);
      if (next === null) break;
      times.push(next);
      after = next;
    }
    return times;
  }, [sendAt, rule]);

  const selected = chatIds.map((id) => chats.find((c) => c.id === id) ?? { id, name: id, isGroup: false, unreadCount: 0 });
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? chats.filter((c) => c.name.toLowerCase().includes(q) || c.id.includes(q)) : chats;
    return list.slice(0, 60);
  }, [chats, query]);

  const presets = [
    { label: 'In 1 hour', at: () => roundUpToFiveMinutes(Date.now() + 60 * 60_000) },
    { label: `Tomorrow, ${formatTime(atHour(1, 9) / 1000)}`, at: () => atHour(1, 9) },
    { label: `Monday, ${formatTime(nextMonday(9) / 1000)}`, at: () => nextMonday(9) },
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function toggleChat(id: string) {
    if (editing) {
      setChatIds([id]);
      setPicking(false);
      return;
    }
    setChatIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (target === 'chat' && chatIds.length === 0) return setError('Choose who to send the message to.');
    const hasAttachment = attachmentPath ? true : attachmentPath === undefined && Boolean(attachmentName);
    if (!body.trim() && !hasAttachment) return setError('Write a message or attach a file.');
    if (Number.isNaN(sendAt)) return setError('Pick a date and time.');
    if (sendAt < Date.now() - 60_000) return setError('Pick a time in the future.');
    if (repeat === 'custom' && unit === 'week' && weekdays.length === 0) return setError('Pick at least one day.');

    setSaving(true);
    setError(null);
    try {
      const input = { target, chatIds: target === 'status' ? [] : chatIds, body: body.trim(), sendAt, rule, attachmentPath };
      if (draft.id === undefined) await window.wapp.createScheduled(input);
      else await window.wapp.updateScheduled(draft.id, input);
      draft.onSaved?.();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  const repeatOptions: Array<[Repeat, string]> = [
    ['none', 'Does not repeat'],
    ['daily', 'Every day'],
    ['weekdays', 'Every weekday (Mon–Fri)'],
    ['weekly', `Every week on ${weekday.format(anchorDate)}`],
    ['monthly', `Every month on day ${anchorDate.getDate()}`],
    ['yearly', `Every year on ${dayMonth.format(anchorDate)}`],
    ['custom', 'Custom…'],
  ];

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={submit} aria-labelledby="schedule-title">
        <header className="dialog-header">
          <h2 id="schedule-title">{editing ? 'Edit scheduled message' : 'Schedule a message'}</h2>
          <button type="button" className="icon-button" onClick={onClose} title="Close">
            <CloseIcon />
          </button>
        </header>

        <div className="segmented" role="tablist">
          <button type="button" className={target === 'chat' ? 'active' : ''} onClick={() => setTarget('chat')}>
            Send to chats
          </button>
          <button type="button" className={target === 'status' ? 'active' : ''} onClick={() => setTarget('status')}>
            Post to my status
          </button>
        </div>

        {target === 'chat' ? (
          <div className="field">
            <span className="field-label">
              To{!editing && chatIds.length > 1 ? ` · ${chatIds.length} chats (each gets its own copy)` : ''}
            </span>
            {selected.length > 0 && (
              <div className="recipient-chips">
                {selected.map((c) => (
                  <span key={c.id} className="recipient-chip">
                    <Avatar id={c.id} name={c.name} size={22} />
                    {c.name}
                    {!editing && (
                      <button type="button" title="Remove" onClick={() => toggleChat(c.id)}>
                        <CloseIcon size={12} />
                      </button>
                    )}
                  </span>
                ))}
                {!picking && (
                  <button type="button" className="button link" onClick={() => setPicking(true)}>
                    {editing ? 'Change' : 'Add more'}
                  </button>
                )}
              </div>
            )}
            {picking && (
              <div className="picker">
                <div className="search">
                  <SearchIcon size={16} />
                  <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" />
                </div>
                <ul className="picker-list">
                  {matches.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={`picker-row${chatIds.includes(c.id) ? ' selected' : ''}`}
                        onClick={() => toggleChat(c.id)}
                      >
                        {!editing && <input type="checkbox" readOnly checked={chatIds.includes(c.id)} tabIndex={-1} />}
                        <Avatar id={c.id} name={c.name} size={28} />
                        <span>{c.name}</span>
                      </button>
                    </li>
                  ))}
                  {matches.length === 0 && <li className="list-empty">No chats found.</li>}
                </ul>
                {chatIds.length > 0 && (
                  <button type="button" className="button small picker-done" onClick={() => setPicking(false)}>
                    Done
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="hint">
            Your status is shared with your saved contacts and disappears after 24 hours. Text statuses use a green
            background.
          </p>
        )}

        <label className="field">
          <span className="field-label">{attachmentName && attachmentPath !== null ? 'Caption' : 'Message'}</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder={target === 'status' ? 'What would you like to share?' : 'Type the message to send'}
          />
        </label>

        <div className="field">
          <span className="field-label">Attachment</span>
          {attachmentName && attachmentPath !== null ? (
            <div className="picked-file">
              <FileIcon size={18} />
              <span>{attachmentName}</span>
              {draft.existingAttachment && attachmentPath === undefined && (
                <small className="muted">{formatBytes(draft.existingAttachment.size)}</small>
              )}
              <button
                type="button"
                className="button link"
                onClick={() => {
                  setAttachmentPath(null);
                  setAttachmentName(undefined);
                }}
              >
                Remove
              </button>
            </div>
          ) : (
            <button type="button" className="button attach-button" onClick={() => fileInput.current?.click()}>
              <PaperclipIcon size={16} /> Attach a photo, video or document
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setAttachmentPath(window.wapp.getPathForFile(file));
                setAttachmentName(file.name);
              }
              e.target.value = '';
            }}
          />
        </div>

        <div className="field">
          <span className="field-label">When</span>
          <div className="presets">
            {presets.map((p) => (
              <button key={p.label} type="button" className="chip" onClick={() => setWhen(toLocalInputValue(p.at()))}>
                {p.label}
              </button>
            ))}
          </div>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>

        <div className="field">
          <span className="field-label">Repeat</span>
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
            {repeatOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {repeat === 'custom' && (
            <div className="custom-repeat">
              <span>Every</span>
              <input
                type="number"
                min={1}
                max={365}
                value={interval}
                onChange={(e) => setIntervalValue(Number(e.target.value))}
              />
              <select value={unit} onChange={(e) => setUnit(e.target.value as 'day' | 'week' | 'month')}>
                <option value="day">{interval === 1 ? 'day' : 'days'}</option>
                <option value="week">{interval === 1 ? 'week' : 'weeks'}</option>
                <option value="month">{interval === 1 ? 'month' : 'months'}</option>
              </select>
              {unit === 'week' && (
                <div className="weekday-toggles">
                  {DAY_LETTERS.map((letter, day) => (
                    <button
                      key={day}
                      type="button"
                      title={DAY_NAMES[day]}
                      className={weekdays.includes(day) ? 'active' : ''}
                      onClick={() =>
                        setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]))
                      }
                    >
                      {letter}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {repeat !== 'none' && (
            <label className="ends">
              <span>Ends</span>
              <input
                type="date"
                value={endDate}
                min={toDateInput(anchor)}
                onChange={(e) => setEndDate(e.target.value)}
              />
              {endDate ? (
                <button type="button" className="button link" onClick={() => setEndDate('')}>
                  Never end
                </button>
              ) : (
                <span className="muted">Never (pick a date to stop)</span>
              )}
            </label>
          )}
        </div>

        {preview.length > 0 && (
          <div className="schedule-preview">
            <strong>{describeRule(rule, anchor)}</strong>
            <span className="muted">
              {preview.length === 1 ? 'Sends ' : 'Next sends: '}
              {preview.map((t) => formatDateTime(t)).join(' · ')}
              {rule.repeat !== 'none' && preview.length === 4 ? ' …' : ''}
            </span>
          </div>
        )}

        <p className="fine-print">
          Messages are sent from this computer, so keep WA Premium Plus running (it stays in the tray when you close the
          window).
        </p>

        {error && <p className="error">{error}</p>}

        <footer className="dialog-footer">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving}>
            {saving
              ? 'Saving…'
              : editing
                ? 'Save changes'
                : target === 'chat' && chatIds.length > 1
                  ? `Schedule for ${chatIds.length} chats`
                  : 'Schedule'}
          </button>
        </footer>
      </form>
    </div>
  );
}
