// Sends scheduled messages when they fall due.
// Runs in the main process, so it keeps working while the window is closed to the tray.

import { nextOccurrence } from '../shared/schedule.ts';
import type { DueMessage, Store } from './store';

export { nextOccurrence };

const TICK_MS = 15_000;
/** If the app was off for longer than this past the send time, the message counts as missed. */
const MISSED_AFTER_MS = 60 * 60 * 1000;
/** Failed sends keep retrying for this long before being marked failed. */
const RETRY_FOR_MS = 10 * 60 * 1000;
/** Pause between consecutive sends, so a backlog doesn't go out as a burst. */
const GAP_BETWEEN_SENDS_MS = 2_000;

/** The parts of the WhatsApp connection the scheduler needs. */
export interface Sender {
  readonly isOpen: boolean;
  sendScheduled(item: DueMessage): Promise<void>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
        await this.whatsapp.sendScheduled(item);
        const sentAt = Date.now();
        const next = nextOccurrence(item.anchorAt, item.rule, sentAt);
        if (next === null) {
          this.store.setScheduledStatus(item.id, 'sent', { sentAt, error: null });
        } else {
          this.store.setScheduledStatus(item.id, 'pending', { sendAt: next, sentAt, error: null });
        }
      } catch (err) {
        const giveUp = Date.now() - item.sendAt > RETRY_FOR_MS;
        this.store.setScheduledStatus(item.id, giveUp ? 'failed' : 'pending', { error: errorMessage(err) });
      }
      this.onChange();
      await sleep(this.gapMs);
    }
  }

  private skipMissed(item: DueMessage, now: number): void {
    const next = nextOccurrence(item.anchorAt, item.rule, now);
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
