import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { Store } from '../src/main/store.ts';

const PN = '15550001111@s.whatsapp.net';
const LID = '123456789012345@lid';

function message(chatId: string, id: string, timestamp: number, extra: Record<string, unknown> = {}) {
  return { chatId, id, fromMe: false, kind: 'text' as const, body: `msg ${id}`, timestamp, ...extra };
}

describe('Store', () => {
  it('upgrades a version 1 database in place, keeping its data', () => {
    const file = `${process.env.TMPDIR ?? '/tmp'}/wapp-test-${process.pid}-${Date.now()}.db`;
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE chats (id TEXT PRIMARY KEY, name TEXT, unread_count INTEGER NOT NULL DEFAULT 0, last_activity INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE messages (chat_id TEXT NOT NULL, id TEXT NOT NULL, from_me INTEGER NOT NULL, author TEXT, author_name TEXT,
        kind TEXT NOT NULL, body TEXT NOT NULL, timestamp INTEGER NOT NULL, ack TEXT, PRIMARY KEY (chat_id, id));
      CREATE TABLE scheduled_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, body TEXT NOT NULL,
        anchor_at INTEGER NOT NULL, send_at INTEGER NOT NULL, repeat TEXT NOT NULL DEFAULT 'none',
        status TEXT NOT NULL DEFAULT 'pending', last_error TEXT, last_sent_at INTEGER, created_at INTEGER NOT NULL);
      INSERT INTO chats VALUES ('${PN}', 'Priya', 0, 10);
      INSERT INTO messages VALUES ('${PN}', 'a', 0, NULL, NULL, 'text', 'hi', 10, NULL);
      INSERT INTO scheduled_messages (chat_id, body, anchor_at, send_at, repeat, created_at) VALUES ('${PN}', 'later', 1, 1, 'weekly', 1);
    `);
    old.close();

    const store = new Store(file);
    assert.equal(store.listMessages(PN)[0]!.body, 'hi');
    const [scheduled] = store.listScheduled();
    assert.deepEqual(scheduled!.rule, { repeat: 'weekly' });
    assert.equal(scheduled!.target, 'chat');
    assert.equal(scheduled!.chatName, 'Priya');
  });

  it('merges a privacy-ID chat into the phone-number chat', () => {
    const store = new Store(':memory:');
    store.upsertChat({ id: PN, name: null, unreadCount: 1, lastActivity: 5 });
    store.upsertChat({ id: LID, name: null, unreadCount: 2, lastActivity: 20 });
    store.upsertContact({ id: LID, notify: 'Priya' });
    store.upsertMessage(message(PN, 'a', 5));
    store.upsertMessage(message(LID, 'b', 20));
    store.upsertMessage(message(LID, 'a', 5)); // same message seen under both IDs
    store.createScheduled({ target: 'chat', chatId: LID, body: 'x', sendAt: Date.now() + 1000, rule: { repeat: 'none' } });

    assert.deepEqual(store.unresolvedLids(), [LID]);
    store.mergeLid(LID, PN);

    const chats = store.listChats();
    assert.equal(chats.length, 1);
    assert.equal(chats[0]!.id, PN);
    assert.equal(chats[0]!.name, 'Priya');
    assert.equal(chats[0]!.unreadCount, 3);
    assert.deepEqual(store.listMessages(PN).map((m) => m.id), ['a', 'b']);
    assert.equal(store.listScheduled()[0]!.chatId, PN);
    assert.deepEqual(store.unresolvedLids(), []);
  });

  it('applies edits and deletions', () => {
    const store = new Store(':memory:');
    store.upsertMessage(message(PN, 'a', 5));
    assert.equal(store.editMessage(PN, 'a', 'fixed typo')?.body, 'fixed typo');
    assert.equal(store.getMessage(PN, 'a')?.edited, true);
    const deleted = store.markDeleted(PN, 'a');
    assert.equal(deleted?.kind, 'deleted');
    assert.equal(deleted?.body, '');
    // A late duplicate of the original must not bring it back.
    store.upsertMessage(message(PN, 'a', 5));
    assert.equal(store.getMessage(PN, 'a')?.kind, 'deleted');
  });

  it('keeps media details and serves downloaded files by URL', () => {
    const store = new Store(':memory:');
    store.upsertMessage(
      message(PN, 'img', 5, {
        kind: 'image',
        body: '',
        raw: '{"key":{}}',
        media: { mimetype: 'image/jpeg', size: 1234, width: 4, height: 3, thumb: 'AAAA', downloadable: true },
      }),
    );
    let m = store.listMessages(PN)[0]!;
    assert.equal(m.media?.thumb, 'data:image/jpeg;base64,AAAA');
    assert.equal(m.media?.downloadable, true);
    assert.equal(m.media?.url, undefined);
    store.setLocalFile(PN, 'img', 'abc.jpg');
    m = store.listMessages(PN)[0]!;
    assert.equal(m.media?.url, 'wapp-media://media/abc.jpg');
  });

  it('pages older messages', () => {
    const store = new Store(':memory:');
    for (let i = 1; i <= 5; i++) store.upsertMessage(message(PN, String(i), i));
    assert.deepEqual(store.listMessages(PN, 2).map((m) => m.id), ['4', '5']);
    assert.deepEqual(store.listMessages(PN, 2, 4).map((m) => m.id), ['2', '3']);
  });

  it('shows friendly names for unknown chats', () => {
    const store = new Store(':memory:');
    store.upsertChat({ id: LID });
    store.upsertChat({ id: PN });
    const names = store.listChats().map((c) => c.name).sort();
    assert.deepEqual(names, ['+15550001111', 'WhatsApp user']);
  });

  it('only deletes an attachment file when no other schedule uses it', () => {
    const store = new Store(':memory:');
    const attachment = { path: '/x/file.pdf', name: 'file.pdf', mimetype: 'application/pdf', kind: 'document' as const, size: 1 };
    const base = { target: 'chat' as const, body: '', sendAt: Date.now() + 1000, rule: { repeat: 'none' as const }, attachment };
    const a = store.createScheduled({ ...base, chatId: PN });
    const b = store.createScheduled({ ...base, chatId: '15550002222@s.whatsapp.net' });
    assert.equal(store.deleteScheduled(a), undefined);
    assert.equal(store.deleteScheduled(b), '/x/file.pdf');
  });
});
