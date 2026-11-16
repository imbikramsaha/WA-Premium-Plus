import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nextOccurrence, Scheduler } from '../src/main/scheduler.ts';
import { Store } from '../src/main/store.ts';

const HOUR = 60 * 60 * 1000;
const CHAT = '15550001111@s.whatsapp.net';

function setup({ connected = true, failWith }: { connected?: boolean; failWith?: string } = {}) {
  const store = new Store(':memory:');
  const sent: Array<{ chatId: string; text: string }> = [];
  const whatsapp = {
    isOpen: connected,
    async sendText(chatId: string, text: string) {
      if (failWith) throw new Error(failWith);
      sent.push({ chatId, text });
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

/** Inserts a scheduled message whose send time is in the past (createScheduled rejects nothing; IPC does). */
function schedule(store: Store, sendAt: number, repeat: 'none' | 'daily' | 'weekly' | 'monthly' = 'none') {
  store.createScheduled({ chatId: CHAT, body: 'Hello', sendAt, repeat });
}

describe('nextOccurrence', () => {
  it('returns null for one-off messages', () => {
    assert.equal(nextOccurrence(Date.now(), 'none', Date.now()), null);
  });

  it('adds days and weeks in local time', () => {
    const anchor = new Date(2026, 0, 10, 9, 30).getTime();
    assert.equal(nextOccurrence(anchor, 'daily', anchor), new Date(2026, 0, 11, 9, 30).getTime());
    assert.equal(nextOccurrence(anchor, 'weekly', anchor), new Date(2026, 0, 17, 9, 30).getTime());
  });

  it('skips past occurrences', () => {
    const anchor = new Date(2026, 0, 10, 9, 0).getTime();
    const after = new Date(2026, 0, 15, 12, 0).getTime();
    assert.equal(nextOccurrence(anchor, 'daily', after), new Date(2026, 0, 16, 9, 0).getTime());
  });

  it('keeps month-end dates without drifting', () => {
    const anchor = new Date(2026, 0, 31, 8, 0).getTime();
    const feb = nextOccurrence(anchor, 'monthly', anchor)!;
    assert.equal(feb, new Date(2026, 1, 28, 8, 0).getTime());
    const mar = nextOccurrence(anchor, 'monthly', feb)!;
    assert.equal(mar, new Date(2026, 2, 31, 8, 0).getTime());
  });
});

describe('Scheduler', () => {
  it('sends a due one-off message and marks it sent', async () => {
    const { store, sent, scheduler, only } = setup();
    schedule(store, Date.now() - 1000);
    await scheduler.runNow();
    assert.deepEqual(sent, [{ chatId: CHAT, text: 'Hello' }]);
    assert.equal(only().status, 'sent');
    assert.ok(only().lastSentAt);
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
    schedule(store, sendAt, 'daily');
    await scheduler.runNow();
    assert.equal(sent.length, 1);
    assert.equal(only().status, 'pending');
    assert.equal(only().sendAt, nextOccurrence(sendAt, 'daily', Date.now()));
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
    const sendAt = Date.now() - 2 * HOUR;
    schedule(store, sendAt, 'daily');
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
