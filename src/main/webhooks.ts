// Outbound webhooks: POSTs events (new messages, calls, sent schedules...) as JSON to URLs the
// user chose, such as n8n, Zapier or a CRM. Each request is signed with the webhook's secret.

import { createHmac, randomBytes } from 'node:crypto';
import { WEBHOOK_EVENTS, type AppEvent, type Webhook, type WebhookEvent } from '../shared/types.ts';
import type { Store } from './store';

const TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [3_000, 20_000];

interface WebhookRow {
  id: number;
  url: string;
  secret: string;
  events: string;
  enabled: number;
  last_status: string | null;
  last_at: number | null;
}

export function signature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function checkWebhookUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error('Enter a full URL, like https://example.com/hook.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Webhook URLs must start with https:// or http://.');
  return parsed.toString();
}

export class Webhooks {
  private readonly store: Store;
  private readonly account: () => { id: string; phone?: string };
  private readonly emit: (event: AppEvent) => void;

  constructor(store: Store, account: () => { id: string; phone?: string }, emit: (event: AppEvent) => void) {
    this.store = store;
    this.account = account;
    this.emit = emit;
  }

  list(): Webhook[] {
    const rows = this.store.db.prepare('SELECT * FROM webhooks ORDER BY id').all() as unknown as WebhookRow[];
    return rows.map((r) => ({
      id: r.id,
      url: r.url,
      secret: r.secret,
      events: (JSON.parse(r.events) as WebhookEvent[]).filter((e) => WEBHOOK_EVENTS.includes(e)),
      enabled: r.enabled === 1,
      lastStatus: r.last_status ?? undefined,
      lastAt: r.last_at ?? undefined,
    }));
  }

  save(input: { id?: number; url: string; events: WebhookEvent[]; enabled: boolean }): void {
    const url = checkWebhookUrl(input.url);
    const events = input.events.filter((e) => WEBHOOK_EVENTS.includes(e));
    if (events.length === 0) throw new Error('Pick at least one event.');
    const db = this.store.db;
    if (input.id) {
      db.prepare('UPDATE webhooks SET url = ?, events = ?, enabled = ? WHERE id = ?').run(url, JSON.stringify(events), input.enabled ? 1 : 0, input.id);
    } else {
      db.prepare('INSERT INTO webhooks (url, secret, events, enabled, created_at) VALUES (?, ?, ?, ?, ?)').run(
        url,
        randomBytes(18).toString('base64url'),
        JSON.stringify(events),
        input.enabled ? 1 : 0,
        Date.now(),
      );
    }
    this.emit({ type: 'automation-changed' });
  }

  delete(id: number): void {
    this.store.db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
    this.emit({ type: 'automation-changed' });
  }

  /** Sends a test event to one webhook and returns the result. */
  async test(id: number): Promise<string> {
    const hook = this.list().find((h) => h.id === id);
    if (!hook) throw new Error('That webhook was deleted.');
    return this.deliver(hook, 'test' as WebhookEvent, { message: 'Hello from WA Premium Plus' }, false);
  }

  /** Sends an event to every enabled webhook that wants it. Never throws. */
  dispatch(event: WebhookEvent, data: unknown): void {
    for (const hook of this.list()) {
      if (hook.enabled && hook.events.includes(event)) void this.deliver(hook, event, data, true).catch(() => undefined);
    }
  }

  private async deliver(hook: Webhook, event: WebhookEvent, data: unknown, retry: boolean): Promise<string> {
    const body = JSON.stringify({ event, account: this.account(), timestamp: new Date().toISOString(), data });
    const attempts = retry ? RETRY_DELAYS_MS.length + 1 : 1;
    let status = '';
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
      try {
        const res = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'WA-Premium-Plus-Webhook/1',
            'x-wapp-event': event,
            'x-wapp-signature': signature(hook.secret, body),
          },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        status = `${res.status} ${res.statusText}`.trim();
        if (res.ok) break;
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break; // retrying won't help
      } catch (err) {
        status = `Failed: ${err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err)}`;
      }
    }
    this.store.db.prepare('UPDATE webhooks SET last_status = ?, last_at = ? WHERE id = ?').run(status, Date.now(), hook.id);
    this.emit({ type: 'automation-changed' });
    return status;
  }
}
