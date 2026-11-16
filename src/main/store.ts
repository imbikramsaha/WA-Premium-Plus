// Local SQLite database for chats, messages and scheduled messages.
// Uses Node's built-in node:sqlite, so there are no native modules to rebuild per platform.

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type {
  AttachmentInfo,
  AttachmentKind,
  ChatMessage,
  ChatSummary,
  GroupAction,
  MediaInfo,
  MessageAck,
  MessageKind,
  RepeatRule,
  ScheduledMessage,
  ScheduleStatus,
  ScheduleTarget,
} from '../shared/types';

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  name TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_activity INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT,
  notify TEXT
);
CREATE TABLE IF NOT EXISTS lid_map (
  lid TEXT PRIMARY KEY,
  pn TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  chat_id TEXT NOT NULL,
  id TEXT NOT NULL,
  from_me INTEGER NOT NULL,
  author TEXT,
  author_name TEXT,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  ack TEXT,
  PRIMARY KEY (chat_id, id)
);
CREATE INDEX IF NOT EXISTS messages_by_chat_time ON messages (chat_id, timestamp);
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  body TEXT NOT NULL,
  anchor_at INTEGER NOT NULL,
  send_at INTEGER NOT NULL,
  repeat TEXT NOT NULL DEFAULT 'none',
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  last_sent_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS scheduled_due ON scheduled_messages (status, send_at);
`;

/** Columns added after version 1 (versions 2 and 3), as [table, column, definition]. */
const ADDED_COLUMNS: Array<[string, string, string]> = [
  ['messages', 'raw', 'TEXT'],
  ['messages', 'mime', 'TEXT'],
  ['messages', 'file_name', 'TEXT'],
  ['messages', 'file_size', 'INTEGER'],
  ['messages', 'seconds', 'INTEGER'],
  ['messages', 'ptt', 'INTEGER'],
  ['messages', 'thumb', 'TEXT'],
  ['messages', 'width', 'INTEGER'],
  ['messages', 'height', 'INTEGER'],
  ['messages', 'local_file', 'TEXT'],
  ['messages', 'edited', 'INTEGER NOT NULL DEFAULT 0'],
  ['scheduled_messages', 'target', "TEXT NOT NULL DEFAULT 'chat'"],
  ['scheduled_messages', 'rule', 'TEXT'],
  ['scheduled_messages', 'attachment_path', 'TEXT'],
  ['scheduled_messages', 'attachment_name', 'TEXT'],
  ['scheduled_messages', 'attachment_mime', 'TEXT'],
  ['scheduled_messages', 'attachment_kind', 'TEXT'],
  ['scheduled_messages', 'attachment_size', 'INTEGER'],
  ['scheduled_messages', 'sent_count', 'INTEGER NOT NULL DEFAULT 0'],
  // version 3: scheduled group settings changes
  ['scheduled_messages', 'group_action', 'TEXT'],
];

const SCHEMA_VERSION = 3;

export interface ChatUpsert {
  id: string;
  name?: string | null;
  unreadCount?: number | null;
  lastActivity?: number | null;
}

export interface ContactUpsert {
  id: string;
  name?: string | null;
  notify?: string | null;
}

/** A message as stored, including the raw WhatsApp payload needed to download media. */
export interface StoredMessage extends ChatMessage {
  raw?: string;
}

export interface Attachment extends AttachmentInfo {
  path: string;
}

export interface NewSchedule {
  target: ScheduleTarget;
  chatId: string;
  body: string;
  /** First send time. */
  sendAt: number;
  /** The time repeats are counted from; defaults to sendAt. */
  anchorAt?: number;
  rule: RepeatRule;
  attachment?: Attachment | null;
  groupAction?: GroupAction | null;
}

export interface DueMessage {
  id: number;
  target: ScheduleTarget;
  chatId: string;
  body: string;
  anchorAt: number;
  sendAt: number;
  rule: RepeatRule;
  attachment?: Attachment;
  groupAction?: GroupAction;
}

interface MessageRow {
  chat_id: string;
  id: string;
  from_me: number;
  author: string | null;
  author_name: string | null;
  contact_name: string | null;
  kind: MessageKind;
  body: string;
  timestamp: number;
  ack: MessageAck | null;
  edited: number;
  raw: string | null;
  mime: string | null;
  file_name: string | null;
  file_size: number | null;
  seconds: number | null;
  ptt: number | null;
  thumb: string | null;
  width: number | null;
  height: number | null;
  local_file: string | null;
}

interface ScheduledRow {
  id: number;
  target: ScheduleTarget;
  chat_id: string;
  chat_name: string | null;
  body: string;
  anchor_at: number;
  send_at: number;
  repeat: RepeatRule['repeat'];
  rule: string | null;
  status: ScheduleStatus;
  last_error: string | null;
  last_sent_at: number | null;
  sent_count: number;
  created_at: number;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_kind: AttachmentKind | null;
  attachment_size: number | null;
  group_action: string | null;
}

const MEDIA_KINDS = new Set<MessageKind>(['image', 'video', 'audio', 'document', 'sticker']);

/** SQL for a display name: saved contact name, then chat name, then the name they set. */
const NAME_SQL = `COALESCE(ct.name, NULLIF(c.name, ''), ct.notify)`;

export class Store {
  private readonly db: DatabaseSync;
  /** Turns a stored file name into a URL the window can load. */
  mediaUrl: (fileName: string) => string = (fileName) => `wapp-media://media/${encodeURIComponent(fileName)}`;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  private migrate(): void {
    const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version >= SCHEMA_VERSION) return;
    this.db.exec(SCHEMA_V1);
    for (const [table, column, definition] of ADDED_COLUMNS) {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!columns.some((c) => c.name === column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  transaction(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Removes all account data. Used when the user logs out. */
  clearAll(): void {
    this.db.exec(
      'DELETE FROM chats; DELETE FROM contacts; DELETE FROM lid_map; DELETE FROM messages; DELETE FROM scheduled_messages;',
    );
  }

  // --- LID (WhatsApp's privacy IDs) to phone-number ID mapping ---

  saveLidMapping(lid: string, pn: string): void {
    this.db.prepare('INSERT OR REPLACE INTO lid_map (lid, pn) VALUES (?, ?)').run(lid, pn);
  }

  pnForLid(lid: string): string | undefined {
    const row = this.db.prepare('SELECT pn FROM lid_map WHERE lid = ?').get(lid) as { pn: string } | undefined;
    return row?.pn;
  }

  /** LIDs still used as chat, contact or sender IDs, which we'd like to turn into phone numbers. */
  unresolvedLids(): string[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM chats WHERE id LIKE '%@lid'
         UNION SELECT id FROM contacts WHERE id LIKE '%@lid'
         UNION SELECT DISTINCT author FROM messages WHERE author LIKE '%@lid'`,
      )
      .all() as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  /**
   * Moves everything stored under a LID to the matching phone-number ID, so a person
   * who appears under both shows up as one chat with one name.
   */
  mergeLid(lid: string, pn: string): void {
    if (lid === pn) return;
    this.saveLidMapping(lid, pn);
    this.db
      .prepare(
        `INSERT INTO chats (id, name, unread_count, last_activity)
         SELECT ?, name, unread_count, last_activity FROM chats WHERE id = ?
         ON CONFLICT(id) DO UPDATE SET
           name = COALESCE(chats.name, excluded.name),
           unread_count = chats.unread_count + excluded.unread_count,
           last_activity = MAX(chats.last_activity, excluded.last_activity)`,
      )
      .run(pn, lid);
    this.db.prepare('DELETE FROM chats WHERE id = ?').run(lid);
    this.db.prepare('UPDATE OR IGNORE messages SET chat_id = ? WHERE chat_id = ?').run(pn, lid);
    this.db.prepare('DELETE FROM messages WHERE chat_id = ?').run(lid);
    this.db.prepare('UPDATE messages SET author = ? WHERE author = ?').run(pn, lid);
    this.db
      .prepare(
        `INSERT INTO contacts (id, name, notify)
         SELECT ?, name, notify FROM contacts WHERE id = ?
         ON CONFLICT(id) DO UPDATE SET
           name = COALESCE(contacts.name, excluded.name),
           notify = COALESCE(contacts.notify, excluded.notify)`,
      )
      .run(pn, lid);
    this.db.prepare('DELETE FROM contacts WHERE id = ?').run(lid);
    this.db.prepare('UPDATE scheduled_messages SET chat_id = ? WHERE chat_id = ?').run(pn, lid);
  }

  // --- Chats and contacts ---

  upsertChat(chat: ChatUpsert): void {
    this.db
      .prepare(
        `INSERT INTO chats (id, name, unread_count, last_activity) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = COALESCE(excluded.name, chats.name),
           unread_count = COALESCE(?, chats.unread_count),
           last_activity = MAX(chats.last_activity, excluded.last_activity)`,
      )
      .run(chat.id, chat.name || null, chat.unreadCount ?? 0, chat.lastActivity ?? 0, chat.unreadCount ?? null);
  }

  deleteChat(id: string): void {
    this.db.prepare('DELETE FROM chats WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM messages WHERE chat_id = ?').run(id);
  }

  incrementUnread(chatId: string): void {
    this.db.prepare('UPDATE chats SET unread_count = unread_count + 1 WHERE id = ?').run(chatId);
  }

  resetUnread(chatId: string): number {
    const row = this.db.prepare('SELECT unread_count FROM chats WHERE id = ?').get(chatId) as
      | { unread_count: number }
      | undefined;
    this.db.prepare('UPDATE chats SET unread_count = 0 WHERE id = ?').run(chatId);
    return row?.unread_count ?? 0;
  }

  upsertContact(contact: ContactUpsert): void {
    this.db
      .prepare(
        `INSERT INTO contacts (id, name, notify) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = COALESCE(excluded.name, contacts.name),
           notify = COALESCE(excluded.notify, contacts.notify)`,
      )
      .run(contact.id, contact.name || null, contact.notify || null);
  }

  chatName(chatId: string): string {
    const row = this.db
      .prepare(
        `SELECT ${NAME_SQL} AS name
         FROM (SELECT ? AS id) q
         LEFT JOIN chats c ON c.id = q.id
         LEFT JOIN contacts ct ON ct.id = q.id`,
      )
      .get(chatId) as { name: string | null } | undefined;
    return row?.name || fallbackName(chatId);
  }

  contactName(id: string): string | undefined {
    const row = this.db.prepare('SELECT COALESCE(name, notify) AS name FROM contacts WHERE id = ?').get(id) as
      | { name: string | null }
      | undefined;
    return row?.name ?? undefined;
  }

  /** Phone-number IDs of saved contacts: the audience for status updates ("My contacts"). */
  statusAudience(): string[] {
    const rows = this.db
      .prepare(`SELECT id FROM contacts WHERE name IS NOT NULL AND id LIKE '%@s.whatsapp.net'`)
      .all() as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  listChats(limit = 5000): ChatSummary[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, ${NAME_SQL} AS name, c.unread_count, c.last_activity,
                m.body, m.kind, m.from_me, m.timestamp
         FROM chats c
         LEFT JOIN contacts ct ON ct.id = c.id
         LEFT JOIN messages m ON m.rowid = (
           SELECT rowid FROM messages WHERE chat_id = c.id ORDER BY timestamp DESC LIMIT 1
         )
         ORDER BY MAX(COALESCE(m.timestamp, 0), c.last_activity) DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      name: string | null;
      unread_count: number;
      last_activity: number;
      body: string | null;
      kind: MessageKind | null;
      from_me: number | null;
      timestamp: number | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name || fallbackName(r.id),
      isGroup: r.id.endsWith('@g.us'),
      unreadCount: r.unread_count,
      lastActivity: r.last_activity || undefined,
      lastMessage:
        r.timestamp === null
          ? undefined
          : { body: r.body ?? '', kind: r.kind ?? 'text', fromMe: r.from_me === 1, timestamp: r.timestamp },
    }));
  }

  // --- Messages ---

  upsertMessage(m: StoredMessage): void {
    const media = m.media;
    this.db
      .prepare(
        `INSERT INTO messages (chat_id, id, from_me, author, author_name, kind, body, timestamp, ack,
                               raw, mime, file_name, file_size, seconds, ptt, thumb, width, height)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, id) DO UPDATE SET
           body = CASE WHEN messages.kind = 'deleted' THEN messages.body ELSE excluded.body END,
           kind = CASE WHEN messages.kind = 'deleted' THEN messages.kind ELSE excluded.kind END,
           author = COALESCE(messages.author, excluded.author),
           author_name = COALESCE(excluded.author_name, messages.author_name),
           ack = COALESCE(excluded.ack, messages.ack),
           raw = COALESCE(excluded.raw, messages.raw),
           mime = COALESCE(excluded.mime, messages.mime),
           file_name = COALESCE(excluded.file_name, messages.file_name),
           file_size = COALESCE(excluded.file_size, messages.file_size),
           seconds = COALESCE(excluded.seconds, messages.seconds),
           ptt = COALESCE(excluded.ptt, messages.ptt),
           thumb = COALESCE(excluded.thumb, messages.thumb),
           width = COALESCE(excluded.width, messages.width),
           height = COALESCE(excluded.height, messages.height)`,
      )
      .run(
        m.chatId,
        m.id,
        m.fromMe ? 1 : 0,
        m.author ?? null,
        m.authorName ?? null,
        m.kind,
        m.body,
        m.timestamp,
        m.ack ?? null,
        m.raw ?? null,
        media?.mimetype ?? null,
        media?.fileName ?? null,
        media?.size ?? null,
        media?.seconds ?? null,
        media?.ptt === undefined ? null : media.ptt ? 1 : 0,
        media?.thumb ?? null,
        media?.width ?? null,
        media?.height ?? null,
      );
    this.upsertChat({ id: m.chatId, lastActivity: m.timestamp });
  }

  updateAck(chatId: string, messageId: string, ack: MessageAck): void {
    this.db.prepare('UPDATE messages SET ack = ? WHERE chat_id = ? AND id = ?').run(ack, chatId, messageId);
  }

  /** Applies an edit. Returns the updated message, or undefined if we don't have the original. */
  editMessage(chatId: string, messageId: string, body: string): ChatMessage | undefined {
    this.db
      .prepare(`UPDATE messages SET body = ?, edited = 1 WHERE chat_id = ? AND id = ? AND kind != 'deleted'`)
      .run(body, chatId, messageId);
    return this.getMessage(chatId, messageId);
  }

  /** Marks a message as deleted for everyone. Returns the updated message, if we have it. */
  markDeleted(chatId: string, messageId: string): ChatMessage | undefined {
    this.db
      .prepare(
        `UPDATE messages SET kind = 'deleted', body = '', raw = NULL, thumb = NULL WHERE chat_id = ? AND id = ?`,
      )
      .run(chatId, messageId);
    return this.getMessage(chatId, messageId);
  }

  getMessage(chatId: string, messageId: string): StoredMessage | undefined {
    const row = this.db
      .prepare(
        `SELECT m.*, COALESCE(ct.name, ct.notify) AS contact_name
         FROM messages m LEFT JOIN contacts ct ON ct.id = m.author
         WHERE m.chat_id = ? AND m.id = ?`,
      )
      .get(chatId, messageId) as MessageRow | undefined;
    return row ? this.toMessage(row, true) : undefined;
  }

  /** Replaces the stored WhatsApp payload, e.g. after the phone re-uploaded expired media. */
  updateRaw(chatId: string, messageId: string, raw: string): void {
    this.db.prepare('UPDATE messages SET raw = ? WHERE chat_id = ? AND id = ?').run(raw, chatId, messageId);
  }

  setLocalFile(chatId: string, messageId: string, fileName: string): void {
    this.db.prepare('UPDATE messages SET local_file = ? WHERE chat_id = ? AND id = ?').run(fileName, chatId, messageId);
  }

  getLocalFile(chatId: string, messageId: string): string | undefined {
    const row = this.db.prepare('SELECT local_file FROM messages WHERE chat_id = ? AND id = ?').get(chatId, messageId) as
      | { local_file: string | null }
      | undefined;
    return row?.local_file ?? undefined;
  }

  /** Up to `limit` messages before `before` (seconds), oldest first. */
  listMessages(chatId: string, limit = 100, before?: number): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM (
           SELECT m.*, COALESCE(ct.name, ct.notify) AS contact_name
           FROM messages m LEFT JOIN contacts ct ON ct.id = m.author
           WHERE m.chat_id = ? AND m.timestamp < ?
           ORDER BY m.timestamp DESC LIMIT ?
         ) ORDER BY timestamp ASC`,
      )
      .all(chatId, before ?? Number.MAX_SAFE_INTEGER, limit) as unknown as MessageRow[];
    return rows.map((r) => this.toMessage(r, false));
  }

  private toMessage(r: MessageRow, includeRaw: true): StoredMessage;
  private toMessage(r: MessageRow, includeRaw: false): ChatMessage;
  private toMessage(r: MessageRow, includeRaw: boolean): StoredMessage {
    const message: StoredMessage = {
      id: r.id,
      chatId: r.chat_id,
      fromMe: r.from_me === 1,
      author: r.author ?? undefined,
      authorName: r.contact_name ?? r.author_name ?? undefined,
      kind: r.kind,
      body: r.body,
      timestamp: r.timestamp,
      ack: r.ack ?? undefined,
      edited: r.edited === 1 || undefined,
    };
    if (MEDIA_KINDS.has(r.kind)) {
      const media: MediaInfo = {
        mimetype: r.mime ?? undefined,
        fileName: r.file_name ?? undefined,
        size: r.file_size ?? undefined,
        seconds: r.seconds ?? undefined,
        ptt: r.ptt === null ? undefined : r.ptt === 1,
        thumb: r.thumb ? `data:image/jpeg;base64,${r.thumb}` : undefined,
        width: r.width ?? undefined,
        height: r.height ?? undefined,
        url: r.local_file ? this.mediaUrl(r.local_file) : undefined,
        downloadable: r.raw !== null || r.local_file !== null,
      };
      message.media = media;
    }
    if (includeRaw && r.raw) message.raw = r.raw;
    return message;
  }

  /** Media messages in a chat that can't be downloaded (no keys stored and no local copy). */
  countUnavailableMedia(chatId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages
         WHERE chat_id = ? AND kind IN ('image', 'video', 'audio', 'document', 'sticker')
           AND raw IS NULL AND local_file IS NULL`,
      )
      .get(chatId) as { n: number };
    return row.n;
  }

  /** Incoming group messages whose sender we don't know (synced before senders were read). */
  countMissingAuthors(chatId: string): number {
    if (!chatId.endsWith('@g.us')) return 0;
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND from_me = 0 AND author IS NULL')
      .get(chatId) as { n: number };
    return row.n;
  }

  /** The newest message in a chat, as a WhatsApp message key (for history requests). */
  newestMessage(chatId: string): { id: string; fromMe: boolean; author?: string; timestamp: number } | undefined {
    const row = this.db
      .prepare('SELECT id, from_me, author, timestamp FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT 1')
      .get(chatId) as { id: string; from_me: number; author: string | null; timestamp: number } | undefined;
    return row && { id: row.id, fromMe: row.from_me === 1, author: row.author ?? undefined, timestamp: row.timestamp };
  }

  /** Most recent incoming messages in a chat, used to send read receipts. */
  latestIncoming(chatId: string, limit: number): Array<{ id: string; author?: string }> {
    const rows = this.db
      .prepare('SELECT id, author FROM messages WHERE chat_id = ? AND from_me = 0 ORDER BY timestamp DESC LIMIT ?')
      .all(chatId, limit) as Array<{ id: string; author: string | null }>;
    return rows.map((r) => ({ id: r.id, author: r.author ?? undefined }));
  }

  // --- Scheduled messages ---

  listScheduled(): ScheduledMessage[] {
    const rows = this.db
      .prepare(
        `SELECT s.*, ${NAME_SQL} AS chat_name
         FROM scheduled_messages s
         LEFT JOIN chats c ON c.id = s.chat_id
         LEFT JOIN contacts ct ON ct.id = s.chat_id
         ORDER BY s.send_at ASC`,
      )
      .all() as unknown as ScheduledRow[];
    return rows.map((r) => ({
      id: r.id,
      target: r.target,
      chatId: r.chat_id,
      chatName: r.target === 'status' ? 'My status' : r.chat_name || fallbackName(r.chat_id),
      body: r.body,
      sendAt: r.send_at,
      rule: parseRule(r),
      status: r.status,
      attachment: rowAttachment(r),
      groupAction: parseGroupAction(r),
      lastError: r.last_error ?? undefined,
      lastSentAt: r.last_sent_at ?? undefined,
      sentCount: r.sent_count,
      createdAt: r.created_at,
    }));
  }

  getScheduled(id: number): DueMessage | undefined {
    const row = this.db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(id) as ScheduledRow | undefined;
    return row ? toDue(row) : undefined;
  }

  createScheduled(input: NewSchedule): number {
    const a = input.attachment ?? null;
    const result = this.db
      .prepare(
        `INSERT INTO scheduled_messages
           (target, chat_id, body, anchor_at, send_at, repeat, rule, status, created_at,
            attachment_path, attachment_name, attachment_mime, attachment_kind, attachment_size, group_action)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.target,
        input.chatId,
        input.body,
        input.anchorAt ?? input.sendAt,
        input.sendAt,
        input.rule.repeat,
        JSON.stringify(input.rule),
        Date.now(),
        a?.path ?? null,
        a?.name ?? null,
        a?.mimetype ?? null,
        a?.kind ?? null,
        a?.size ?? null,
        input.groupAction ? JSON.stringify(input.groupAction) : null,
      );
    return Number(result.lastInsertRowid);
  }

  /** Updates a scheduled message. `attachment` undefined keeps the current one. */
  updateScheduled(id: number, input: NewSchedule): void {
    const sets = [
      'target = ?',
      'chat_id = ?',
      'body = ?',
      'anchor_at = ?',
      'send_at = ?',
      'repeat = ?',
      'rule = ?',
      'group_action = ?',
      "status = 'pending'",
      'last_error = NULL',
    ];
    const values: SQLInputValue[] = [
      input.target,
      input.chatId,
      input.body,
      input.anchorAt ?? input.sendAt,
      input.sendAt,
      input.rule.repeat,
      JSON.stringify(input.rule),
      input.groupAction ? JSON.stringify(input.groupAction) : null,
    ];
    if (input.attachment !== undefined) {
      const a = input.attachment;
      sets.push('attachment_path = ?', 'attachment_name = ?', 'attachment_mime = ?', 'attachment_kind = ?', 'attachment_size = ?');
      values.push(a?.path ?? null, a?.name ?? null, a?.mimetype ?? null, a?.kind ?? null, a?.size ?? null);
    }
    values.push(id);
    this.db.prepare(`UPDATE scheduled_messages SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  setScheduledStatus(
    id: number,
    status: ScheduleStatus,
    fields: { sendAt?: number; error?: string | null; sentAt?: number } = {},
  ): void {
    const sets = ['status = ?'];
    const values: SQLInputValue[] = [status];
    if (fields.sendAt !== undefined) {
      sets.push('send_at = ?');
      values.push(fields.sendAt);
    }
    if (fields.error !== undefined) {
      sets.push('last_error = ?');
      values.push(fields.error);
    }
    if (fields.sentAt !== undefined) {
      sets.push('last_sent_at = ?', 'sent_count = sent_count + 1');
      values.push(fields.sentAt);
    }
    values.push(id);
    this.db.prepare(`UPDATE scheduled_messages SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  /** Deletes a scheduled message. Returns its attachment path if no other schedule uses it. */
  deleteScheduled(id: number): string | undefined {
    const row = this.db.prepare('SELECT attachment_path FROM scheduled_messages WHERE id = ?').get(id) as
      | { attachment_path: string | null }
      | undefined;
    this.db.prepare('DELETE FROM scheduled_messages WHERE id = ?').run(id);
    const path = row?.attachment_path;
    if (!path) return undefined;
    return this.isAttachmentUsed(path) ? undefined : path;
  }

  isAttachmentUsed(path: string): boolean {
    const used = this.db.prepare('SELECT 1 FROM scheduled_messages WHERE attachment_path = ? LIMIT 1').get(path);
    return Boolean(used);
  }

  dueScheduled(now: number): DueMessage[] {
    const rows = this.db
      .prepare(`SELECT * FROM scheduled_messages WHERE status = 'pending' AND send_at <= ? ORDER BY send_at ASC`)
      .all(now) as unknown as ScheduledRow[];
    return rows.map(toDue);
  }
}

function parseRule(r: Pick<ScheduledRow, 'rule' | 'repeat'>): RepeatRule {
  if (r.rule) {
    try {
      return JSON.parse(r.rule) as RepeatRule;
    } catch {
      // fall through to the plain repeat column
    }
  }
  return { repeat: r.repeat };
}

function parseGroupAction(r: Pick<ScheduledRow, 'group_action'>): GroupAction | undefined {
  if (!r.group_action) return undefined;
  try {
    return JSON.parse(r.group_action) as GroupAction;
  } catch {
    return undefined;
  }
}

function rowAttachment(r: ScheduledRow): Attachment | undefined {
  if (!r.attachment_path) return undefined;
  return {
    path: r.attachment_path,
    name: r.attachment_name ?? 'file',
    mimetype: r.attachment_mime ?? 'application/octet-stream',
    kind: r.attachment_kind ?? 'document',
    size: r.attachment_size ?? 0,
  };
}

function toDue(r: ScheduledRow): DueMessage {
  return {
    id: r.id,
    target: r.target,
    chatId: r.chat_id,
    body: r.body,
    anchorAt: r.anchor_at,
    sendAt: r.send_at,
    rule: parseRule(r),
    attachment: rowAttachment(r),
    groupAction: parseGroupAction(r),
  };
}

/** Name to show when we know nothing better about a chat. */
export function fallbackName(id: string): string {
  const [user = id, server] = id.split('@');
  if (server === 's.whatsapp.net' || server === 'c.us') return /^\d+$/.test(user) ? `+${user}` : user;
  if (server === 'g.us') return 'Group';
  if (server === 'newsletter') return 'Channel';
  if (server === 'lid') return 'WhatsApp user';
  return user;
}
