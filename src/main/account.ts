// One linked WhatsApp number: its connection, database, scheduler and automation.
// The app can run several accounts side by side; each keeps its data in its own folder.

import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppEvent, ChatMessage } from '../shared/types';
import { Scheduler } from './scheduler';
import { Store } from './store';
import { WhatsApp } from './whatsapp';

/** What an account needs from the app around it. */
export interface AccountHost {
  /** Delivers an event from this account (the app forwards the active account's to the window). */
  emit(accountId: string, event: AppEvent): void;
  /** Shows a desktop notification for an incoming message. */
  notify(accountId: string, message: ChatMessage, chatName: string): void;
  tempDir: string;
  offline: boolean;
}

const STATUS_PRUNE_MS = 30 * 60 * 1000;

export class Account {
  readonly id: string;
  readonly dir: string;
  readonly mediaDir: string;
  readonly attachmentsDir: string;
  readonly avatarsDir: string;
  readonly authDir: string;
  readonly store: Store;
  readonly whatsapp: WhatsApp;
  readonly scheduler: Scheduler;
  private pruneTimer: NodeJS.Timeout | undefined;

  constructor(id: string, dir: string, host: AccountHost) {
    this.id = id;
    this.dir = dir;
    this.mediaDir = join(dir, 'media');
    this.attachmentsDir = join(dir, 'attachments');
    this.avatarsDir = join(dir, 'avatars');
    this.authDir = join(dir, 'auth');
    this.store = new Store(join(dir, 'wapp.db'));
    this.store.mediaUrl = (fileName) => `wapp-media://${id}/media/${encodeURIComponent(fileName)}`;

    const emit = (event: AppEvent) => host.emit(id, event);
    let scheduler: Scheduler | null = null;
    this.whatsapp = new WhatsApp({
      authDir: this.authDir,
      mediaDir: this.mediaDir,
      avatarsDir: this.avatarsDir,
      avatarUrl: (fileName) => `wapp-media://${id}/avatar/${encodeURIComponent(fileName)}`,
      tempDir: join(host.tempDir, id),
      store: this.store,
      offline: host.offline,
      emit: (event) => {
        emit(event);
        if (event.type === 'connection' && event.state.status === 'open') scheduler?.poke();
      },
      onIncoming: (message, chatName) => host.notify(id, message, chatName),
    });
    scheduler = new Scheduler(this.store, this.whatsapp, () => emit({ type: 'scheduled-changed' }));
    this.scheduler = scheduler;
  }

  /** Local folder for files served to the window under wapp-media://<account>/<area>/. */
  folderFor(area: string): string | undefined {
    if (area === 'media') return this.mediaDir;
    if (area === 'avatar') return this.avatarsDir;
    return undefined;
  }

  start(): void {
    void this.whatsapp.start();
    this.scheduler.start();
    const prune = () => {
      for (const file of this.store.pruneStatuses()) void rm(join(this.mediaDir, file), { force: true });
    };
    prune();
    this.pruneTimer = setInterval(prune, STATUS_PRUNE_MS);
  }

  stop(): void {
    clearInterval(this.pruneTimer);
    this.scheduler.stop();
    this.whatsapp.stop();
  }

  close(): void {
    this.stop();
    this.store.close();
  }
}
