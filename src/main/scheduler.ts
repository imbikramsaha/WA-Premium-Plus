// Sends scheduled messages when they fall due.
// Runs in the main process, so it keeps working while the window is closed to the tray.

import type { Repeat } from '../shared/types';
import type { DueMessage, Store } from './store';
import type { WhatsApp } from './whatsapp';

const TICK_MS = 15_000;
/** If the app was off for longer than this past the send time, the message counts as missed. */
const MISSED_AFTER_MS = 60 * 60 * 1000;
/** Failed sends keep retrying for this long before being marked failed. */
const RETRY_FOR_MS = 10 * 60 * 1000;
/** Pause between consecutive sends, so a backlog doesn't go out as a burst. */
const GAP_BETWEEN_SENDS_MS = 2_000;

/**
 * Next occurrence of a repeating schedule strictly after `after`.
 * Occurrences are counted from the original time (`anchorAt`), so a message scheduled
 * for the 31st goes out on the last day of shorter months without drifting.
 */
export function nextOccurrence(anchorAt: number, repeat: Repeat, after: number): number | null {
  if (repeat === 'none') return null;
  const anchor = new Date(anchorAt);
  for (let n = 1; ; n++) {
    let next: Date;
    if (repeat === 'monthly') {
      const year = anchor.getFullYear();
      const month = anchor.getMonth() + n;
      const lastDay = new Date(year, month + 1, 0).getDate();
      next = new Date(
        year,
        month,
        Math.min(anchor.getDate(), lastDay),
        anchor.getHours(),
        anchor.getMinutes(),
        anchor.getSeconds(),
      );
    } else {
      next = new Date(anchor);
      next.setDate(anchor.getDate() + n * (repeat === 'weekly' ? 7 : 1));
    }
    if (next.getTime() > after) return next.getTime();
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The parts of the WhatsApp connection the scheduler needs. */
type Sender = Pick<WhatsApp, 'isOpen' | 'sendText'>;

export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private runAgain = false;
  private readonly store: Store;
  private readonly whatsapp: Sender;
  private readonly onChange: () => void;
  private readonly gapMs: number;

  constructor(store: Store, whatsapp: Sender, onChange: () => void, options: { gapMs?: number } = {}) {
    this.store = store;
    this.whatsapp = whatsapp;
    this.onChange = onChange;
    this.gapMs = options.gapMs ?? GAP_BETWEEN_SENDS_MS;
  }

  start(): void {
    this.timer = setInterval(() => this.poke(), TICK_MS);
    this.poke();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Checks for due messages now (for example after the connection opens). */
  poke(): void {
    void this.runNow();
  }

  /** Sends everything that is due. Resolves when done. */
  async runNow(): Promise<void> {
    if (this.running) {
      this.runAgain = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.runAgain = false;
        await this.sendDue();
      } while (this.runAgain);
    } finally {
      this.running = false;
    }
  }

  private async sendDue(): Promise<void> {
    if (!this.whatsapp.isOpen) return;
    for (const item of this.store.dueScheduled(Date.now())) {
      if (!this.whatsapp.isOpen) return;
      const now = Date.now();
      if (now - item.sendAt > MISSED_AFTER_MS) {
        this.skipMissed(item, now);
        continue;
      }
      try {
        await this.whatsapp.sendText(item.chatId, item.body);
        const sentAt = Date.now();
        const next = nextOccurrence(item.anchorAt, item.repeat, sentAt);
        if (next === null) {
          this.store.setScheduledStatus(item.id, 'sent', { sentAt, error: null });
        } else {
          this.store.setScheduledStatus(item.id, 'pending', { sendAt: next, sentAt, error: null });
        }
      } catch (err) {
        const giveUp = Date.now() - item.sendAt > RETRY_FOR_MS;
        this.store.setScheduledStatus(item.id, giveUp ? 'failed' : 'pending', {
          error: errorMessage(err),
        });
      }
      this.onChange();
      await sleep(this.gapMs);
    }
  }

  private skipMissed(item: DueMessage, now: number): void {
    const next = nextOccurrence(item.anchorAt, item.repeat, now);
    if (next === null) {
      this.store.setScheduledStatus(item.id, 'missed', {
        error: 'WA Premium Plus was not running or not connected at the scheduled time.',
      });
    } else {
      // For repeating messages, skip the missed occurrence and wait for the next one.
      this.store.setScheduledStatus(item.id, 'pending', { sendAt: next });
    }
    this.onChange();
  }
}
