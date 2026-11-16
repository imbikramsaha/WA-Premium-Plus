// Local SQLite database for chats, messages and scheduled messages.
// Uses Node's built-in node:sqlite, so there are no native modules to rebuild per platform.

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type {
  AttachmentInfo,
  AttachmentKind,
  CallRecord,
  CallStatus,
  ChatMessage,
  ChatSummary,
  ContactCard,
  GroupAction,
  Label,
  LocationInfo,
  MediaInfo,
  MessageAck,
  MessageKind,
  RepeatRule,
  ScheduledMessage,
  ScheduleStatus,
  ScheduleTarget,
  QuotedMessage,
  SearchResult,
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
  // version 4: replies, forwards, polls/locations/contact cards, chat flags
  ['messages', 'quoted', 'TEXT'],
  ['messages', 'forwarded', 'INTEGER NOT NULL DEFAULT 0'],
  ['messages', 'extra', 'TEXT'],
  ['chats', 'archived', 'INTEGER NOT NULL DEFAULT 0'],
  ['chats', 'pinned', 'INTEGER NOT NULL DEFAULT 0'],
  ['chats', 'muted_until', 'INTEGER NOT NULL DEFAULT 0'],
];

/** Tables added in version 4. Feature modules (automation, broadcasts, webhooks) use some of them. */
const SCHEMA_V4 = `
CREATE TABLE IF NOT EXISTS reactions (
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  emoji TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  PRIMARY KEY (chat_id, message_id, sender)
);
CREATE TABLE IF NOT EXISTS poll_votes (
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  voter TEXT NOT NULL,
  options TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  PRIMARY KEY (chat_id, message_id, voter)
);
CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color INTEGER NOT NULL DEFAULT 0,
  wa_id TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS chat_labels (
  chat_id TEXT NOT NULL,
  label_id INTEGER NOT NULL,
  PRIMARY KEY (chat_id, label_id)
);
CREATE TABLE IF NOT EXISTS profile_pics (
  id TEXT PRIMARY KEY,
  file TEXT,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  from_me INTEGER NOT NULL DEFAULT 0,
  is_video INTEGER NOT NULL DEFAULT 0,
  is_group INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS calls_by_time ON calls (started_at);
CREATE TABLE IF NOT EXISTS quick_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shortcut TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rule_fires (
  rule_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rule_fires_lookup ON rule_fires (rule_id, chat_id, at);
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  message_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  due_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  only_if_no_reply INTEGER NOT NULL DEFAULT 1,
  follow_up TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  done_at INTEGER
);
CREATE TABLE IF NOT EXISTS contact_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  columns TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS list_members (
  list_id INTEGER NOT NULL,
  jid TEXT NOT NULL,
  name TEXT,
  fields TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (list_id, jid)
);
CREATE TABLE IF NOT EXISTS opt_outs (
  jid TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  source TEXT
);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  list_id INTEGER,
  body TEXT NOT NULL,
  attachment_path TEXT,
  attachment_name TEXT,
  attachment_mime TEXT,
  attachment_kind TEXT,
  attachment_size INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  start_at INTEGER,
  daily_cap INTEGER NOT NULL,
  min_delay INTEGER NOT NULL,
  max_delay INTEGER NOT NULL,
  opt_out_footer INTEGER NOT NULL DEFAULT 1,
  next_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS campaign_recipients (
  campaign_id INTEGER NOT NULL,
  jid TEXT NOT NULL,
  name TEXT,
  fields TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at INTEGER,
  error TEXT,
  PRIMARY KEY (campaign_id, jid)
);
CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_status TEXT,
  last_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/**
 * Full-text index over message text, kept in sync by triggers. It's an external-content
 * table: it stores only the index, and reads the text from the messages table.
 */
const SEARCH_INDEX = `
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  body, content='messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts (rowid, body) VALUES (new.rowid, new.body);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF body ON messages
WHEN old.body IS NOT new.body BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO messages_fts (rowid, body) VALUES (new.rowid, new.body);
END;
`;

const SCHEMA_VERSION = 4;

/** Status updates are stored as messages in this chat, which the chat list leaves out. */
export const STATUS_CHAT = 'status@broadcast';
/** Status updates disappear after a day. */
const STATUS_LIFETIME_S = 24 * 60 * 60;

export interface ChatUpsert {
  id: string;
  name?: string | null;
  unreadCount?: number | null;
  lastActivity?: number | null;
  archived?: boolean | null;
  /** When the chat was pinned (Unix ms), or 0 to unpin. */
  pinned?: number | null;
  /** Muted until (Unix ms), -1 for always, 0 for not muted. */
  mutedUntil?: number | null;
}

export interface ContactUpsert {
  id: string;
  name?: string | null;
  notify?: string | null;
}

/** Message details kept as JSON: poll questions, locations and contact cards. */
export interface MessageExtra {
  poll?: { options: string[]; selectableCount: number };
  /** Call log entries in chats. `outcome` is WhatsApp's (CONNECTED, MISSED, REJECTED...). */
  call?: { video: boolean; outcome: string; seconds?: number };
  /** `thumb` is plain base64 here. */
  location?: LocationInfo;
  contacts?: ContactCard[];
}

/** A message as stored, including the raw WhatsApp payload needed to download media. */
export interface StoredMessage extends ChatMessage {
  raw?: string;
  extra?: MessageExtra;
}

/** The current user's own reactions and poll votes are stored under this sender. */
export const ME = 'me';

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
  quoted: string | null;
  forwarded: number;
  extra: string | null;
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
  /** The database, shared with feature modules that keep their own tables in it. */
  readonly db: DatabaseSync;
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
    this.db.exec(SCHEMA_V4);
    for (const [table, column, definition] of ADDED_COLUMNS) {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!columns.some((c) => c.name === column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }
    this.db.exec(SEARCH_INDEX);
    // Index the messages stored before search existed.
    if (version < 4) this.db.exec(`INSERT INTO messages_fts (messages_fts) VALUES ('rebuild')`);
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  close(): void {
    this.db.close();
  }

  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (safeJson<T>(row.value) ?? fallback) : fallback;
  }

  setSetting(key: string, value: unknown): void {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
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
      `DELETE FROM chats; DELETE FROM contacts; DELETE FROM lid_map; DELETE FROM messages;
       DELETE FROM scheduled_messages; DELETE FROM reactions; DELETE FROM poll_votes; DELETE FROM chat_labels;
       DELETE FROM labels; DELETE FROM profile_pics; DELETE FROM calls; DELETE FROM reminders;
       DELETE FROM campaign_recipients; DELETE FROM campaigns; DELETE FROM list_members; DELETE FROM contact_lists;
       DELETE FROM opt_outs; DELETE FROM rule_fires;`,
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
    const archived = chat.archived === undefined || chat.archived === null ? null : chat.archived ? 1 : 0;
    this.db
      .prepare(
        `INSERT INTO chats (id, name, unread_count, last_activity, archived, pinned, muted_until)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = COALESCE(excluded.name, chats.name),
           unread_count = COALESCE(?, chats.unread_count),
           last_activity = MAX(chats.last_activity, excluded.last_activity),
           archived = COALESCE(?, chats.archived),
           pinned = COALESCE(?, chats.pinned),
           muted_until = COALESCE(?, chats.muted_until)`,
      )
      .run(
        chat.id,
        chat.name || null,
        chat.unreadCount ?? 0,
        chat.lastActivity ?? 0,
        archived ?? 0,
        chat.pinned ?? 0,
        chat.mutedUntil ?? 0,
        chat.unreadCount ?? null,
        archived,
        chat.pinned ?? null,
        chat.mutedUntil ?? null,
      );
  }

  /** Whether notifications for a chat are muted right now. */
  isMuted(chatId: string, now = Date.now()): boolean {
    const row = this.db.prepare('SELECT muted_until FROM chats WHERE id = ?').get(chatId) as
      | { muted_until: number }
      | undefined;
    const until = row?.muted_until ?? 0;
    return until === -1 || until > now;
  }

  hasChat(chatId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM chats WHERE id = ?').get(chatId));
  }

  deleteChat(id: string): void {
    this.db.prepare('DELETE FROM chats WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM messages WHERE chat_id = ?').run(id);
    this.db.prepare('DELETE FROM reactions WHERE chat_id = ?').run(id);
    this.db.prepare('DELETE FROM poll_votes WHERE chat_id = ?').run(id);
    this.db.prepare('DELETE FROM chat_labels WHERE chat_id = ?').run(id);
  }

  incrementUnread(chatId: string): void {
    this.db.prepare('UPDATE chats SET unread_count = unread_count + 1 WHERE id = ?').run(chatId);
  }

  unreadCount(chatId: string): number {
    const row = this.db.prepare('SELECT unread_count FROM chats WHERE id = ?').get(chatId) as
      | { unread_count: number }
      | undefined;
    return row?.unread_count ?? 0;
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

  /** Saved contacts and people with a chat, by name. */
  listContacts(): Array<{ id: string; name: string; phone?: string }> {
    const rows = this.db
      .prepare(
        `SELECT q.id, ${NAME_SQL} AS name FROM (
           SELECT id FROM contacts WHERE id LIKE '%@s.whatsapp.net' AND (name IS NOT NULL OR notify IS NOT NULL)
           UNION SELECT id FROM chats WHERE id LIKE '%@s.whatsapp.net'
         ) q
         LEFT JOIN contacts ct ON ct.id = q.id
         LEFT JOIN chats c ON c.id = q.id`,
      )
      .all() as Array<{ id: string; name: string | null }>;
    return rows
      .map((r) => ({ id: r.id, name: r.name || fallbackName(r.id), phone: `+${r.id.split('@')[0]}` }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  listChats(limit = 5000): ChatSummary[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, ${NAME_SQL} AS name, c.unread_count, c.last_activity, c.archived, c.pinned, c.muted_until,
                (SELECT GROUP_CONCAT(label_id) FROM chat_labels WHERE chat_id = c.id) AS labels,
                m.body, m.kind, m.from_me, m.timestamp
         FROM chats c
         LEFT JOIN contacts ct ON ct.id = c.id
         LEFT JOIN messages m ON m.rowid = (
           SELECT rowid FROM messages WHERE chat_id = c.id ORDER BY timestamp DESC LIMIT 1
         )
         WHERE c.id != '${STATUS_CHAT}'
         ORDER BY c.pinned > 0 DESC, c.pinned DESC, MAX(COALESCE(m.timestamp, 0), c.last_activity) DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      name: string | null;
      unread_count: number;
      last_activity: number;
      archived: number;
      pinned: number;
      muted_until: number;
      labels: string | null;
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
      archived: r.archived === 1,
      pinned: r.pinned > 0,
      mutedUntil: r.muted_until,
      labels: r.labels ? r.labels.split(',').map(Number) : [],
    }));
  }

  // --- Labels (kept on this computer; WhatsApp Business labels sync in too) ---

  listLabels(): Label[] {
    const rows = this.db
      .prepare(
        `SELECT l.id, l.name, l.color, (SELECT COUNT(*) FROM chat_labels cl WHERE cl.label_id = l.id) AS count
         FROM labels l ORDER BY l.name COLLATE NOCASE`,
      )
      .all() as unknown as Label[];
    return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, count: r.count }));
  }

  saveLabel(label: { id?: number; name: string; color: number; waId?: string }): number {
    if (label.id) {
      this.db.prepare('UPDATE labels SET name = ?, color = ? WHERE id = ?').run(label.name, label.color, label.id);
      return label.id;
    }
    if (label.waId) {
      this.db
        .prepare(
          `INSERT INTO labels (name, color, wa_id) VALUES (?, ?, ?)
           ON CONFLICT(wa_id) DO UPDATE SET name = excluded.name, color = excluded.color`,
        )
        .run(label.name, label.color, label.waId);
      return (this.db.prepare('SELECT id FROM labels WHERE wa_id = ?').get(label.waId) as { id: number }).id;
    }
    return Number(this.db.prepare('INSERT INTO labels (name, color) VALUES (?, ?)').run(label.name, label.color).lastInsertRowid);
  }

  deleteLabel(id: number): void {
    this.db.prepare('DELETE FROM chat_labels WHERE label_id = ?').run(id);
    this.db.prepare('DELETE FROM labels WHERE id = ?').run(id);
  }

  labelIdForWa(waId: string): number | undefined {
    const row = this.db.prepare('SELECT id FROM labels WHERE wa_id = ?').get(waId) as { id: number } | undefined;
    return row?.id;
  }

  setChatLabel(chatId: string, labelId: number, on: boolean): void {
    if (on) this.db.prepare('INSERT OR IGNORE INTO chat_labels (chat_id, label_id) VALUES (?, ?)').run(chatId, labelId);
    else this.db.prepare('DELETE FROM chat_labels WHERE chat_id = ? AND label_id = ?').run(chatId, labelId);
  }

  // --- Profile pictures ---

  getProfilePic(id: string): { file: string | null; fetchedAt: number } | undefined {
    const row = this.db.prepare('SELECT file, fetched_at FROM profile_pics WHERE id = ?').get(id) as
      | { file: string | null; fetched_at: number }
      | undefined;
    return row && { file: row.file, fetchedAt: row.fetched_at };
  }

  setProfilePic(id: string, file: string | null, fetchedAt = Date.now()): void {
    this.db
      .prepare('INSERT OR REPLACE INTO profile_pics (id, file, fetched_at) VALUES (?, ?, ?)')
      .run(id, file, fetchedAt);
  }

  /** Marks a picture as out of date so it's fetched again next time it's shown. */
  expireProfilePic(id: string): void {
    this.db.prepare('UPDATE profile_pics SET fetched_at = 0 WHERE id = ?').run(id);
  }

  // --- Call log ---

  upsertCall(call: {
    id: string;
    chatId: string;
    fromMe?: boolean;
    isVideo?: boolean;
    isGroup?: boolean;
    status: CallStatus;
    startedAt: number;
    endedAt?: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO calls (id, chat_id, from_me, is_video, is_group, status, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = CASE WHEN calls.status IN ('auto-rejected') THEN calls.status ELSE excluded.status END,
           is_video = MAX(calls.is_video, excluded.is_video),
           ended_at = COALESCE(excluded.ended_at, calls.ended_at)`,
      )
      .run(
        call.id,
        call.chatId,
        call.fromMe ? 1 : 0,
        call.isVideo ? 1 : 0,
        call.isGroup ? 1 : 0,
        call.status,
        call.startedAt,
        call.endedAt ?? null,
      );
  }

  getCall(id: string): { status: CallStatus; startedAt: number } | undefined {
    const row = this.db.prepare('SELECT status, started_at FROM calls WHERE id = ?').get(id) as
      | { status: CallStatus; started_at: number }
      | undefined;
    return row && { status: row.status, startedAt: row.started_at };
  }

  listCalls(limit = 500): CallRecord[] {
    const rows = this.db
      .prepare(
        `SELECT k.*, ${NAME_SQL} AS name FROM calls k
         LEFT JOIN chats c ON c.id = k.chat_id
         LEFT JOIN contacts ct ON ct.id = k.chat_id
         ORDER BY k.started_at DESC LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      chat_id: string;
      from_me: number;
      is_video: number;
      is_group: number;
      status: CallStatus;
      started_at: number;
      ended_at: number | null;
      name: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      chatId: r.chat_id,
      chatName: r.name || fallbackName(r.chat_id),
      fromMe: r.from_me === 1,
      isVideo: r.is_video === 1,
      isGroup: r.is_group === 1,
      status: r.status,
      startedAt: r.started_at,
      endedAt: r.ended_at ?? undefined,
    }));
  }

  // --- Search ---

  /** Full-text search over message text, newest first. */
  searchMessages(query: string, chatId?: string, limit = 100): SearchResult[] {
    const match = ftsQuery(query);
    if (!match) return [];
    const rows = this.db
      .prepare(
        `SELECT m.chat_id, m.id, m.from_me, m.kind, m.timestamp, m.author,
                snippet(messages_fts, 0, char(2), char(3), '…', 14) AS snippet,
                ${NAME_SQL} AS chat_name, COALESCE(au.name, au.notify, m.author_name) AS author_name
         FROM messages_fts
         JOIN messages m ON m.rowid = messages_fts.rowid
         LEFT JOIN chats c ON c.id = m.chat_id
         LEFT JOIN contacts ct ON ct.id = m.chat_id
         LEFT JOIN contacts au ON au.id = m.author
         WHERE messages_fts MATCH ? AND m.kind != 'deleted' AND m.chat_id != '${STATUS_CHAT}'
           AND (? IS NULL OR m.chat_id = ?)
         ORDER BY m.timestamp DESC LIMIT ?`,
      )
      .all(match, chatId ?? null, chatId ?? null, limit) as Array<{
      chat_id: string;
      id: string;
      from_me: number;
      kind: MessageKind;
      timestamp: number;
      author: string | null;
      snippet: string;
      chat_name: string | null;
      author_name: string | null;
    }>;
    return rows.map((r) => ({
      chatId: r.chat_id,
      chatName: r.chat_name || fallbackName(r.chat_id),
      messageId: r.id,
      fromMe: r.from_me === 1,
      authorName: r.author_name ?? undefined,
      kind: r.kind,
      timestamp: r.timestamp,
      snippet: r.snippet,
    }));
  }

  // --- Messages ---

  upsertMessage(m: StoredMessage): void {
    const media = m.media;
    this.db
      .prepare(
        `INSERT INTO messages (chat_id, id, from_me, author, author_name, kind, body, timestamp, ack,
                               raw, mime, file_name, file_size, seconds, ptt, thumb, width, height,
                               quoted, forwarded, extra)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
           height = COALESCE(excluded.height, messages.height),
           quoted = COALESCE(excluded.quoted, messages.quoted),
           forwarded = MAX(excluded.forwarded, messages.forwarded),
           extra = COALESCE(excluded.extra, messages.extra)`,
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
        m.quoted ? JSON.stringify(m.quoted) : null,
        m.forwarded ? 1 : 0,
        m.extra ? JSON.stringify(m.extra) : null,
      );
    this.upsertChat({ id: m.chatId, lastActivity: m.timestamp });
  }

  /** Records a reaction; an empty emoji removes it. Sender is a WhatsApp ID, or ME. */
  setReaction(chatId: string, messageId: string, sender: string, emoji: string, timestamp: number): void {
    if (!emoji) {
      this.db.prepare('DELETE FROM reactions WHERE chat_id = ? AND message_id = ? AND sender = ?').run(chatId, messageId, sender);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO reactions (chat_id, message_id, sender, emoji, timestamp) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, message_id, sender) DO UPDATE SET emoji = excluded.emoji, timestamp = excluded.timestamp
         WHERE excluded.timestamp >= reactions.timestamp`,
      )
      .run(chatId, messageId, sender, emoji, timestamp);
  }

  /** Records someone's poll vote (the option names they picked; empty to retract). */
  setPollVote(chatId: string, messageId: string, voter: string, options: string[], timestamp: number): void {
    this.db
      .prepare(
        `INSERT INTO poll_votes (chat_id, message_id, voter, options, timestamp) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, message_id, voter) DO UPDATE SET options = excluded.options, timestamp = excluded.timestamp
         WHERE excluded.timestamp >= poll_votes.timestamp`,
      )
      .run(chatId, messageId, voter, JSON.stringify(options), timestamp);
  }

  /** Status updates from the last 24 hours, oldest first. */
  listStatuses(now = Date.now()): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, COALESCE(ct.name, ct.notify) AS contact_name
         FROM messages m LEFT JOIN contacts ct ON ct.id = m.author
         WHERE m.chat_id = ? AND m.timestamp > ? AND m.kind != 'deleted'
         ORDER BY m.timestamp ASC`,
      )
      .all(STATUS_CHAT, Math.floor(now / 1000) - STATUS_LIFETIME_S) as unknown as MessageRow[];
    return rows.map((r) => this.toMessage(r, false));
  }

  /** Deletes status updates older than a day, with their downloaded files. Returns the file names. */
  pruneStatuses(now = Date.now()): string[] {
    const cutoff = Math.floor(now / 1000) - STATUS_LIFETIME_S;
    const files = this.db
      .prepare('SELECT local_file FROM messages WHERE chat_id = ? AND timestamp <= ? AND local_file IS NOT NULL')
      .all(STATUS_CHAT, cutoff) as Array<{ local_file: string }>;
    this.db.prepare('DELETE FROM messages WHERE chat_id = ? AND timestamp <= ?').run(STATUS_CHAT, cutoff);
    return files.map((f) => f.local_file);
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

  /** Deletes a message from this computer. Returns its downloaded file name, if any. */
  removeMessage(chatId: string, messageId: string): string | undefined {
    const file = this.getLocalFile(chatId, messageId);
    this.db.prepare('DELETE FROM messages WHERE chat_id = ? AND id = ?').run(chatId, messageId);
    this.db.prepare('DELETE FROM reactions WHERE chat_id = ? AND message_id = ?').run(chatId, messageId);
    return file;
  }

  getMessage(chatId: string, messageId: string): StoredMessage | undefined {
    const row = this.db
      .prepare(
        `SELECT m.*, COALESCE(ct.name, ct.notify) AS contact_name
         FROM messages m LEFT JOIN contacts ct ON ct.id = m.author
         WHERE m.chat_id = ? AND m.id = ?`,
      )
      .get(chatId, messageId) as MessageRow | undefined;
    return row ? this.decorate(chatId, [this.toMessage(row, true)])[0] : undefined;
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
    return this.decorate(chatId, rows.map((r) => this.toMessage(r, false)));
  }

  /** About `half` messages before and after one message, oldest first. */
  messagesAround(chatId: string, messageId: string, half = 50): ChatMessage[] {
    const target = this.db
      .prepare('SELECT timestamp, rowid FROM messages WHERE chat_id = ? AND id = ?')
      .get(chatId, messageId) as { timestamp: number } | undefined;
    if (!target) return this.listMessages(chatId);
    const select = `SELECT m.*, COALESCE(ct.name, ct.notify) AS contact_name
                    FROM messages m LEFT JOIN contacts ct ON ct.id = m.author WHERE m.chat_id = ?`;
    const before = this.db
      .prepare(`${select} AND m.timestamp < ? ORDER BY m.timestamp DESC LIMIT ?`)
      .all(chatId, target.timestamp, half) as unknown as MessageRow[];
    const after = this.db
      .prepare(`${select} AND m.timestamp >= ? ORDER BY m.timestamp ASC LIMIT ?`)
      .all(chatId, target.timestamp, half) as unknown as MessageRow[];
    const rows = [...before.reverse(), ...after];
    return this.decorate(chatId, rows.map((r) => this.toMessage(r, false)));
  }

  /** Adds reactions and poll results to messages of one chat. */
  private decorate<T extends ChatMessage>(chatId: string, messages: T[]): T[] {
    if (messages.length === 0) return messages;
    const ids = messages.map((m) => m.id);
    const placeholders = ids.map(() => '?').join(', ');
    const reactions = this.db
      .prepare(
        `SELECT message_id, emoji, COUNT(*) AS n, MAX(sender = '${ME}') AS mine, MIN(timestamp) AS first
         FROM reactions WHERE chat_id = ? AND message_id IN (${placeholders})
         GROUP BY message_id, emoji ORDER BY first`,
      )
      .all(chatId, ...ids) as Array<{ message_id: string; emoji: string; n: number; mine: number }>;
    const byMessage = new Map<string, ChatMessage['reactions']>();
    for (const r of reactions) {
      const list = byMessage.get(r.message_id) ?? [];
      list.push({ emoji: r.emoji, count: r.n, mine: r.mine === 1 });
      byMessage.set(r.message_id, list);
    }
    const polls = messages.filter((m) => m.poll);
    const votes = polls.length
      ? (this.db
          .prepare(
            `SELECT v.message_id, v.voter, v.options, COALESCE(ct.name, ct.notify) AS name
             FROM poll_votes v LEFT JOIN contacts ct ON ct.id = v.voter
             WHERE v.chat_id = ? AND v.message_id IN (${polls.map(() => '?').join(', ')})`,
          )
          .all(chatId, ...polls.map((p) => p.id)) as Array<{ message_id: string; voter: string; options: string; name: string | null }>)
      : [];
    for (const m of messages) {
      const list = byMessage.get(m.id);
      if (list) m.reactions = list;
      if (m.poll) {
        const mine = votes.filter((v) => v.message_id === m.id);
        let voters = 0;
        for (const v of mine) {
          const picked = safeJson<string[]>(v.options) ?? [];
          if (picked.length > 0) voters++;
          const who = v.voter === ME ? 'You' : v.name || fallbackName(v.voter);
          for (const option of m.poll.options) {
            if (!picked.includes(option.name)) continue;
            option.count++;
            option.voters.push(who);
            if (v.voter === ME) option.mine = true;
          }
        }
        m.poll.totalVoters = voters;
      }
    }
    return messages;
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
      forwarded: r.forwarded === 1 || undefined,
    };
    if (r.quoted) {
      const quoted = safeJson<QuotedMessage>(r.quoted);
      if (quoted) {
        if (quoted.author && !quoted.fromMe) quoted.authorName = this.contactName(quoted.author) ?? quoted.authorName;
        message.quoted = quoted;
      }
    }
    const extra = r.extra ? safeJson<MessageExtra>(r.extra) : undefined;
    if (extra?.poll) {
      message.poll = {
        selectableCount: extra.poll.selectableCount,
        totalVoters: 0,
        options: extra.poll.options.map((name) => ({ name, count: 0, voters: [], mine: false })),
      };
    }
    if (extra?.location) {
      const { thumb, ...location } = extra.location;
      message.location = { ...location, thumb: thumb ? `data:image/jpeg;base64,${thumb}` : undefined };
    }
    if (extra?.contacts) message.contacts = extra.contacts;
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
    if (includeRaw && extra) message.extra = extra;
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
      anchorAt: r.anchor_at,
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

function safeJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/**
 * Turns what the user typed into an FTS5 query: every word must appear, and the last word
 * may be the start of a longer one ("hel wor" finds "hello world").
 */
export function ftsQuery(input: string): string {
  const words = input
    .normalize('NFKC')
    .split(/[\s\p{P}]+/u)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (words.length === 0) return '';
  return words.map((w, i) => `"${w.replaceAll('"', '""')}"${i === words.length - 1 ? '*' : ''}`).join(' ');
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
