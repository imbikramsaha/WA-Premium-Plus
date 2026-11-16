// Exporting chats as text (like WhatsApp's own export), HTML, CSV or JSON, optionally with
// the media files already downloaded to this computer.

import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toCsv } from '../shared/csv.ts';
import type { ChatMessage, ExportFormat, MessageKind } from '../shared/types.ts';
import { fallbackName, type Store } from './store.ts';

const KIND_NAMES: Partial<Record<MessageKind, string>> = {
  image: 'Photo',
  video: 'Video',
  audio: 'Audio',
  document: 'Document',
  sticker: 'Sticker',
  location: 'Location',
  contact: 'Contact',
  poll: 'Poll',
  call: 'Call',
};

/** A name that's safe as a file or folder name on every system. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return (cleaned || 'Chat').slice(0, 80);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dateParts(seconds: number): { date: string; time: string } {
  const d = new Date(seconds * 1000);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` };
}

export interface ExportedMessage {
  message: ChatMessage;
  sender: string;
  /** File name in the export's media folder, when the media is included. */
  file?: string;
}

/** Plain-text description of what a message contains, besides its text. */
export function messageContent(m: ChatMessage): string {
  if (m.kind === 'deleted') return 'This message was deleted';
  const parts: string[] = [];
  if (m.poll) {
    parts.push(`Poll: ${m.body}`);
    for (const o of m.poll.options) parts.push(`  - ${o.name} (${o.count})`);
    return parts.join('\n');
  }
  if (m.location) {
    const where = [m.location.name, m.location.address].filter(Boolean).join(', ');
    return `Location: ${where ? `${where} ` : ''}https://www.openstreetmap.org/?mlat=${m.location.lat}&mlon=${m.location.lng}`;
  }
  if (m.contacts) return m.contacts.map((c) => `Contact: ${c.name} ${c.phones.map((p) => p.number).join(', ')}`.trim()).join('\n');
  const kind = KIND_NAMES[m.kind];
  if (kind && m.kind !== 'call') {
    const name = m.media?.fileName ? `: ${m.media.fileName}` : '';
    parts.push(`<${kind}${name}>`);
    if (m.body && m.kind !== 'document') parts.push(m.body);
    return parts.join(' ');
  }
  return m.body || (kind ?? '');
}

export function toText(chatName: string, rows: ExportedMessage[]): string {
  const lines = [`WhatsApp chat with ${chatName}`, `Exported by WA Premium Plus on ${new Date().toLocaleString()}`, ''];
  for (const { message: m, sender, file } of rows) {
    const { date, time } = dateParts(m.timestamp);
    const content = file ? `${messageContent(m)} (file: media/${file})` : messageContent(m);
    const quote = m.quoted ? `[replying to "${m.quoted.body.slice(0, 60)}"] ` : '';
    const forwarded = m.forwarded ? '[forwarded] ' : '';
    lines.push(`[${date} ${time}] ${sender}: ${forwarded}${quote}${content}${m.edited ? ' (edited)' : ''}`);
  }
  return lines.join('\n') + '\n';
}

export function toCsvExport(rows: ExportedMessage[]): string {
  return toCsv([
    ['date', 'time', 'sender', 'from_me', 'type', 'text', 'file', 'reply_to', 'forwarded', 'edited'],
    ...rows.map(({ message: m, sender, file }) => {
      const { date, time } = dateParts(m.timestamp);
      return [date, time, sender, m.fromMe, m.kind, m.kind === 'text' ? m.body : messageContent(m), file ? `media/${file}` : '', m.quoted?.body ?? '', Boolean(m.forwarded), Boolean(m.edited)];
    }),
  ]);
}

export function toJson(chat: { id: string; name: string }, rows: ExportedMessage[]): string {
  return JSON.stringify(
    {
      chat,
      exportedAt: new Date().toISOString(),
      exportedBy: 'WA Premium Plus',
      messages: rows.map(({ message: m, sender, file }) => ({
        id: m.id,
        timestamp: new Date(m.timestamp * 1000).toISOString(),
        sender,
        fromMe: m.fromMe,
        type: m.kind,
        text: m.body,
        file: file ? `media/${file}` : undefined,
        media: m.media ? { mimetype: m.media.mimetype, fileName: m.media.fileName, size: m.media.size, seconds: m.media.seconds } : undefined,
        replyTo: m.quoted ? { id: m.quoted.id, text: m.quoted.body } : undefined,
        forwarded: m.forwarded || undefined,
        edited: m.edited || undefined,
        reactions: m.reactions,
        poll: m.poll,
        location: m.location ? { ...m.location, thumb: undefined } : undefined,
        contacts: m.contacts,
      })),
    },
    null,
    2,
  );
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function toHtml(chatName: string, rows: ExportedMessage[], isGroup: boolean): string {
  let lastDay = '';
  const body = rows
    .map(({ message: m, sender, file }) => {
      const { date, time } = dateParts(m.timestamp);
      const day = date !== lastDay ? `<div class="day">${escapeHtml(new Date(m.timestamp * 1000).toDateString())}</div>` : '';
      lastDay = date;
      const media =
        file && (m.kind === 'image' || m.kind === 'sticker')
          ? `<img src="media/${encodeURI(file)}" alt="">`
          : file && m.kind === 'video'
            ? `<video src="media/${encodeURI(file)}" controls></video>`
            : file && m.kind === 'audio'
              ? `<audio src="media/${encodeURI(file)}" controls></audio>`
              : file
                ? `<a href="media/${encodeURI(file)}">${escapeHtml(m.media?.fileName ?? file)}</a>`
                : '';
      const text = media && m.kind !== 'document' ? m.body : file ? '' : messageContent(m);
      const quote = m.quoted ? `<div class="quote">${escapeHtml(m.quoted.body || m.quoted.kind)}</div>` : '';
      return `${day}<div class="row ${m.fromMe ? 'out' : 'in'}"><div class="bubble">${
        isGroup && !m.fromMe ? `<div class="who">${escapeHtml(sender)}</div>` : ''
      }${m.forwarded ? '<div class="fwd">Forwarded</div>' : ''}${quote}${media}${text ? `<div class="text">${escapeHtml(text)}</div>` : ''}<div class="time">${time.slice(0, 5)}${m.edited ? ' · edited' : ''}</div></div></div>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(chatName)} · WhatsApp chat</title>
<style>
:root{color-scheme:light dark;--bg:#efefe7;--in:#fff;--out:#ecebbe;--text:#1c1c17;--muted:#8c8a7f;--accent:#66641a}
@media (prefers-color-scheme:dark){:root{--bg:#10100e;--in:#1f1f1b;--out:#37361f;--text:#f1f0e8;--muted:#76746a;--accent:#dddc8c}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
header{position:sticky;top:0;padding:14px 20px;background:var(--in);border-bottom:1px solid rgb(0 0 0/.08)}
header h1{margin:0;font-size:18px}header p{margin:2px 0 0;color:var(--muted);font-size:13px}
main{max-width:860px;margin:0 auto;padding:16px}
.day{margin:16px auto 8px;width:max-content;padding:3px 10px;border-radius:8px;background:var(--in);color:var(--muted);font-size:12px}
.row{display:flex;margin:3px 0}.row.out{justify-content:flex-end}
.bubble{max-width:70%;padding:6px 10px;border-radius:12px;background:var(--in);box-shadow:0 1px 1px rgb(0 0 0/.06)}
.out .bubble{background:var(--out)}
.who{font-size:12.5px;font-weight:600;color:var(--accent)}.fwd{font-size:12px;font-style:italic;color:var(--muted)}
.quote{margin:2px 0 4px;padding:4px 8px;border-left:3px solid var(--accent);border-radius:4px;background:rgb(0 0 0/.05);font-size:13px;color:var(--muted)}
.text{white-space:pre-wrap;overflow-wrap:anywhere}.time{text-align:right;font-size:11px;color:var(--muted)}
img,video{display:block;max-width:100%;border-radius:8px;margin:2px 0}audio{width:260px}a{color:inherit}
</style></head>
<body><header><h1>${escapeHtml(chatName)}</h1><p>${rows.length} messages · exported by WA Premium Plus on ${escapeHtml(new Date().toLocaleString())}</p></header>
<main>
${body}
</main></body></html>
`;
}

export interface ExportResult {
  /** The chat file that was written. */
  path: string;
  messages: number;
  mediaCopied: number;
}

/**
 * Writes one chat's export. With media, `target` is a folder that gets the chat file and a
 * media folder; without, it's the chat file itself.
 */
export async function exportChat(
  store: Store,
  mediaDir: string,
  meName: string,
  chatId: string,
  format: ExportFormat,
  includeMedia: boolean,
  target: string,
): Promise<ExportResult> {
  const chatName = store.chatName(chatId) || fallbackName(chatId);
  const isGroup = chatId.endsWith('@g.us');
  const messages = store.allMessages(chatId);
  let mediaCopied = 0;
  const rows: ExportedMessage[] = [];
  if (includeMedia) await mkdir(join(target, 'media'), { recursive: true });
  for (const m of messages) {
    const sender = m.fromMe ? meName : isGroup ? m.authorName || fallbackName(m.author ?? '') : chatName;
    let file: string | undefined;
    const local = includeMedia ? store.getLocalFile(chatId, m.id) : undefined;
    if (local) {
      try {
        await copyFile(join(mediaDir, local), join(target, 'media', local));
        file = local;
        mediaCopied++;
      } catch {
        // the file was removed from this computer; export the message without it
      }
    }
    rows.push({ message: m, sender, file });
  }
  const content =
    format === 'html'
      ? toHtml(chatName, rows, isGroup)
      : format === 'csv'
        ? toCsvExport(rows)
        : format === 'json'
          ? toJson({ id: chatId, name: chatName }, rows)
          : toText(chatName, rows);
  const path = includeMedia ? join(target, `${safeFileName(chatName)}.${format}`) : target;
  await writeFile(path, content, 'utf8');
  return { path, messages: messages.length, mediaCopied };
}
