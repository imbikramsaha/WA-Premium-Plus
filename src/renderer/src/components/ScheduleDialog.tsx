import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { describeGroupAction, EPHEMERAL_OPTIONS, GROUP_ACTION_TYPES, inverseGroupAction } from '../../../shared/group-actions';
import { describeRule, firstOccurrence, nextOccurrence } from '../../../shared/schedule';
import { formatWallTime, localZone, parseWallTime, sameZone, zoneCity, zoneForPhone } from '../../../shared/timezones';
import type { AttachmentInfo, ChatSummary, GroupAction, Repeat, RepeatRule, ScheduleTarget } from '../../../shared/types';
import { errorMessage, formatBytes, formatDateTime, formatDateTimeIn, formatTime, fromLocalInputValue, toLocalInputValue } from '../format';
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
  /** For group settings changes. */
  groupAction?: GroupAction;
  /** Called after a successful save. */
  onSaved?: () => void;
}

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ALL_ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf('timeZone');
  } catch {
    return [];
  }
})();

/** 'mine' = this computer's zone; 'recipient' = each person's zone from their number; or an IANA zone. */
type ZoneMode = 'mine' | 'recipient' | string;

function zoneFor(mode: ZoneMode, chatId: string | undefined): string | undefined {
  if (mode === 'mine') return undefined;
  if (mode === 'recipient') return chatId ? zoneForPhone(chatId)?.zone : undefined;
  return mode;
}

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

function defaultAction(type: GroupAction['type']): GroupAction {
  switch (type) {
    case 'announce':
    case 'restrict':
    case 'joinApproval':
      return { type, enabled: true };
    case 'memberAdd':
      return { type, adminsOnly: true };
    case 'ephemeral':
      return { type, seconds: 86_400 };
    case 'subject':
    case 'description':
      return { type, text: '' };
    case 'revokeInvite':
      return { type };
  }
}

/** The switch-back time: the given time of day on the change's day, or the next day if earlier. */
function revertTimeAfter(changeAt: number, timeOfDay: string): number {
  const [h = 0, m = 0] = timeOfDay.split(':').map(Number);
  const d = new Date(changeAt);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= changeAt) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Two-option toggle in the dialog's segmented style. */
function Choice({ options, value, onChange }: { options: Array<[string, boolean]>; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="segmented">
      {options.map(([label, v]) => (
        <button key={label} type="button" className={value === v ? 'active' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function GroupActionFields({ action, onChange }: { action: GroupAction; onChange: (a: GroupAction) => void }) {
  return (
    <>
      <label className="field">
        <span className="field-label">Setting to change</span>
        <select value={action.type} onChange={(e) => onChange(defaultAction(e.target.value as GroupAction['type']))}>
          {GROUP_ACTION_TYPES.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span className="field-label">Change it to</span>
        {(action.type === 'announce' || action.type === 'restrict') && (
          <Choice
            options={[['Only admins', true], ['Everyone', false]]}
            value={action.enabled}
            onChange={(enabled) => onChange({ type: action.type, enabled })}
          />
        )}
        {action.type === 'memberAdd' && (
          <Choice
            options={[['Only admins', true], ['Everyone', false]]}
            value={action.adminsOnly}
            onChange={(adminsOnly) => onChange({ type: 'memberAdd', adminsOnly })}
          />
        )}
        {action.type === 'joinApproval' && (
          <Choice
            options={[['On', true], ['Off', false]]}
            value={action.enabled}
            onChange={(enabled) => onChange({ type: 'joinApproval', enabled })}
          />
        )}
        {action.type === 'ephemeral' && (
          <select value={action.seconds} onChange={(e) => onChange({ type: 'ephemeral', seconds: Number(e.target.value) })}>
            {EPHEMERAL_OPTIONS.map((o) => (
              <option key={o.seconds} value={o.seconds}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {action.type === 'subject' && (
          <input
            value={action.text}
            maxLength={100}
            placeholder="New group name"
            onChange={(e) => onChange({ type: 'subject', text: e.target.value })}
          />
        )}
        {action.type === 'description' && (
          <textarea
            rows={3}
            value={action.text}
            maxLength={2048}
            placeholder="New description (leave empty to clear it)"
            onChange={(e) => onChange({ type: 'description', text: e.target.value })}
          />
        )}
        {action.type === 'revokeInvite' && (
          <p className="muted small">The current invite link stops working and WhatsApp makes a new one.</p>
        )}
      </div>
    </>
  );
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
  const [zoneMode, setZoneMode] = useState<ZoneMode>(draft.rule?.timeZone ?? 'mine');
  const [when, setWhen] = useState(() => {
    const at = draft.sendAt ?? roundUpToFiveMinutes(Date.now() + 60 * 60_000);
    return draft.rule?.timeZone ? formatWallTime(at, draft.rule.timeZone) : toLocalInputValue(at);
  });
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
  const [action, setAction] = useState<GroupAction>(draft.groupAction ?? defaultAction('announce'));
  const [revertOn, setRevertOn] = useState(false);
  const [revertTime, setRevertTime] = useState('07:00');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const isGroup = target === 'group';
  const inverse = inverseGroupAction(action);

  // Time zones apply to messages to people; statuses and group changes use this computer's time.
  const effectiveMode: ZoneMode = target === 'chat' ? zoneMode : 'mine';
  const zone = zoneFor(effectiveMode, chatIds[0]);
  const sendAt = zone ? parseWallTime(when, zone) : fromLocalInputValue(when);
  const anchor = Number.isNaN(sendAt) ? Date.now() : sendAt;
  const anchorDate = new Date(anchor);
  const zoneDate = zone ? new Date(parseWallTime(formatWallTime(anchor, zone).slice(0, 10) + 'T12:00', localZone())) : anchorDate;
  const recipientZones = useMemo(() => {
    const zones = new Map<string, { names: string[]; uncertain: boolean }>();
    for (const id of chatIds) {
      const guess = zoneForPhone(id);
      // People in our own time zone don't need a choice.
      if (!guess || sameZone(guess.zone, localZone())) continue;
      const entry = zones.get(guess.zone) ?? { names: [], uncertain: false };
      entry.names.push(chats.find((c) => c.id === id)?.name ?? id);
      entry.uncertain ||= guess.uncertain;
      zones.set(guess.zone, entry);
    }
    return zones;
  }, [chatIds, chats]);

  // Default the custom weekly days to the chosen date's weekday.
  useEffect(() => {
    if (repeat === 'custom' && unit === 'week' && weekdays.length === 0) setWeekdays([zoneDate.getDay()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeat, unit]);

  const rule: RepeatRule = useMemo(() => {
    const r: RepeatRule = { repeat };
    if (zone) r.timeZone = zone;
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
  }, [repeat, interval, unit, weekdays, endDate, zone]);

  const preview = useMemo(() => {
    if (Number.isNaN(sendAt)) return [];
    const first = firstOccurrence(sendAt, rule);
    const times = [first];
    let after = first;
    while (times.length < 4 && rule.repeat !== 'none') {
      const next = nextOccurrence(sendAt, rule, after);
      if (next === null) break;
      times.push(next);
      after = next;
    }
    return times;
  }, [sendAt, rule]);

  const revertAt = isGroup && revertOn && inverse && !editing && !Number.isNaN(sendAt) ? revertTimeAfter(sendAt, revertTime) : undefined;
  const revertPreview = useMemo(() => {
    if (revertAt === undefined) return [];
    const first = firstOccurrence(revertAt, rule);
    const times = [first];
    let after = first;
    while (times.length < 3 && rule.repeat !== 'none') {
      const next = nextOccurrence(revertAt, rule, after);
      if (next === null) break;
      times.push(next);
      after = next;
    }
    return times;
  }, [revertAt, rule]);

  const selected = chatIds.map((id) => chats.find((c) => c.id === id) ?? { id, name: id, isGroup: false, unreadCount: 0 });
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = isGroup ? chats.filter((c) => c.isGroup) : chats;
    const list = q ? pool.filter((c) => c.name.toLowerCase().includes(q) || c.id.includes(q)) : pool;
    return list.slice(0, 60);
  }, [chats, query, isGroup]);

  function switchTarget(next: ScheduleTarget) {
    setTarget(next);
    setError(null);
    // Group changes only apply to groups; drop chats that aren't.
    if (next === 'group') {
      setChatIds((prev) => {
        const kept = prev.filter((id) => id.endsWith('@g.us'));
        if (kept.length === 0) setPicking(true);
        return kept;
      });
    }
  }

  const presets = [
    { label: 'In 1 hour', at: () => roundUpToFiveMinutes(Date.now() + 60 * 60_000), relative: true },
    { label: `Tomorrow, ${formatTime(atHour(1, 9) / 1000)}`, at: () => atHour(1, 9), relative: false },
    { label: `Monday, ${formatTime(nextMonday(9) / 1000)}`, at: () => nextMonday(9), relative: false },
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
    if (isGroup && chatIds.length === 0) return setError('Choose at least one group.');
    if (isGroup && action.type === 'subject' && !action.text.trim()) return setError('Enter the new group name.');
    const hasAttachment = attachmentPath ? true : attachmentPath === undefined && Boolean(attachmentName);
    if (!isGroup && !body.trim() && !hasAttachment) return setError('Write a message or attach a file.');
    if (Number.isNaN(sendAt)) return setError('Pick a date and time.');
    if (sendAt < Date.now() - 60_000) return setError('Pick a time in the future.');
    if (repeat === 'custom' && unit === 'week' && weekdays.length === 0) return setError('Pick at least one day.');

    setSaving(true);
    setError(null);
    try {
      // With a time zone, the main process works out each recipient's send time from the wall time.
      const zoned =
        effectiveMode === 'mine'
          ? {}
          : { wallTime: when, timeZone: editing ? (zone ?? localZone()) : effectiveMode };
      const input = isGroup
        ? { target, chatIds, body: '', sendAt, rule, groupAction: action, revertAt }
        : { target, chatIds: target === 'status' ? [] : chatIds, body: body.trim(), sendAt, rule, attachmentPath, ...zoned };
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
    ['weekly', `Every week on ${new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(zoneDate)}`],
    ['monthly', `Every month on day ${zoneDate.getDate()}`],
    ['yearly', `Every year on ${new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' }).format(zoneDate)}`],
    ['custom', 'Custom…'],
  ];

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={submit} aria-labelledby="schedule-title">
        <header className="dialog-header">
          <h2 id="schedule-title">
            {isGroup ? (editing ? 'Edit group change' : 'Schedule a group change') : editing ? 'Edit scheduled message' : 'Schedule a message'}
          </h2>
          <button type="button" className="icon-button" onClick={onClose} title="Close">
            <CloseIcon />
          </button>
        </header>

        {!(editing && isGroup) && (
          <div className="segmented" role="tablist">
            <button type="button" className={target === 'chat' ? 'active' : ''} onClick={() => switchTarget('chat')}>
              Message
            </button>
            <button type="button" className={target === 'status' ? 'active' : ''} onClick={() => switchTarget('status')}>
              My status
            </button>
            {!editing && (
              <button type="button" className={isGroup ? 'active' : ''} onClick={() => switchTarget('group')}>
                Group settings
              </button>
            )}
          </div>
        )}

        {target !== 'status' ? (
          <div className="field">
            <span className="field-label">
              {isGroup ? 'Groups' : 'To'}
              {!editing && chatIds.length > 1
                ? isGroup
                  ? ` · ${chatIds.length} groups`
                  : ` · ${chatIds.length} chats (each gets its own copy)`
                : ''}
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
                  <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={isGroup ? 'Search groups' : 'Search chats'} />
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
                  {matches.length === 0 && <li className="list-empty">{isGroup ? 'No groups found.' : 'No chats found.'}</li>}
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

        {isGroup ? (
          <>
            <GroupActionFields action={action} onChange={setAction} />
            <p className="hint">
              You need to be an admin of the group. The change is made from this computer at the scheduled time.
            </p>
          </>
        ) : (
        <>
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
        </>
        )}

        <div className="field">
          <span className="field-label">When</span>
          <div className="presets">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                className="chip"
                onClick={() => setWhen(zone && p.relative ? formatWallTime(p.at(), zone) : toLocalInputValue(p.at()))}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="when-row">
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            {target === 'chat' && (
              <select
                value={zoneMode}
                title="Time zone"
                onChange={(e) => {
                  const next = e.target.value;
                  // Keep the same moment when switching zones.
                  const nextZone = zoneFor(next, chatIds[0]);
                  if (!Number.isNaN(sendAt)) setWhen(nextZone ? formatWallTime(sendAt, nextZone) : toLocalInputValue(sendAt));
                  setZoneMode(next);
                }}
              >
                <option value="mine">My time ({zoneCity(localZone())})</option>
                {recipientZones.size > 0 && (
                  <option value="recipient">
                    {chatIds.length > 1 ? "Each recipient's time" : `Their time (${zoneCity([...recipientZones.keys()][0]!)})`}
                  </option>
                )}
                <optgroup label="Other time zones">
                  {ALL_ZONES.map((z) => (
                    <option key={z} value={z}>
                      {z.replaceAll('_', ' ')}
                    </option>
                  ))}
                </optgroup>
              </select>
            )}
          </div>
          {zone && !sameZone(zone, localZone()) && !Number.isNaN(sendAt) && (
            <span className="hint">
              {effectiveMode === 'recipient' && chatIds.length > 1
                ? `Each person gets it at ${when.slice(11)} their time: ${[...recipientZones.entries()]
                    .map(([z, e]) => `${zoneCity(z)}${e.uncertain ? ' (guessed from the country code; check)' : ''}`)
                    .join(', ')}${chatIds.some((id) => !zoneForPhone(id)) ? ', and your time for the rest' : ''}.`
                : `${formatDateTimeIn(sendAt, zone)} in ${zoneCity(zone)} is ${formatDateTime(sendAt)} your time.${
                    effectiveMode === 'recipient' && [...recipientZones.values()][0]?.uncertain
                      ? ' The zone is guessed from the country code; pick another if needed.'
                      : ''
                  }`}
            </span>
          )}
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

        {isGroup && inverse && !editing && (
          <div className="field">
            <label className="check-row">
              <input type="checkbox" checked={revertOn} onChange={(e) => setRevertOn(e.target.checked)} />
              <span>Switch back automatically</span>
            </label>
            {revertOn && (
              <div className="revert-row">
                <span>At</span>
                <input type="time" value={revertTime} onChange={(e) => setRevertTime(e.target.value)} />
                <span className="muted">→ {describeGroupAction(inverse)}</span>
              </div>
            )}
          </div>
        )}

        {preview.length > 0 && (
          <div className="schedule-preview">
            <strong>
              {isGroup ? `${describeGroupAction(action)} · ` : ''}
              {describeRule(rule, anchor)}
            </strong>
            <span className="muted">
              {preview.length === 1 ? (isGroup ? 'Changes ' : 'Sends ') : isGroup ? 'Next changes: ' : 'Next sends: '}
              {preview.map((t) => (zone ? `${formatDateTimeIn(t, zone)} (${zoneCity(zone)})` : formatDateTime(t))).join(' · ')}
              {rule.repeat !== 'none' && preview.length === 4 ? ' …' : ''}
            </span>
            {revertPreview.length > 0 && inverse && (
              <span className="muted">
                Switches back ({describeGroupAction(inverse).toLowerCase()}): {revertPreview.map((t) => formatDateTime(t)).join(' · ')}
                {rule.repeat !== 'none' && revertPreview.length === 3 ? ' …' : ''}
              </span>
            )}
          </div>
        )}

        <p className="fine-print">
          {isGroup ? 'Changes are made' : 'Messages are sent'} from this computer, so keep WA Premium Plus running (it
          stays in the tray when you close the window).
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
                : chatIds.length > 1 && target !== 'status'
                  ? `Schedule for ${chatIds.length} ${isGroup ? 'groups' : 'chats'}`
                  : isGroup && revertAt !== undefined
                    ? 'Schedule both changes'
                    : 'Schedule'}
          </button>
        </footer>
      </form>
    </div>
  );
}
