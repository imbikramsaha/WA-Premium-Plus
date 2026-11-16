import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { ftsQuery, ME, Store } from '../src/main/store.ts';

const PN = '15550001111@s.whatsapp.net';
const LID = '123456789012345@lid';

function message(chatId: string, id: string, timestamp: number, extra: Record<string, unknown> = {}) {
  return { chatId, id, fromMe: false, kind: 'text' as const, body: `msg ${id}`, timestamp, ...extra };
}

describe('Store', () => {
  it('upgrades a version 1 database in place, keeping its data', () => {
    const file = join(tmpdir(), `wapp-test-${process.pid}-${Date.now()}.db`);
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
    assert.equal(scheduled!.groupAction, undefined);
    // Upgraded all the way to the current version, including the group-change column.
    const upgraded = new DatabaseSync(file);
    assert.equal((upgraded.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 4);
    const columns = (upgraded.prepare('PRAGMA table_info(scheduled_messages)').all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(columns.includes('group_action'));
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

  it('fills in a missing group sender when the message is synced again', () => {
    const store = new Store(':memory:');
    const group = '120363000000000001@g.us';
    store.upsertMessage(message(group, 'g1', 5));
    store.upsertMessage(message(group, 'g1', 5, { author: PN }));
    assert.equal(store.getMessage(group, 'g1')?.author, PN);
    assert.equal(store.countMissingAuthors(group), 0);
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

  it('indexes messages for search, including ones stored before the upgrade', () => {
    const file = join(tmpdir(), `wapp-fts-${process.pid}-${Date.now()}.db`);
    const first = new Store(file);
    first.upsertMessage({ ...message(PN, 'a', 10), body: 'Meet at the café tomorrow' });
    first.upsertMessage({ ...message(PN, 'b', 11), body: 'কাল দেখা হবে' });
    first.close();
    // Pretend it was a version 3 database: the index is rebuilt on opening.
    const raw = new DatabaseSync(file);
    raw.exec('DROP TABLE messages_fts; DROP TRIGGER messages_fts_insert; DROP TRIGGER messages_fts_delete; DROP TRIGGER messages_fts_update; PRAGMA user_version = 3');
    raw.close();

    const store = new Store(file);
    assert.deepEqual(store.searchMessages('cafe').map((r) => r.messageId), ['a']); // accents ignored
    assert.deepEqual(store.searchMessages('দেখা').map((r) => r.messageId), ['b']);
    assert.deepEqual(store.searchMessages('tomo').map((r) => r.messageId), ['a']); // prefix of the last word
    assert.match(store.searchMessages('café')[0]!.snippet, /\u0002café\u0003/);

    store.editMessage(PN, 'a', 'Meet at the station');
    assert.equal(store.searchMessages('café').length, 0);
    assert.equal(store.searchMessages('station').length, 1);
    store.markDeleted(PN, 'a');
    assert.equal(store.searchMessages('station').length, 0);
    assert.equal(store.searchMessages('"').length, 0); // nothing searchable: no error
    assert.equal(ftsQuery('  '), '');
  });

  it('collects reactions and poll votes onto messages', () => {
    const store = new Store(':memory:');
    store.upsertMessage({
      ...message(PN, 'p', 10),
      kind: 'poll',
      body: 'Lunch?',
      extra: { poll: { options: ['Pizza', 'Salad'], selectableCount: 1 } },
    });
    store.setReaction(PN, 'p', ME, '👍', 1000);
    store.setReaction(PN, 'p', PN, '👍', 1001);
    store.setReaction(PN, 'p', PN, '❤️', 1002); // replaces their 👍
    store.setReaction(PN, 'p', PN, '😂', 900); // older: ignored
    store.setPollVote(PN, 'p', ME, ['Pizza'], 1000);
    store.setPollVote(PN, 'p', PN, ['Salad'], 1000);
    store.upsertContact({ id: PN, name: 'Priya' });

    const [m] = store.listMessages(PN);
    assert.deepEqual(m!.reactions, [
      { emoji: '👍', count: 1, mine: true },
      { emoji: '❤️', count: 1, mine: false },
    ]);
    assert.equal(m!.poll!.totalVoters, 2);
    assert.deepEqual(
      m!.poll!.options.map((o) => [o.name, o.count, o.mine, o.voters]),
      [
        ['Pizza', 1, true, ['You']],
        ['Salad', 1, false, ['Priya']],
      ],
    );
    store.setReaction(PN, 'p', ME, '', 2000);
    assert.deepEqual(store.getMessage(PN, 'p')!.reactions, [{ emoji: '❤️', count: 1, mine: false }]);
  });

  it('keeps chat flags and labels, and lists pinned chats first', () => {
    const store = new Store(':memory:');
    const other = '15550002222@s.whatsapp.net';
    store.upsertChat({ id: PN, lastActivity: 10 });
    store.upsertChat({ id: other, lastActivity: 20 });
    store.upsertChat({ id: PN, pinned: 5000, mutedUntil: -1 });
    store.upsertChat({ id: PN, lastActivity: 11 }); // a later update without flags keeps them
    const label = store.saveLabel({ name: 'Customers', color: 2 });
    store.setChatLabel(PN, label, true);

    const [first, second] = store.listChats();
    assert.equal(first!.id, PN);
    assert.equal(first!.pinned, true);
    assert.equal(first!.mutedUntil, -1);
    assert.deepEqual(first!.labels, [label]);
    assert.equal(second!.pinned, false);
    assert.ok(store.isMuted(PN));
    assert.deepEqual(store.listLabels(), [{ id: label, name: 'Customers', color: 2, count: 1 }]);

    store.upsertChat({ id: PN, archived: true, pinned: 0 });
    assert.equal(store.listChats().find((c) => c.id === PN)!.archived, true);
    store.deleteLabel(label);
    assert.deepEqual(store.listChats().find((c) => c.id === PN)!.labels, []);
  });

  it('keeps status updates for a day, out of the chat list', () => {
    const store = new Store(':memory:');
    const now = Date.now();
    const nowS = Math.floor(now / 1000);
    store.upsertMessage({ ...message('status@broadcast', 's1', nowS - 60), author: PN });
    store.upsertMessage({ ...message('status@broadcast', 's0', nowS - 2 * 86_400), author: PN });
    assert.deepEqual(store.listStatuses(now).map((m) => m.id), ['s1']);
    assert.equal(store.listChats().some((c) => c.id === 'status@broadcast'), false);
    store.pruneStatuses(now);
    assert.equal(store.getMessage('status@broadcast', 's0'), undefined);
    assert.ok(store.getMessage('status@broadcast', 's1'));
  });

  it('records calls without overwriting an auto-rejected status', () => {
    const store = new Store(':memory:');
    store.upsertCall({ id: 'c1', chatId: PN, status: 'missed', startedAt: 1000 });
    store.upsertCall({ id: 'c1', chatId: PN, status: 'auto-rejected', startedAt: 1000 });
    store.upsertCall({ id: 'c1', chatId: PN, status: 'rejected', startedAt: 1000, endedAt: 2000 });
    const [call] = store.listCalls();
    assert.equal(call!.status, 'auto-rejected');
    assert.equal(call!.endedAt, 2000);
  });
});
