// Local SQLite database for chats, messages and scheduled messages.
// Uses Node's built-in node:sqlite, so there are no native modules to rebuild per platform.

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type {
  ChatMessage,
  ChatSummary,
  MessageAck,
  MessageKind,
  Repeat,
  ScheduleInput,
  ScheduledMessage,
  ScheduleStatus,
} from '../shared/types';

const SCHEMA = `
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

interface ScheduledRow {
  id: number;
  chat_id: string;
  chat_name: string | null;
  body: string;
  anchor_at: number;
  send_at: number;
  repeat: Repeat;
  status: ScheduleStatus;
  last_error: string | null;
  last_sent_at: number | null;
  created_at: number;
}

export interface DueMessage {
  id: number;
  chatId: string;
  body: string;
  anchorAt: number;
  sendAt: number;
  repeat: Repeat;
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
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
    const row = this.db.prepare('SELECT pn FROM lid_map WHERE lid = ?').get(lid) as
      | { pn: string }
      | undefined;
    return row?.pn;
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
      .run(
        chat.id,
        chat.name || null,
        chat.unreadCount ?? 0,
        chat.lastActivity ?? 0,
        chat.unreadCount ?? null,
      );
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
        `SELECT COALESCE(NULLIF(c.name, ''), ct.name, ct.notify) AS name
         FROM (SELECT ? AS id) q
         LEFT JOIN chats c ON c.id = q.id
         LEFT JOIN contacts ct ON ct.id = q.id`,
      )
      .get(chatId) as { name: string | null } | undefined;
    return row?.name || formatId(chatId);
  }

  listChats(limit = 500): ChatSummary[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, COALESCE(NULLIF(c.name, ''), ct.name, ct.notify) AS name, c.unread_count,
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
      body: string | null;
      kind: MessageKind | null;
      from_me: number | null;
      timestamp: number | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name || formatId(r.id),
      isGroup: r.id.endsWith('@g.us'),
      unreadCount: r.unread_count,
      lastMessage:
        r.timestamp === null
          ? undefined
          : {
              body: r.body ?? '',
              kind: r.kind ?? 'text',
              fromMe: r.from_me === 1,
              timestamp: r.timestamp,
            },
    }));
  }

  // --- Messages ---

  upsertMessage(m: ChatMessage): void {
    this.db
      .prepare(
        `INSERT INTO messages (chat_id, id, from_me, author, author_name, kind, body, timestamp, ack)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, id) DO UPDATE SET
           body = excluded.body,
           kind = excluded.kind,
           author_name = COALESCE(excluded.author_name, messages.author_name),
           ack = COALESCE(excluded.ack, messages.ack)`,
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
      );
    this.upsertChat({ id: m.chatId, lastActivity: m.timestamp });
  }

  updateAck(chatId: string, messageId: string, ack: MessageAck): void {
    this.db
      .prepare('UPDATE messages SET ack = ? WHERE chat_id = ? AND id = ?')
      .run(ack, chatId, messageId);
  }

  listMessages(chatId: string, limit = 200): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?
         ) ORDER BY timestamp ASC`,
      )
      .all(chatId, limit) as Array<{
      chat_id: string;
      id: string;
      from_me: number;
      author: string | null;
      author_name: string | null;
      kind: MessageKind;
      body: string;
      timestamp: number;
      ack: MessageAck | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      chatId: r.chat_id,
      fromMe: r.from_me === 1,
      author: r.author ?? undefined,
      authorName: r.author_name ?? undefined,
      kind: r.kind,
      body: r.body,
      timestamp: r.timestamp,
      ack: r.ack ?? undefined,
    }));
  }

  /** Most recent incoming messages in a chat, used to send read receipts. */
  latestIncoming(chatId: string, limit: number): Array<{ id: string; author?: string }> {
    const rows = this.db
      .prepare(
        'SELECT id, author FROM messages WHERE chat_id = ? AND from_me = 0 ORDER BY timestamp DESC LIMIT ?',
      )
      .all(chatId, limit) as Array<{ id: string; author: string | null }>;
    return rows.map((r) => ({ id: r.id, author: r.author ?? undefined }));
  }

  // --- Scheduled messages ---

  listScheduled(): ScheduledMessage[] {
    const rows = this.db
      .prepare(
        `SELECT s.*, COALESCE(NULLIF(c.name, ''), ct.name, ct.notify) AS chat_name
         FROM scheduled_messages s
         LEFT JOIN chats c ON c.id = s.chat_id
         LEFT JOIN contacts ct ON ct.id = s.chat_id
         ORDER BY s.send_at ASC`,
      )
      .all() as unknown as ScheduledRow[];
    return rows.map((r) => ({
      id: r.id,
      chatId: r.chat_id,
      chatName: r.chat_name || formatId(r.chat_id),
      body: r.body,
      sendAt: r.send_at,
      repeat: r.repeat,
      status: r.status,
      lastError: r.last_error ?? undefined,
      lastSentAt: r.last_sent_at ?? undefined,
      createdAt: r.created_at,
    }));
  }

  createScheduled(input: ScheduleInput): void {
    this.db
      .prepare(
        `INSERT INTO scheduled_messages (chat_id, body, anchor_at, send_at, repeat, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(input.chatId, input.body, input.sendAt, input.sendAt, input.repeat, Date.now());
  }

  updateScheduled(id: number, input: ScheduleInput): void {
    this.db
      .prepare(
        `UPDATE scheduled_messages
         SET chat_id = ?, body = ?, anchor_at = ?, send_at = ?, repeat = ?, status = 'pending', last_error = NULL
         WHERE id = ?`,
      )
      .run(input.chatId, input.body, input.sendAt, input.sendAt, input.repeat, id);
  }

  setScheduledStatus(id: number, status: ScheduleStatus, fields: { sendAt?: number; error?: string | null; sentAt?: number } = {}): void {
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
      sets.push('last_sent_at = ?');
      values.push(fields.sentAt);
    }
    values.push(id);
    this.db.prepare(`UPDATE scheduled_messages SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteScheduled(id: number): void {
    this.db.prepare('DELETE FROM scheduled_messages WHERE id = ?').run(id);
  }

  dueScheduled(now: number): DueMessage[] {
    const rows = this.db
      .prepare(
        `SELECT id, chat_id, body, anchor_at, send_at, repeat FROM scheduled_messages
         WHERE status = 'pending' AND send_at <= ? ORDER BY send_at ASC`,
      )
      .all(now) as Array<Pick<ScheduledRow, 'id' | 'chat_id' | 'body' | 'anchor_at' | 'send_at' | 'repeat'>>;
    return rows.map((r) => ({
      id: r.id,
      chatId: r.chat_id,
      body: r.body,
      anchorAt: r.anchor_at,
      sendAt: r.send_at,
      repeat: r.repeat,
    }));
  }
}

/** "919876543210@s.whatsapp.net" -> "+919876543210" */
export function formatId(id: string): string {
  const user = id.split('@')[0] ?? id;
  return /^\d+$/.test(user) ? `+${user}` : user;
}
