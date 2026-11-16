import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { computeInsights } from '../src/main/analytics.ts';
import { exportChat, safeFileName, toHtml } from '../src/main/export.ts';
import { Store } from '../src/main/store.ts';
import { parseCsv } from '../src/shared/csv.ts';

const PN = '919876543210@s.whatsapp.net';
const GROUP = '120363000000000001@g.us';

function at(daysAgo: number, hour: number, minute = 0): number {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function msg(chatId: string, id: string, fromMe: boolean, timestamp: number, body = 'hi', extra = {}) {
  return { chatId, id, fromMe, kind: 'text' as const, body, timestamp, ...extra };
}

describe('insights', () => {
  it('counts messages per day, busiest hours, top chats and reply times', () => {
    const store = new Store(':memory:');
    store.upsertContact({ id: PN, name: 'Asha' });
    store.upsertMessage(msg(PN, 'a', false, at(1, 10, 0)));
    store.upsertMessage(msg(PN, 'b', true, at(1, 10, 4))); // I replied in 4 minutes
    store.upsertMessage(msg(PN, 'c', false, at(1, 12, 4))); // they replied in 2 hours
    store.upsertMessage(msg(PN, 'd', true, at(0, 13, 0))); // more than a day later: not a reply
    store.upsertMessage(msg(GROUP, 'g', false, at(0, 9, 30), 'hello group', { author: PN }));
    store.upsertMessage(msg('status@broadcast', 's', false, at(0, 9, 0), 'status', { author: PN }));
    store.upsertMessage(msg(PN, 'old', false, at(40, 9, 0)));

    const insights = computeInsights(store, 7);
    assert.equal(insights.daily.length, 7);
    assert.deepEqual(insights.daily.at(-1), { day: insights.daily.at(-1)!.day, sent: 1, received: 1 });
    assert.deepEqual(insights.daily.at(-2)!.sent + insights.daily.at(-2)!.received, 3);
    assert.deepEqual([insights.totals.sent, insights.totals.received, insights.totals.chats], [2, 3, 2]);
    const yesterday = new Date(at(1, 10) * 1000).getDay();
    assert.equal(insights.heatmap[yesterday]![10], 2);
    assert.deepEqual(insights.topChats[0], { chatId: PN, name: 'Asha', sent: 2, received: 2 });
    assert.equal(insights.replyTimes.mine.median, 240);
    assert.deepEqual(insights.replyTimes.mine.buckets, [1, 0, 0, 0]);
    assert.equal(insights.replyTimes.theirs.median, 7200);
    assert.deepEqual(insights.replyTimes.theirs.buckets, [0, 0, 1, 0]);
  });
});

describe('export', () => {
  it('writes text, CSV, JSON and HTML with downloaded media', async () => {
    const store = new Store(':memory:');
    const dir = mkdtempSync(join(tmpdir(), 'wapp-export-'));
    const mediaDir = join(dir, 'media-store');
    mkdirSync(mediaDir);
    writeFileSync(join(mediaDir, 'photo.jpg'), 'JPEG');
    store.upsertContact({ id: PN, name: 'Asha <Rao>' });
    store.upsertMessage(msg(PN, 'a', false, at(1, 10), 'Hello, "friend"'));
    store.upsertMessage(msg(PN, 'b', true, at(1, 11), 'Nice pic', { kind: 'image', media: { mimetype: 'image/jpeg', downloadable: true } }));
    store.setLocalFile(PN, 'b', 'photo.jpg');
    store.upsertMessage(msg(PN, 'c', true, at(1, 12), 'Lunch?', { kind: 'poll', extra: { poll: { options: ['Yes', 'No'], selectableCount: 1 } } }));

    const txt = join(dir, 'chat.txt');
    await exportChat(store, mediaDir, 'Me', PN, 'txt', false, txt);
    const text = readFileSync(txt, 'utf8');
    assert.match(text, /\] Asha <Rao>: Hello, "friend"/);
    assert.match(text, /\] Me: <Photo> Nice pic/);
    assert.match(text, /Poll: Lunch\?\n {2}- Yes \(0\)/);

    const folder = join(dir, 'with-media');
    mkdirSync(folder);
    const result = await exportChat(store, mediaDir, 'Me', PN, 'csv', true, folder);
    assert.equal(result.mediaCopied, 1);
    assert.ok(existsSync(join(folder, 'media', 'photo.jpg')));
    const rows = parseCsv(readFileSync(result.path, 'utf8'));
    assert.deepEqual(rows[0]!.slice(0, 7), ['date', 'time', 'sender', 'from_me', 'type', 'text', 'file']);
    assert.deepEqual(rows[2]!.slice(2, 7), ['Me', 'true', 'image', '<Photo> Nice pic', 'media/photo.jpg']);

    const json = JSON.parse(readFileSync((await exportChat(store, mediaDir, 'Me', PN, 'json', false, join(dir, 'c.json'))).path, 'utf8'));
    assert.equal(json.messages.length, 3);
    assert.deepEqual(json.messages[2].poll.options.map((o: { name: string }) => o.name), ['Yes', 'No']);
  });

  it('escapes HTML and makes safe file names', () => {
    const html = toHtml('<script>', [{ message: msg(PN, 'x', false, at(0, 9), '<img src=x onerror=alert(1)>'), sender: 'A' }], false);
    assert.ok(!html.includes('<img src=x'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.equal(safeFileName('a/b:c*?"<>|'), 'a b c');
    assert.equal(safeFileName('...'), 'Chat');
  });
});
