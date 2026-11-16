// Manages the WhatsApp connection (via Baileys, the library behind WAHA's NOWEB engine)
// and keeps the local store in sync with it.

import { rm } from 'node:fs/promises';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  toNumber,
  useMultiFileAuthState,
  type Chat,
  type ConnectionState as BaileysConnectionState,
  type Contact,
  type proto,
  type WAMessage,
  type WASocket,
} from 'baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import type { AppEvent, ChatMessage, ConnectionState } from '../shared/types';
import { toAck, toChatMessage } from './messages';
import type { Store } from './store';

export interface WhatsAppOptions {
  authDir: string;
  store: Store;
  emit: (event: AppEvent) => void;
  /** Called for each new incoming message, for desktop notifications. */
  onIncoming?: (message: ChatMessage, chatName: string) => void;
}

const logger = pino({ level: process.env.WAPP_LOG_LEVEL ?? 'silent' });
const SENT_CACHE_LIMIT = 500;

type WaVersion = [number, number, number];

/**
 * WhatsApp rejects clients that report an outdated WhatsApp Web version, and the version
 * built into Baileys lags behind. Ask web.whatsapp.com for the current one first.
 */
async function currentWaWebVersion(): Promise<WaVersion | undefined> {
  const fromWeb = await fetchLatestWaWebVersion({}).catch(() => null);
  if (fromWeb?.isLatest) return fromWeb.version;
  const fromBaileys = await fetchLatestBaileysVersion().catch(() => null);
  return fromBaileys?.version;
}

export class WhatsApp {
  private sock: WASocket | null = null;
  private state: ConnectionState = { status: 'connecting', linked: false };
  private reconnectTimer: NodeJS.Timeout | undefined;
  private retries = 0;
  private stopped = true;
  /** Recently sent messages, so Baileys can re-send them if a recipient asks for a retry. */
  private readonly sentCache = new Map<string, proto.IMessage>();

  constructor(private readonly opts: WhatsAppOptions) {}

  get connection(): ConnectionState {
    return this.state;
  }

  get isOpen(): boolean {
    return this.state.status === 'open';
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    const sock = this.sock;
    this.sock = null;
    sock?.end(undefined);
  }

  async sendText(chatId: string, text: string): Promise<void> {
    const sock = this.sock;
    if (!sock || !this.isOpen) throw new Error('WhatsApp is not connected.');
    const sent = await sock.sendMessage(chatId, { text });
    if (sent) {
      if (sent.key.id && sent.message) this.rememberSent(sent.key.id, sent.message);
      this.handleMessages([sent], 'append');
    }
  }

  /** Clears the unread badge and sends read receipts for the latest incoming messages. */
  async markRead(chatId: string): Promise<void> {
    const unread = this.opts.store.resetUnread(chatId);
    if (unread === 0) return;
    this.opts.emit({ type: 'chats-changed' });
    const sock = this.sock;
    if (!sock || !this.isOpen) return;
    const keys = this.opts.store
      .latestIncoming(chatId, Math.min(unread, 50))
      .map((m) => ({ remoteJid: chatId, id: m.id, participant: m.author, fromMe: false }));
    await sock.readMessages(keys).catch(() => undefined);
  }

  /** Unlinks this computer from the WhatsApp account and removes local data. */
  async logout(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    const sock = this.sock;
    this.sock = null;
    if (sock) await sock.logout().catch(() => undefined);
    await this.resetAccount();
    await this.start();
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.opts.emit({ type: 'connection', state });
  }

  private rememberSent(id: string, message: proto.IMessage): void {
    this.sentCache.set(id, message);
    if (this.sentCache.size > SENT_CACHE_LIMIT) {
      const oldest = this.sentCache.keys().next().value;
      if (oldest) this.sentCache.delete(oldest);
    }
  }

  private async resetAccount(): Promise<void> {
    await rm(this.opts.authDir, { recursive: true, force: true });
    this.opts.store.clearAll();
    this.sentCache.clear();
    this.opts.emit({ type: 'chats-changed' });
    this.opts.emit({ type: 'scheduled-changed' });
  }

  private scheduleReconnect(delayMs: number): void {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => void this.connect(), delayMs);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const { state: auth, saveCreds } = await useMultiFileAuthState(this.opts.authDir);
    const linked = Boolean(auth.creds.me);
    this.setState({ status: 'connecting', linked });

    const version = await currentWaWebVersion();
    if (this.stopped) return;

    const sock = makeWASocket({
      auth,
      version,
      logger,
      // Shown in the phone's "Linked devices" list. WhatsApp currently rejects the native
      // desktop identities ("Mac OS"/"Windows" + "Desktop") with error 428, so use a browser one.
      browser: ['WA Premium Plus', 'Chrome', '1.0.0'],
      // Stay "offline" so the phone keeps showing notifications.
      markOnlineOnConnect: false,
      getMessage: async (key) => (key.id ? this.sentCache.get(key.id) : undefined),
    });
    this.sock = sock;

    // Ignore events from a socket that has since been replaced.
    const current = () => this.sock === sock && !this.stopped;

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
      if (current()) void this.onConnectionUpdate(sock, update);
    });
    sock.ev.on('messaging-history.set', ({ chats, contacts, messages, lidPnMappings }) => {
      if (!current()) return;
      this.opts.store.transaction(() => {
        for (const { lid, pn } of lidPnMappings ?? []) {
          this.opts.store.saveLidMapping(jidNormalizedUser(lid), jidNormalizedUser(pn));
        }
        this.saveContacts(contacts);
        this.saveChats(chats);
        for (const raw of messages) {
          const message = toChatMessage(raw, this.resolveJid);
          if (message && message.chatId !== 'status@broadcast') this.opts.store.upsertMessage(message);
        }
      });
      this.opts.emit({ type: 'chats-changed' });
    });
    sock.ev.on('chats.upsert', (chats) => current() && this.saveChats(chats, true));
    sock.ev.on('chats.update', (chats) => current() && this.saveChats(chats, true));
    sock.ev.on('chats.delete', (ids) => {
      if (!current()) return;
      for (const id of ids) this.opts.store.deleteChat(this.resolveJid(id));
      this.opts.emit({ type: 'chats-changed' });
    });
    sock.ev.on('contacts.upsert', (contacts) => current() && this.saveContacts(contacts, true));
    sock.ev.on('contacts.update', (contacts) => current() && this.saveContacts(contacts, true));
    sock.ev.on('groups.update', (groups) => {
      if (!current()) return;
      for (const g of groups) if (g.id && g.subject) this.opts.store.upsertChat({ id: g.id, name: g.subject });
      this.opts.emit({ type: 'chats-changed' });
    });
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (current()) this.handleMessages(messages, type);
    });
    sock.ev.on('messages.update', (updates) => {
      if (!current()) return;
      for (const { key, update } of updates) {
        const ack = toAck(update.status);
        if (!ack || !key.remoteJid || !key.id) continue;
        const chatId = this.resolveJid(key.remoteJid, key.remoteJidAlt);
        this.opts.store.updateAck(chatId, key.id, ack);
        this.opts.emit({ type: 'ack', chatId, messageId: key.id, ack });
      }
    });
  }

  private async onConnectionUpdate(sock: WASocket, update: Partial<BaileysConnectionState>): Promise<void> {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      if (this.sock === sock) this.setState({ status: 'qr', linked: false, qr: dataUrl });
    }

    if (connection === 'open') {
      this.retries = 0;
      const me = sock.user;
      this.setState({
        status: 'open',
        linked: true,
        me: me ? { id: jidNormalizedUser(me.id), name: me.name ?? undefined } : undefined,
      });
      void this.syncGroups(sock);
    }

    if (connection === 'close') {
      this.sock = null;
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
        ?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        // The device was removed from the phone: start over with a fresh QR code.
        await this.resetAccount();
        this.scheduleReconnect(0);
        return;
      }
      this.setState({ status: 'connecting', linked: this.state.linked });
      const delay =
        code === DisconnectReason.restartRequired ? 0 : Math.min(30_000, 2_000 * 2 ** this.retries++);
      this.scheduleReconnect(delay);
    }
  }

  private async syncGroups(sock: WASocket): Promise<void> {
    try {
      const groups = await sock.groupFetchAllParticipating();
      for (const g of Object.values(groups)) this.opts.store.upsertChat({ id: g.id, name: g.subject });
      this.opts.emit({ type: 'chats-changed' });
    } catch {
      // Group names will fill in from later events.
    }
  }

  /**
   * WhatsApp increasingly addresses people by privacy IDs (LIDs). Store chats under the
   * phone-number ID when we know it, so one person doesn't show up as two chats.
   */
  private readonly resolveJid = (jid: string, alt?: string | null): string => {
    const normalized = jidNormalizedUser(jid) || jid;
    if (!isLidUser(normalized)) return normalized;
    const altPn = alt ? jidNormalizedUser(alt) : undefined;
    if (altPn && isPnUser(altPn)) {
      this.opts.store.saveLidMapping(normalized, altPn);
      return altPn;
    }
    return this.opts.store.pnForLid(normalized) ?? normalized;
  };

  private handleMessages(messages: WAMessage[], type: string): void {
    const { store, emit, onIncoming } = this.opts;
    let changed = false;
    for (const raw of messages) {
      const message = toChatMessage(raw, this.resolveJid);
      if (!message || message.chatId === 'status@broadcast') continue;
      store.upsertMessage(message);
      if (type === 'notify' && !message.fromMe) {
        store.incrementUnread(message.chatId);
        onIncoming?.(message, store.chatName(message.chatId));
      }
      emit({ type: 'message', message });
      changed = true;
    }
    if (changed) emit({ type: 'chats-changed' });
  }

  private saveChats(chats: Partial<Chat>[], notify = false): void {
    for (const c of chats) {
      if (!c.id) continue;
      if (c.lidJid && c.pnJid) {
        this.opts.store.saveLidMapping(jidNormalizedUser(c.lidJid), jidNormalizedUser(c.pnJid));
      }
      const id = this.resolveJid(c.id, c.pnJid);
      if (id === 'status@broadcast') continue;
      const unread = typeof c.unreadCount === 'number' ? (c.unreadCount < 0 ? 1 : c.unreadCount) : undefined;
      this.opts.store.upsertChat({
        id,
        name: c.name,
        unreadCount: unread,
        lastActivity: c.conversationTimestamp ? toNumber(c.conversationTimestamp) : undefined,
      });
    }
    if (notify) this.opts.emit({ type: 'chats-changed' });
  }

  private saveContacts(contacts: Partial<Contact>[], notify = false): void {
    for (const c of contacts) {
      if (!c.id) continue;
      const lid = c.lid ?? (isLidUser(c.id) ? c.id : undefined);
      const pn = c.phoneNumber ?? (isPnUser(c.id) ? c.id : undefined);
      if (lid && pn) this.opts.store.saveLidMapping(jidNormalizedUser(lid), jidNormalizedUser(pn));
      this.opts.store.upsertContact({
        id: this.resolveJid(c.id, pn),
        name: c.name,
        notify: c.notify ?? c.verifiedName,
      });
    }
    if (notify) this.opts.emit({ type: 'chats-changed' });
  }
}
