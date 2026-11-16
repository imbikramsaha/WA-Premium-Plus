// One linked WhatsApp number: its connection, database, scheduler and automation.
// The app can run several accounts side by side; each keeps its data in its own folder.

import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppEvent, ChatMessage } from '../shared/types';
import { Automation } from './automation';
import { Broadcasts } from './broadcasts';
import { Reminders } from './reminders';
import { Scheduler } from './scheduler';
import { Store } from './store';
import { Webhooks } from './webhooks';
import { WhatsApp } from './whatsapp';

/** What an account needs from the app around it. */
export interface AccountHost {
  /** Delivers an event from this account (the app forwards the active account's to the window). */
  emit(accountId: string, event: AppEvent): void;
  /** Shows a desktop notification for an incoming message. */
  notify(accountId: string, message: ChatMessage, chatName: string): void;
  /** Shows a desktop notification from automation; clicking it opens the chat. */
  alert(accountId: string, title: string, body: string, chatId?: string): void;
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
  readonly webhooks: Webhooks;
  readonly automation: Automation;
  readonly reminders: Reminders;
  readonly broadcasts: Broadcasts;
  private pruneTimer: NodeJS.Timeout | undefined;

  constructor(id: string, dir: string, host: AccountHost) {
    this.id = id;
    this.dir = dir;
    this.mediaDir = join(dir, 'media');
    this.attachmentsDir = join(dir, 'attachments');
    this.avatarsDir = join(dir, 'avatars');
    this.authDir = join(dir, 'auth');
    mkdirSync(dir, { recursive: true });
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
    const alert = (title: string, body: string, chatId?: string) => host.alert(id, title, body, chatId);
    this.webhooks = new Webhooks(
      this.store,
      () => {
        const me = this.whatsapp.connection.me;
        return { id, phone: me ? `+${me.id.split('@')[0]}` : undefined };
      },
      emit,
    );
    const deps = { store: this.store, whatsapp: this.whatsapp, webhooks: this.webhooks, emit, alert };
    this.automation = new Automation(deps);
    this.reminders = new Reminders(deps);
    this.broadcasts = new Broadcasts({ ...deps, attachmentsDir: this.attachmentsDir });
    scheduler = new Scheduler(this.store, this.whatsapp, () => emit({ type: 'scheduled-changed' }), {
      onResult: (item, error) =>
        this.webhooks.dispatch(error ? 'scheduled.failed' : 'scheduled.sent', {
          scheduledId: item.id,
          target: item.target,
          chatId: item.chatId,
          chatName: item.target === 'status' ? 'My status' : this.store.chatName(item.chatId),
          body: item.body,
          groupAction: item.groupAction,
          error,
        }),
    });
    this.scheduler = scheduler;

    this.whatsapp.on('message', (message, info) => {
      const { chatId } = message;
      if (info.notify && !message.fromMe) this.reminders.onIncoming(chatId);
      if (!chatId.endsWith('@broadcast')) {
        this.webhooks.dispatch(message.fromMe ? 'message.sent' : 'message.received', {
          ...message,
          chatName: this.store.chatName(chatId),
          media: message.media
            ? { mimetype: message.media.mimetype, fileName: message.media.fileName, size: message.media.size, seconds: message.media.seconds }
            : undefined,
        });
      }
      void this.automation.onMessage(message, info);
    });
    this.whatsapp.on('call', (call) => {
      void this.automation.onCall(call).then((rejected) =>
        this.webhooks.dispatch('call.received', { ...call, chatName: this.store.chatName(call.chatId), autoRejected: rejected }),
      );
    });
    this.whatsapp.on('group-participants', (update) => void this.automation.onGroupParticipants(update));
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
    this.reminders.start();
    this.broadcasts.start();
    const prune = () => {
      for (const file of this.store.pruneStatuses()) void rm(join(this.mediaDir, file), { force: true });
    };
    prune();
    this.pruneTimer = setInterval(prune, STATUS_PRUNE_MS);
  }

  stop(): void {
    clearInterval(this.pruneTimer);
    this.scheduler.stop();
    this.reminders.stop();
    this.broadcasts.stop();
    this.whatsapp.stop();
  }

  close(): void {
    this.stop();
    this.store.close();
  }
}
