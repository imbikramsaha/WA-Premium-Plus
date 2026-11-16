// Follow-up reminders: "remind me (or follow up for me) if they haven't replied by Friday".

import { personValues, renderTemplate } from '../shared/template.ts';
import type { AppEvent, Reminder, ReminderInput, ReminderStatus } from '../shared/types';
import { fallbackName, type Store } from './store.ts';
import type { Webhooks } from './webhooks';
import type { WhatsApp } from './whatsapp';

const TICK_MS = 30_000;

interface ReminderRow {
  id: number;
  chat_id: string;
  message_id: string | null;
  note: string;
  due_at: number;
  created_at: number;
  only_if_no_reply: number;
  follow_up: string | null;
  status: ReminderStatus;
  done_at: number | null;
}

export interface ReminderDeps {
  store: Store;
  whatsapp: WhatsApp;
  webhooks: Webhooks;
  emit: (event: AppEvent) => void;
  alert: (title: string, body: string, chatId?: string) => void;
}

export class Reminders {
  private readonly deps: ReminderDeps;
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(deps: ReminderDeps) {
    this.deps = deps;
  }

  start(): void {
    this.timer = setInterval(() => void this.check(), TICK_MS);
    void this.check();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  list(): Reminder[] {
    const rows = this.deps.store.db
      .prepare(`SELECT * FROM reminders ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, due_at`)
      .all() as unknown as ReminderRow[];
    return rows.map((r) => ({
      id: r.id,
      chatId: r.chat_id,
      chatName: this.deps.store.chatName(r.chat_id),
      messageId: r.message_id ?? undefined,
      note: r.note,
      dueAt: r.due_at,
      onlyIfNoReply: r.only_if_no_reply === 1,
      followUp: r.follow_up ?? undefined,
      status: r.status,
      createdAt: r.created_at,
      doneAt: r.done_at ?? undefined,
    }));
  }

  create(input: ReminderInput): void {
    if (input.dueAt <= Date.now()) throw new Error('Pick a time in the future.');
    this.deps.store.db
      .prepare(
        `INSERT INTO reminders (chat_id, message_id, note, due_at, created_at, only_if_no_reply, follow_up)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.chatId, input.messageId ?? null, input.note, input.dueAt, Date.now(), input.onlyIfNoReply ? 1 : 0, input.followUp?.trim() || null);
    this.deps.emit({ type: 'reminders-changed' });
  }

  cancel(id: number): void {
    this.setStatus(id, 'cancelled');
  }

  delete(id: number): void {
    this.deps.store.db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
    this.deps.emit({ type: 'reminders-changed' });
  }

  private setStatus(id: number, status: ReminderStatus): void {
    this.deps.store.db.prepare('UPDATE reminders SET status = ?, done_at = ? WHERE id = ?').run(status, Date.now(), id);
    this.deps.emit({ type: 'reminders-changed' });
  }

  /** They replied: reminders that only matter without a reply are settled. */
  onIncoming(chatId: string): void {
    const result = this.deps.store.db
      .prepare(`UPDATE reminders SET status = 'resolved', done_at = ? WHERE chat_id = ? AND status = 'pending' AND only_if_no_reply = 1`)
      .run(Date.now(), chatId);
    if (Number(result.changes) > 0) this.deps.emit({ type: 'reminders-changed' });
  }

  /** Runs reminders that are due. */
  async check(now = Date.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { store, whatsapp, webhooks, alert } = this.deps;
      for (const r of this.list().filter((x) => x.status === 'pending' && x.dueAt <= now)) {
        if (r.onlyIfNoReply && store.hasIncomingSince(r.chatId, r.createdAt)) {
          this.setStatus(r.id, 'resolved');
          continue;
        }
        const name = r.chatName || fallbackName(r.chatId);
        if (r.followUp) {
          if (!whatsapp.isOpen) continue; // wait for the connection
          try {
            const values = personValues(store.contactName(r.chatId), r.chatId.split('@')[0]);
            await whatsapp.sendText(r.chatId, renderTemplate(r.followUp, values));
            alert(`Follow-up sent to ${name}`, r.note || r.followUp, r.chatId);
          } catch (err) {
            alert(`Couldn't send the follow-up to ${name}`, err instanceof Error ? err.message : String(err), r.chatId);
          }
        } else {
          alert(r.onlyIfNoReply ? `${name} hasn't replied` : `Reminder: ${name}`, r.note || 'Time to follow up.', r.chatId);
        }
        this.setStatus(r.id, 'done');
        webhooks.dispatch('reminder.due', { chatId: r.chatId, chatName: name, note: r.note, followUpSent: Boolean(r.followUp) });
      }
    } finally {
      this.running = false;
    }
  }
}
