import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ChatSummary, Repeat } from '../../../shared/types';
import { errorMessage, formatTime, fromLocalInputValue, repeatLabel, toLocalInputValue } from '../format';
import { Avatar } from './Avatar';
import { CloseIcon, SearchIcon } from './Icons';

export interface ScheduleDraft {
  /** Set when editing an existing scheduled message. */
  id?: number;
  chatId?: string;
  body: string;
  sendAt?: number;
  repeat: Repeat;
  /** Called after a successful save. */
  onSaved?: () => void;
}

const REPEATS: Repeat[] = ['none', 'daily', 'weekly', 'monthly'];

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
  const days = ((8 - d.getDay()) % 7) || 7;
  return atHour(days, hour);
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
  const [chatId, setChatId] = useState(draft.chatId ?? '');
  const [picking, setPicking] = useState(!draft.chatId);
  const [query, setQuery] = useState('');
  const [body, setBody] = useState(draft.body);
  const [when, setWhen] = useState(() =>
    toLocalInputValue(draft.sendAt ?? roundUpToFiveMinutes(Date.now() + 60 * 60_000)),
  );
  const [repeat, setRepeat] = useState<Repeat>(draft.repeat);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedChat = chats.find((c) => c.id === chatId);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? chats.filter((c) => c.name.toLowerCase().includes(q) || c.id.includes(q)) : chats;
    return list.slice(0, 50);
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    const sendAt = fromLocalInputValue(when);
    if (!chatId) return setError('Choose who to send the message to.');
    if (!body.trim()) return setError('Write a message.');
    if (Number.isNaN(sendAt)) return setError('Pick a date and time.');
    if (sendAt < Date.now() - 60_000) return setError('Pick a time in the future.');

    setSaving(true);
    setError(null);
    try {
      const input = { chatId, body: body.trim(), sendAt, repeat };
      if (draft.id === undefined) await window.wapp.createScheduled(input);
      else await window.wapp.updateScheduled(draft.id, input);
      draft.onSaved?.();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={submit} aria-labelledby="schedule-title">
        <header className="dialog-header">
          <h2 id="schedule-title">{draft.id === undefined ? 'Schedule a message' : 'Edit scheduled message'}</h2>
          <button type="button" className="icon-button" onClick={onClose} title="Close">
            <CloseIcon />
          </button>
        </header>

        <div className="field">
          <span className="field-label">To</span>
          {picking || !selectedChat ? (
            <div className="picker">
              <div className="search">
                <SearchIcon size={16} />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search chats"
                />
              </div>
              <ul className="picker-list">
                {matches.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={`picker-row${c.id === chatId ? ' selected' : ''}`}
                      onClick={() => {
                        setChatId(c.id);
                        setPicking(false);
                      }}
                    >
                      <Avatar id={c.id} name={c.name} size={28} />
                      <span>{c.name}</span>
                    </button>
                  </li>
                ))}
                {matches.length === 0 && <li className="list-empty">No chats found.</li>}
              </ul>
            </div>
          ) : (
            <div className="picked-chat">
              <Avatar id={selectedChat.id} name={selectedChat.name} size={28} />
              <span>{selectedChat.name}</span>
              <button type="button" className="button link" onClick={() => setPicking(true)}>
                Change
              </button>
            </div>
          )}
        </div>

        <label className="field">
          <span className="field-label">Message</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="Type the message to send"
            autoFocus={!picking && Boolean(selectedChat)}
          />
        </label>

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

        <label className="field">
          <span className="field-label">Repeat</span>
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
            {REPEATS.map((r) => (
              <option key={r} value={r}>
                {repeatLabel(r)}
              </option>
            ))}
          </select>
        </label>

        <p className="fine-print">
          Messages are sent from this computer, so keep WA Premium Plus running (it stays in the tray
          when you close the window).
        </p>

        {error && <p className="error">{error}</p>}

        <footer className="dialog-footer">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving}>
            {saving ? 'Saving…' : draft.id === undefined ? 'Schedule' : 'Save changes'}
          </button>
        </footer>
      </form>
    </div>
  );
}
