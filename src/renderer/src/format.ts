import type { MessageKind } from '../../shared/types';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const shortDateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const longDateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const dateTimeWithYearFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/** Chat list time: a time today, "Yesterday", or a short date. */
export function formatChatTime(seconds: number): string {
  const date = new Date(seconds * 1000);
  const now = new Date();
  if (isSameDay(date, now)) return timeFormat.format(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return shortDateFormat.format(date);
}

export function formatTime(seconds: number): string {
  return timeFormat.format(new Date(seconds * 1000));
}

/** Day separator label in a conversation. */
export function formatDay(seconds: number): string {
  const date = new Date(seconds * 1000);
  const now = new Date();
  if (isSameDay(date, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return longDateFormat.format(date);
}

export function formatDateTime(ms: number): string {
  const date = new Date(ms);
  return date.getFullYear() === new Date().getFullYear()
    ? dateTimeFormat.format(date)
    : dateTimeWithYearFormat.format(date);
}

/** Like formatDateTime, in another time zone. */
export function formatDateTimeIn(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(ms));
}

/** "in 2 hours", "tomorrow", "in 3 days", "5 minutes ago" */
export function formatRelative(ms: number, now = Date.now()): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  // Beyond a few hours, count calendar days: Wednesday 7:00 seen on Monday evening is
  // "in 2 days", even though it's only about 37 hours away.
  const startOfDay = (t: number) => new Date(new Date(t).toDateString()).getTime();
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / 86_400_000);
  if (days !== 0 && abs >= 6 * 3_600_000) return relativeFormat.format(days, 'day');
  if (abs >= 3_600_000) return relativeFormat.format(Math.round(diff / 3_600_000), 'hour');
  if (abs >= 60_000) return relativeFormat.format(Math.round(diff / 60_000), 'minute');
  return diff >= 0 ? 'in less than a minute' : 'just now';
}

const KIND_LABELS: Record<MessageKind, string> = {
  text: 'Message',
  image: 'Photo',
  video: 'Video',
  audio: 'Voice message',
  document: 'Document',
  sticker: 'Sticker',
  location: 'Location',
  contact: 'Contact',
  poll: 'Poll',
  call: 'Call',
  deleted: 'This message was deleted',
  other: 'Message',
};

export function kindLabel(kind: MessageKind): string {
  return KIND_LABELS[kind];
}

/** Text without WhatsApp's formatting markers (*bold*, _italic_, ~strike~, ```code```), for previews. */
export function plainText(text: string): string {
  return text
    .replace(/```([\s\S]+?)```/g, '$1')
    .replace(/(^|[\s(])([*_~])(\S(?:[^\n]*?\S)?)\2(?=[\s).,!?:;]|$)/g, '$1$3');
}

export function messagePreview({ kind, body: raw }: { kind: MessageKind; body: string }): string {
  const body = plainText(raw);
  if (kind === 'text' || kind === 'call' || (kind === 'other' && body)) return body;
  if (kind === 'deleted') return kindLabel(kind);
  return body ? `${kindLabel(kind)}: ${body}` : kindLabel(kind);
}

export function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** 75 -> "1:15" */
export function formatDuration(seconds: number | undefined): string {
  const s = Math.max(0, Math.round(seconds ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "919876543210@s.whatsapp.net" -> "+919876543210"; privacy IDs aren't phone numbers. */
export function formatId(id: string | undefined): string {
  if (!id) return '';
  const [user = id, server] = id.split('@');
  if (server === 'lid') return 'WhatsApp user';
  if (server === 'newsletter') return 'Channel';
  if (server === 'g.us') return 'Group';
  return /^\d+$/.test(user) ? `+${user}` : user;
}

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '#';
  const letters = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : words[0]!.slice(0, 2);
  return letters.toUpperCase();
}

/** Strips Electron's "Error invoking remote method ..." prefix from IPC errors. */
export function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

/** Unix ms -> value for <input type="datetime-local"> in local time. */
export function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Value of <input type="datetime-local"> -> Unix ms (NaN if empty or invalid). */
export function fromLocalInputValue(value: string): number {
  return value ? new Date(value).getTime() : Number.NaN;
}
