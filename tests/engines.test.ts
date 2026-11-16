import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import { Automation } from '../src/main/automation.ts';
import { Broadcasts, nextWindowStart } from '../src/main/broadcasts.ts';
import { Reminders } from '../src/main/reminders.ts';
import { Store } from '../src/main/store.ts';
import { signature, Webhooks } from '../src/main/webhooks.ts';
import type { ChatMessage } from '../src/shared/types.ts';

const PN = '919876543210@s.whatsapp.net';
const OTHER = '447700900123@s.whatsapp.net';

/** A stand-in for the WhatsApp connection that records what it sends. */
function fakeWhatsApp(onWhatsApp = (digits: string) => digits !== '15550000000') {
  const sent: Array<{ chatId: string; text: string; quotedId?: string }> = [];
  return {
    sent,
    isOpen: true,
    connection: { me: { id: '911111111111@s.whatsapp.net' } },
    async sendText(chatId: string, text: string, quotedId?: string) {
      sent.push({ chatId, text, quotedId });
      return 'ID';
    },
    async markRead() {},
    async rejectCall() {},
    async checkNumbers(phones: string[]) {
      return phones.map((p) => ({ phone: p, jid: onWhatsApp(p) ? `${p}@s.whatsapp.net` : undefined }));
    },
    async sendScheduled() {},
  };
}

function setup() {
  const store = new Store(':memory:');
  const whatsapp = fakeWhatsApp();
  const events: string[] = [];
  const alerts: string[] = [];
  const webhooks = new Webhooks(store, () => ({ id: 'main' }), () => undefined);
  const deps = {
    store,
    whatsapp: whatsapp as never,
    webhooks,
    emit: (e: { type: string }) => events.push(e.type),
    alert: (title: string) => alerts.push(title),
  };
  return { store, whatsapp, events, alerts, deps };
}

function incoming(chatId: string, body: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: `M${Math.random()}`, chatId, fromMe: false, kind: 'text', body, timestamp: Math.floor(Date.now() / 1000), ...extra };
}

// Automatic replies wait a few seconds to look natural; tests don't.
const realSetTimeout = globalThis.setTimeout;
function fastTimers() {
  globalThis.setTimeout = ((fn: () => void) => realSetTimeout(fn, 0)) as typeof setTimeout;
  return () => {
    globalThis.setTimeout = realSetTimeout;
  };
}

describe('Automation', () => {
  it('replies to keywords once per cooldown, and never to groups unless chosen', async () => {
    const restore = fastTimers();
    try {
      const { store, whatsapp, deps } = setup();
      store.upsertContact({ id: PN, name: 'Asha Rao' });
      const automation = new Automation(deps);
      automation.saveRule({
        name: 'Prices',
        enabled: true,
        config: {
          trigger: 'message',
          scope: 'people',
          match: { type: 'contains', text: 'price' },
          when: { mode: 'always' },
          actions: [{ type: 'reply', text: 'Hi {first_name}, prices are on our site.', quote: true }],
          cooldownMinutes: 60,
        },
      });
      const m = incoming(PN, 'What is the price?');
      await automation.onMessage(m, { notify: true });
      await automation.onMessage(incoming(PN, 'price again?'), { notify: true });
      await automation.onMessage(incoming('120363000000000001@g.us', 'price?', { author: OTHER }), { notify: true });
      await automation.onMessage(incoming(OTHER, 'hello'), { notify: true });
      await automation.onMessage({ ...incoming(OTHER, 'price'), fromMe: true }, { notify: true });
      assert.deepEqual(whatsapp.sent, [{ chatId: PN, text: 'Hi Asha, prices are on our site.', quotedId: m.id }]);
      assert.equal(automation.listRules()[0]!.fires, 1);
    } finally {
      restore();
    }
  });

  it('respects the hourly limit and skips old messages', async () => {
    const restore = fastTimers();
    try {
      const { whatsapp, deps } = setup();
      const automation = new Automation(deps);
      automation.saveSettings({ ...automation.settings(), maxRepliesPerHour: 2 });
      automation.saveRule({
        name: 'Away',
        enabled: true,
        config: { trigger: 'message', scope: 'people', when: { mode: 'always' }, actions: [{ type: 'reply', text: 'Away' }], cooldownMinutes: 0 },
      });
      for (let i = 0; i < 4; i++) await automation.onMessage(incoming(`9198765432${10 + i}@s.whatsapp.net`, 'hi'), { notify: true });
      await automation.onMessage(incoming(OTHER, 'hi', { timestamp: Math.floor(Date.now() / 1000) - 3600 }), { notify: true });
      assert.equal(whatsapp.sent.length, 2);
    } finally {
      restore();
    }
  });

  it('opts people out of broadcasts when they reply STOP', async () => {
    const restore = fastTimers();
    try {
      const { store, whatsapp, deps } = setup();
      const automation = new Automation(deps);
      await automation.onMessage(incoming(PN, 'Stop'), { notify: true });
      assert.ok(store.db.prepare('SELECT 1 FROM opt_outs WHERE jid = ?').get(PN));
      assert.equal(whatsapp.sent[0]!.text, "You won't get these messages any more.");
    } finally {
      restore();
    }
  });
});

describe('Broadcasts', () => {
  it('sends one by one, skipping opt-outs and numbers not on WhatsApp, within the daily limit', async () => {
    const { store, whatsapp, deps } = setup();
    const broadcasts = new Broadcasts({ ...deps, attachmentsDir: '/tmp' });
    const { id: listId, added, skipped } = broadcasts.createList({
      name: 'Customers',
      csv: {
        columns: ['Name', 'Phone', 'City'],
        phoneColumn: 1,
        nameColumn: 0,
        defaultCountryCode: '91',
        rows: [
          ['Asha', '98765 43210', 'Kolkata'],
          ['Rahul', '+44 7700 900123', 'London'],
          ['Nobody', '+1 555 000 0000', ''],
          ['Dup', '9876543210', ''],
          ['Bad', '12', ''],
          ['Carol', '+91 90000 00001', 'Pune'],
        ],
      },
    });
    assert.deepEqual([added, skipped], [4, 2]);
    broadcasts.addOptOut(OTHER);
    const id = await broadcasts.saveCampaign(undefined, {
      name: 'Offer',
      listId,
      body: '{Hi|Hi} {first_name} from {city}',
      dailyCap: 2,
      minDelay: 10,
      maxDelay: 20,
      optOutFooter: true,
      sendFrom: '00:00',
      sendUntil: '00:00',
    });
    broadcasts.startCampaign(id);
    await new Promise((r) => setTimeout(r, 20)); // let the tick that starting kicks off finish
    const now = Date.now();
    for (let i = 0; i < 8; i++) {
      store.db.prepare('UPDATE campaigns SET next_at = 0 WHERE id = ?').run(id); // skip the pauses
      await broadcasts.tick(now);
    }
    assert.deepEqual(
      whatsapp.sent.map((s) => s.text),
      ['Hi Asha from Kolkata\n\nReply STOP to stop these messages.', 'Hi Carol from Pune\n\nReply STOP to stop these messages.'],
    );
    const [campaign] = broadcasts.listCampaigns();
    assert.deepEqual(campaign!.counts, { total: 4, pending: 0, sent: 2, failed: 0, skipped: 2 });
    assert.equal(campaign!.status, 'done');
    const reasons = broadcasts.listRecipients(id).filter((r) => r.status === 'skipped').map((r) => r.error).sort();
    assert.deepEqual(reasons, ['Not on WhatsApp', 'Opted out']);
  });

  it('stops at the daily limit and continues the next day', async () => {
    const { store, whatsapp, deps } = setup();
    const broadcasts = new Broadcasts({ ...deps, attachmentsDir: '/tmp' });
    const { id: listId } = broadcasts.createList({ name: 'L', members: [{ jid: PN }, { jid: OTHER }] });
    const id = await broadcasts.saveCampaign(undefined, {
      name: 'C', listId, body: 'Hello', dailyCap: 1, minDelay: 10, maxDelay: 10, optOutFooter: false, sendFrom: '00:00', sendUntil: '00:00',
    });
    broadcasts.startCampaign(id);
    await new Promise((r) => setTimeout(r, 20));
    for (let i = 0; i < 3; i++) {
      store.db.prepare('UPDATE campaigns SET next_at = 0 WHERE id = ?').run(id);
      await broadcasts.tick();
    }
    assert.equal(whatsapp.sent.length, 1);
    const [c] = broadcasts.listCampaigns();
    assert.equal(c!.status, 'running');
    assert.ok(c!.nextAt! > Date.now() + 60_000, 'waits until tomorrow');
    assert.match(c!.lastError!, /Daily limit/);
  });

  it('only sends within the sending hours', () => {
    const at = (h: number) => new Date(2026, 10, 16, h).getTime();
    assert.equal(nextWindowStart(at(10), '09:00', '20:00'), at(10));
    assert.equal(nextWindowStart(at(7), '09:00', '20:00'), at(9));
    assert.equal(nextWindowStart(at(21), '09:00', '20:00'), at(9) + 86_400_000);
  });
});

describe('Reminders', () => {
  it('reminds when there is no reply, and settles when they reply', async () => {
    const { store, whatsapp, alerts, deps } = setup();
    const reminders = new Reminders(deps);
    reminders.create({ chatId: PN, note: 'Invoice', dueAt: Date.now() + 1000, onlyIfNoReply: true });
    reminders.create({ chatId: OTHER, note: '', dueAt: Date.now() + 1000, onlyIfNoReply: true, followUp: 'Any update, {first_name}?' });
    store.upsertContact({ id: OTHER, name: 'Rahul Sen' });
    reminders.onIncoming(PN); // Asha replied
    await reminders.check(Date.now() + 5000);
    assert.deepEqual(reminders.list().map((r) => [r.chatId, r.status]), [
      [PN, 'resolved'],
      [OTHER, 'done'],
    ]);
    assert.deepEqual(whatsapp.sent, [{ chatId: OTHER, text: 'Any update, Rahul?', quotedId: undefined }]);
    assert.equal(alerts.length, 1);
  });
});

describe('Webhooks', () => {
  it('posts signed JSON events', async () => {
    const received: Array<{ headers: Record<string, unknown>; body: string }> = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const store = new Store(':memory:');
      const webhooks = new Webhooks(store, () => ({ id: 'main', phone: '+911111111111' }), () => undefined);
      webhooks.save({ url: `http://127.0.0.1:${port}/hook`, events: ['message.received'], enabled: true });
      assert.throws(() => webhooks.save({ url: 'ftp://x', events: ['optout'], enabled: true }), /https/);
      const [hook] = webhooks.list();
      assert.equal(await webhooks.test(hook!.id), '200 OK');
      webhooks.dispatch('message.received', { body: 'hi' });
      webhooks.dispatch('optout', { body: 'not subscribed' });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(received.length, 2);
      const last = received[1]!;
      assert.equal(last.headers['x-wapp-event'], 'message.received');
      assert.equal(last.headers['x-wapp-signature'], signature(hook!.secret, last.body));
      const payload = JSON.parse(last.body);
      assert.deepEqual([payload.event, payload.account.phone, payload.data.body], ['message.received', '+911111111111', 'hi']);
    } finally {
      server.close();
    }
  });
});
