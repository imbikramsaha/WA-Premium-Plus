import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeRule, firstOccurrence, nextOccurrence, normalizeRule } from '../src/shared/schedule.ts';
import type { RepeatRule } from '../src/shared/types.ts';
import { Scheduler } from '../src/main/scheduler.ts';
import { Store, type DueMessage } from '../src/main/store.ts';

const HOUR = 60 * 60 * 1000;
const CHAT = '15550001111@s.whatsapp.net';
const at = (y: number, m: number, d: number, h = 9, min = 0) => new Date(y, m - 1, d, h, min).getTime();

function setup({ connected = true, failWith }: { connected?: boolean; failWith?: string } = {}) {
  const store = new Store(':memory:');
  const sent: DueMessage[] = [];
  const whatsapp = {
    isOpen: connected,
    async sendScheduled(item: DueMessage) {
      if (failWith) throw new Error(failWith);
      sent.push(item);
    },
  };
  const scheduler = new Scheduler(store, whatsapp, () => undefined, { gapMs: 0 });
  const only = () => {
    const all = store.listScheduled();
    assert.equal(all.length, 1);
    return all[0]!;
  };
  return { store, sent, scheduler, only };
}

function schedule(store: Store, sendAt: number, rule: RepeatRule = { repeat: 'none' }) {
  store.createScheduled({ target: 'chat', chatId: CHAT, body: 'Hello', sendAt, rule });
}

describe('nextOccurrence', () => {
  it('returns null for one-off messages', () => {
    assert.equal(nextOccurrence(Date.now(), { repeat: 'none' }, Date.now()), null);
  });

  it('handles daily, weekly and yearly rules in local time', () => {
    const anchor = at(2026, 1, 10, 9, 30);
    assert.equal(nextOccurrence(anchor, { repeat: 'daily' }, anchor), at(2026, 1, 11, 9, 30));
    assert.equal(nextOccurrence(anchor, { repeat: 'weekly' }, anchor), at(2026, 1, 17, 9, 30));
    assert.equal(nextOccurrence(anchor, { repeat: 'yearly' }, anchor), at(2027, 1, 10, 9, 30));
  });

  it('skips past occurrences', () => {
    const anchor = at(2026, 1, 10);
    assert.equal(nextOccurrence(anchor, { repeat: 'daily' }, at(2026, 1, 15, 12)), at(2026, 1, 16));
  });

  it('keeps month-end dates without drifting', () => {
    const anchor = at(2026, 1, 31, 8);
    const feb = nextOccurrence(anchor, { repeat: 'monthly' }, anchor)!;
    assert.equal(feb, at(2026, 2, 28, 8));
    assert.equal(nextOccurrence(anchor, { repeat: 'monthly' }, feb), at(2026, 3, 31, 8));
  });

  it('sends a 29 February yearly message on 28 February in other years', () => {
    const anchor = at(2028, 2, 29);
    assert.equal(nextOccurrence(anchor, { repeat: 'yearly' }, anchor), at(2029, 2, 28));
  });

  it('skips weekends for weekday rules', () => {
    const friday = at(2026, 11, 20);
    assert.equal(nextOccurrence(friday, { repeat: 'weekdays' }, friday), at(2026, 11, 23)); // Monday
  });

  it('supports every N days and every N months', () => {
    const anchor = at(2026, 1, 1);
    assert.equal(nextOccurrence(anchor, { repeat: 'custom', interval: 3, unit: 'day' }, anchor), at(2026, 1, 4));
    assert.equal(nextOccurrence(anchor, { repeat: 'custom', interval: 2, unit: 'month' }, anchor), at(2026, 3, 1));
  });

  it('supports chosen weekdays every N weeks', () => {
    // Monday 16 Nov 2026; Mondays and Wednesdays, every 2 weeks.
    const anchor = at(2026, 11, 16);
    const rule: RepeatRule = { repeat: 'custom', interval: 2, unit: 'week', weekdays: [1, 3] };
    const first = nextOccurrence(anchor, rule, anchor)!;
    assert.equal(first, at(2026, 11, 18)); // Wednesday the same week
    const second = nextOccurrence(anchor, rule, first)!;
    assert.equal(second, at(2026, 11, 30)); // Monday two weeks later
  });

  it('stops after the end date', () => {
    const anchor = at(2026, 1, 1);
    const rule: RepeatRule = { repeat: 'daily', endAt: at(2026, 1, 2, 23, 59) };
    assert.equal(nextOccurrence(anchor, rule, anchor), at(2026, 1, 2));
    assert.equal(nextOccurrence(anchor, rule, at(2026, 1, 2)), null);
  });
});

describe('firstOccurrence', () => {
  it('keeps the chosen time when the rule allows that day', () => {
    const monday = at(2026, 11, 16);
    assert.equal(firstOccurrence(monday, { repeat: 'weekdays' }), monday);
    assert.equal(firstOccurrence(monday, { repeat: 'daily' }), monday);
  });

  it('moves to the next allowed day otherwise', () => {
    const tuesday = at(2026, 11, 17);
    const rule: RepeatRule = { repeat: 'custom', interval: 1, unit: 'week', weekdays: [1, 3] };
    assert.equal(firstOccurrence(tuesday, rule), at(2026, 11, 18)); // Wednesday
    const saturday = at(2026, 11, 21);
    assert.equal(firstOccurrence(saturday, { repeat: 'weekdays' }), at(2026, 11, 23)); // Monday
  });
});

describe('normalizeRule and describeRule', () => {
  it('rejects invalid rules', () => {
    assert.throws(() => normalizeRule({ repeat: 'hourly' }));
    assert.throws(() => normalizeRule({ repeat: 'custom', interval: 0, unit: 'day' }));
    assert.throws(() => normalizeRule({ repeat: 'custom', interval: 1, unit: 'week', weekdays: [] }));
  });

  it('drops fields that do not apply', () => {
    assert.deepEqual(normalizeRule({ repeat: 'daily', interval: 5, weekdays: [1] }), { repeat: 'daily' });
    assert.deepEqual(normalizeRule({ repeat: 'none', endAt: 123 }), { repeat: 'none' });
  });

  it('describes rules', () => {
    const anchor = at(2026, 11, 16);
    assert.equal(describeRule({ repeat: 'weekdays' }, anchor), 'Every weekday (Mon–Fri)');
    assert.match(
      describeRule({ repeat: 'custom', interval: 2, unit: 'week', weekdays: [1, 3] }, anchor),
      /^Every 2 weeks on Mon, Wed$/,
    );
  });
});

describe('Scheduler', () => {
  it('sends a due one-off message and marks it sent', async () => {
    const { store, sent, scheduler, only } = setup();
    schedule(store, Date.now() - 1000);
    await scheduler.runNow();
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.chatId, CHAT);
    assert.equal(sent[0]!.body, 'Hello');
    assert.equal(only().status, 'sent');
    assert.equal(only().sentCount, 1);
  });

  it('does not send messages that are not due yet', async () => {
    const { store, sent, scheduler, only } = setup();
    schedule(store, Date.now() + HOUR);
    await scheduler.runNow();
    assert.equal(sent.length, 0);
    assert.equal(only().status, 'pending');
  });

  it('reschedules a repeating message after sending it', async () => {
    const { store, sent, scheduler, only } = setup();
    const sendAt = Date.now() - 1000;
    schedule(store, sendAt, { repeat: 'daily' });
    await scheduler.runNow();
    assert.equal(sent.length, 1);
    assert.equal(only().status, 'pending');
    assert.equal(only().sendAt, nextOccurrence(sendAt, { repeat: 'daily' }, Date.now()));
  });

  it('finishes a repeating message once its end date has passed', async () => {
    const { store, scheduler, only } = setup();
    const sendAt = Date.now() - 1000;
    schedule(store, sendAt, { repeat: 'daily', endAt: Date.now() + HOUR });
    await scheduler.runNow();
    assert.equal(only().status, 'sent');
  });

  it('passes attachments and status targets to the sender', async () => {
    const { store, sent, scheduler } = setup();
    store.createScheduled({
      target: 'status',
      chatId: 'status@broadcast',
      body: 'Caption',
      sendAt: Date.now() - 1000,
      rule: { repeat: 'none' },
      attachment: { path: '/tmp/photo.jpg', name: 'photo.jpg', mimetype: 'image/jpeg', kind: 'image', size: 10 },
    });
    await scheduler.runNow();
    assert.equal(sent[0]!.target, 'status');
    assert.equal(sent[0]!.attachment?.kind, 'image');
    assert.equal(store.listScheduled()[0]!.chatName, 'My status');
  });

  it('marks a long-overdue one-off message as missed instead of sending it', async () => {
    const { store, sent, scheduler, only } = setup();
    schedule(store, Date.now() - 2 * HOUR);
    await scheduler.runNow();
    assert.equal(sent.length, 0);
    assert.equal(only().status, 'missed');
  });

  it('skips a missed occurrence of a repeating message', async () => {
    const { store, sent, scheduler, only } = setup();
    schedule(store, Date.now() - 2 * HOUR, { repeat: 'daily' });
    await scheduler.runNow();
    assert.equal(sent.length, 0);
    assert.equal(only().status, 'pending');
    assert.ok(only().sendAt > Date.now());
  });

  it('keeps retrying a recent failure, then gives up', async () => {
    const recent = setup({ failWith: 'network down' });
    schedule(recent.store, Date.now() - 1000);
    await recent.scheduler.runNow();
    assert.equal(recent.only().status, 'pending');
    assert.equal(recent.only().lastError, 'network down');

    const old = setup({ failWith: 'network down' });
    schedule(old.store, Date.now() - 30 * 60 * 1000);
    await old.scheduler.runNow();
    assert.equal(old.only().status, 'failed');
  });

  it('waits while WhatsApp is disconnected', async () => {
    const { store, sent, scheduler, only } = setup({ connected: false });
    schedule(store, Date.now() - 1000);
    await scheduler.runNow();
    assert.equal(sent.length, 0);
    assert.equal(only().status, 'pending');
  });
});
