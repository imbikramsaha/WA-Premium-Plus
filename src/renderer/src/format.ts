import type { MessageKind, Repeat } from '../../shared/types';

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

/** "in 2 hours", "in 3 days", "5 minutes ago" */
export function formatRelative(ms: number): string {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, size] of units) {
    if (abs >= size) return relativeFormat.format(Math.round(diff / size), unit);
  }
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
  other: 'Unsupported message',
};

export function kindLabel(kind: MessageKind): string {
  return KIND_LABELS[kind];
}

export function messagePreview({ kind, body }: { kind: MessageKind; body: string }): string {
  if (kind === 'text') return body;
  return body ? `${kindLabel(kind)}: ${body}` : kindLabel(kind);
}

const REPEAT_LABELS: Record<Repeat, string> = {
  none: 'Does not repeat',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
};

export function repeatLabel(repeat: Repeat): string {
  return REPEAT_LABELS[repeat];
}

/** "919876543210@s.whatsapp.net" -> "+919876543210" */
export function formatId(id: string | undefined): string {
  if (!id) return '';
  const user = id.split('@')[0] ?? id;
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
