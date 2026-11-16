// Manages the WhatsApp connection (via Baileys, the library behind WAHA's NOWEB engine)
// and keeps the local store in sync with it.

import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import makeWASocket, {
  BufferJSON,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  getContentType,
  getUrlFromDirectPath,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  normalizeMessageContent,
  proto,
  toNumber,
  useMultiFileAuthState,
  type AnyMessageContent,
  type Chat,
  type ConnectionState as BaileysConnectionState,
  type Contact,
  type WAMessage,
  type WASocket,
} from 'baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import type { AppEvent, ChatMessage, ConnectionState, GroupAction, GroupInfo } from '../shared/types';
import { describeFile, mediaFileName, writeTempFile } from './media';
import { parseMessage, reviveMessage, toAck } from './messages';
import { webmOpusToOgg } from './opus-ogg';
import { fallbackName, type Attachment, type DueMessage, type Store } from './store';

export interface WhatsAppOptions {
  authDir: string;
  /** Where downloaded and sent media files are kept. */
  mediaDir: string;
  /** Scratch space for pasted files and voice notes. */
  tempDir: string;
  store: Store;
  emit: (event: AppEvent) => void;
  /** Called for each new incoming message, for desktop notifications. */
  onIncoming?: (message: ChatMessage, chatName: string) => void;
  /**
   * Development only: show stored data without connecting to WhatsApp (for example to test
   * the window against a copy of a real profile without disturbing that account's session).
   */
  offline?: boolean;
}

const logger = pino({ level: process.env.WAPP_LOG_LEVEL ?? 'silent' });
const SENT_CACHE_LIMIT = 500;
const LID_BATCH = 500;

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

const EXPIRED_STATUSES = new Set([403, 404, 410]);

function httpStatusOf(err: unknown): number | undefined {
  const e = err as { output?: { statusCode?: number }; status?: number; data?: { status?: number } } | undefined;
  return e?.output?.statusCode ?? e?.status ?? e?.data?.status;
}

function friendlyDownloadError(status: number | undefined): string {
  if (status && EXPIRED_STATUSES.has(status)) return 'This file has expired. Open it on your phone.';
  return "Couldn't download this file. Check your connection and try again.";
}

/** Channel media isn't encrypted: fetch it straight from WhatsApp's media servers. */
async function downloadChannelMedia(message: WAMessage): Promise<Buffer> {
  const content = normalizeMessageContent(message.message);
  const type = content ? getContentType(content) : undefined;
  const media = (type ? content?.[type] : undefined) as { url?: string | null; directPath?: string | null } | undefined;
  const url = media?.directPath ? getUrlFromDirectPath(media.directPath) : media?.url;
  if (!url) throw new Error('This media has no download link.');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/** Content for sending a file, chosen by what kind of file it is. */
function fileContent(path: string, info: Attachment | Awaited<ReturnType<typeof describeFile>>, caption?: string): AnyMessageContent {
  const text = caption?.trim() || undefined;
  switch (info.kind) {
    case 'image':
      return { image: { url: path }, mimetype: info.mimetype, caption: text };
    case 'video':
      return { video: { url: path }, mimetype: info.mimetype, caption: text };
    case 'audio':
      return { audio: { url: path }, mimetype: info.mimetype };
    default:
      return { document: { url: path }, mimetype: info.mimetype, fileName: info.name, caption: text };
  }
}

export class WhatsApp {
  private sock: WASocket | null = null;
  private state: ConnectionState = { status: 'connecting', linked: false };
  private reconnectTimer: NodeJS.Timeout | undefined;
  private lidTimer: NodeJS.Timeout | undefined;
  private retries = 0;
  private stopped = true;
  /** Recently sent messages, so Baileys can re-send them if a recipient asks for a retry. */
  private readonly sentCache = new Map<string, proto.IMessage>();
  private readonly downloads = new Map<string, Promise<string>>();
  /** Chats we already asked the phone to re-send this session. */
  private readonly historyRequested = new Set<string>();
  private readonly opts: WhatsAppOptions;

  constructor(opts: WhatsAppOptions) {
    this.opts = opts;
  }

  get connection(): ConnectionState {
    return this.state;
  }

  get isOpen(): boolean {
    return this.state.status === 'open';
  }

  async start(): Promise<void> {
    if (this.opts.offline) {
      this.setState({ status: 'connecting', linked: true });
      return;
    }
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.lidTimer);
    const sock = this.sock;
    this.sock = null;
    sock?.end(undefined);
  }

  private requireSocket(): WASocket {
    if (!this.sock || !this.isOpen) throw new Error('WhatsApp is not connected.');
    return this.sock;
  }

  // --- Sending ---

  private async send(chatId: string, content: AnyMessageContent, localCopy?: string): Promise<void> {
    const sent = await this.requireSocket().sendMessage(chatId, content);
    if (!sent) return;
    if (sent.key.id && sent.message) this.rememberSent(sent.key.id, sent.message);
    if (localCopy && sent.key.id) {
      // Keep a copy of what we sent so it shows without downloading it again.
      const parsed = parseMessage(sent, this.resolveJid);
      if (parsed?.type === 'message') {
        const { message } = parsed;
        const name = mediaFileName(message.chatId, message.id, message.media?.mimetype, message.media?.fileName);
        await mkdir(this.opts.mediaDir, { recursive: true });
        await copyFile(localCopy, join(this.opts.mediaDir, name));
        this.opts.store.upsertMessage(message);
        this.opts.store.setLocalFile(message.chatId, message.id, name);
      }
    }
    this.handleMessages([sent], 'append');
  }

  async sendText(chatId: string, text: string): Promise<void> {
    await this.send(chatId, { text });
  }

  async sendFile(chatId: string, path: string, caption?: string, name?: string, mimetype?: string): Promise<void> {
    const info = await describeFile(path, name, mimetype);
    await this.send(chatId, fileContent(path, info, caption), path);
  }

  async sendPastedFile(chatId: string, data: Uint8Array, name: string, mimetype: string, caption?: string): Promise<void> {
    const path = await writeTempFile(this.opts.tempDir, name, data);
    try {
      await this.sendFile(chatId, path, caption, name, mimetype);
    } finally {
      await rm(path, { force: true });
    }
  }

  async sendVoiceNote(chatId: string, webm: Uint8Array, seconds: number, waveform: number[]): Promise<void> {
    const { ogg, seconds: measured } = webmOpusToOgg(webm);
    const path = await writeTempFile(this.opts.tempDir, 'voice.ogg', ogg);
    // Baileys reads `waveform` from the content (it draws the voice-note bars) but its
    // types don't declare it.
    const content = {
      audio: { url: path },
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
      seconds: Math.max(1, Math.round(measured || seconds)),
      waveform: Uint8Array.from(waveform.slice(0, 64).map((v) => Math.max(0, Math.min(100, Math.round(v))))),
    } as AnyMessageContent;
    try {
      await this.send(chatId, content, path);
    } finally {
      await rm(path, { force: true });
    }
  }

  /** Carries out a due scheduled item: a message, a status post or a group settings change. */
  async sendScheduled(item: Pick<DueMessage, 'target' | 'chatId' | 'body' | 'attachment' | 'groupAction'>): Promise<void> {
    const { target, body, attachment } = item;
    if (target === 'group') {
      if (!item.groupAction) throw new Error('This scheduled group change has no setting to apply.');
      await this.applyGroupAction(item.chatId, item.groupAction);
      return;
    }
    const content: AnyMessageContent = attachment
      ? fileContent(attachment.path, attachment, body)
      : { text: body };
    if (target === 'status') {
      await this.postStatus(content, Boolean(attachment));
      return;
    }
    await this.send(item.chatId, content, attachment?.path);
  }

  /** Posts to the user's status, visible to their saved contacts (WhatsApp's "My contacts"). */
  private async postStatus(content: AnyMessageContent, isMedia: boolean): Promise<void> {
    const sock = this.requireSocket();
    const me = this.state.me?.id;
    const audience = [...new Set([...this.opts.store.statusAudience(), ...(me ? [me] : [])])];
    if (audience.length === 0) throw new Error('No saved contacts to share the status with.');
    await sock.sendMessage('status@broadcast', content, {
      statusJidList: audience,
      broadcast: true,
      ...(isMedia ? {} : { backgroundColor: '#047857', font: 1 }),
    });
  }

  // --- Media ---

  /** Downloads a message's media into the media folder and returns the stored file name. */
  downloadMedia(chatId: string, messageId: string): Promise<string> {
    const key = `${chatId}/${messageId}`;
    let pending = this.downloads.get(key);
    if (!pending) {
      pending = this.doDownload(chatId, messageId).finally(() => this.downloads.delete(key));
      this.downloads.set(key, pending);
    }
    return pending;
  }

  private async doDownload(chatId: string, messageId: string): Promise<string> {
    const { store, mediaDir } = this.opts;
    const existing = store.getLocalFile(chatId, messageId);
    if (existing) return existing;
    const message = store.getMessage(chatId, messageId);
    if (!message?.raw) throw new Error('This media is no longer available here. Open it on your phone.');
    let raw = reviveMessage(message.raw);
    const isChannel = chatId.endsWith('@newsletter');
    const fetchMedia = (msg: WAMessage) =>
      isChannel
        ? downloadChannelMedia(msg)
        : downloadMediaMessage(msg, 'buffer', {}, {
            logger,
            reuploadRequest: (m: WAMessage) => this.requireSocket().updateMediaMessage(m),
          });
    let buffer: Buffer;
    try {
      buffer = await fetchMedia(raw);
    } catch (err) {
      // WhatsApp's media links expire (403/404/410). Ask the phone to upload the file again,
      // then retry once. Baileys only does this itself for 404 and 410.
      const status = httpStatusOf(err);
      if (isChannel || !EXPIRED_STATUSES.has(status ?? 0) || !this.sock || !this.isOpen) {
        throw new Error(friendlyDownloadError(status));
      }
      try {
        raw = await this.sock.updateMediaMessage(raw);
        buffer = await fetchMedia(raw);
        store.updateRaw(chatId, messageId, JSON.stringify(raw, BufferJSON.replacer));
      } catch {
        throw new Error("This file has expired and your phone couldn't send it again. Open it on your phone.");
      }
    }
    const name = mediaFileName(chatId, messageId, message.media?.mimetype, message.media?.fileName);
    await mkdir(mediaDir, { recursive: true });
    await writeFile(join(mediaDir, name), buffer);
    store.setLocalFile(chatId, messageId, name);
    return name;
  }

  /**
   * Messages synced by older versions of the app lack the keys needed to download their
   * media. Ask the phone to re-send the chat's recent history (once per chat per session);
   * the copies it sends include the keys, and they merge into the stored messages.
   * Returns true if a request was sent.
   */
  async refreshChatMedia(chatId: string): Promise<boolean> {
    const sock = this.sock;
    if (!sock || !this.isOpen || this.historyRequested.has(chatId)) return false;
    if (chatId.endsWith('@newsletter')) return false; // channels don't support history requests
    const { store } = this.opts;
    if (store.countUnavailableMedia(chatId) === 0 && store.countMissingAuthors(chatId) === 0) return false;
    const newest = this.opts.store.newestMessage(chatId);
    if (!newest) return false;
    this.historyRequested.add(chatId);
    await sock.fetchMessageHistory(
      50,
      { remoteJid: chatId, id: newest.id, fromMe: newest.fromMe, participant: newest.author },
      newest.timestamp * 1000,
    );
    return true;
  }

  // --- Chats and groups ---

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

  /** IDs the linked account appears under (phone number and privacy ID). */
  private myIds(sock: WASocket): Set<string | undefined> {
    return new Set([this.state.me?.id, sock.user?.lid ? jidNormalizedUser(sock.user.lid) : undefined]);
  }

  private amAdminOf(sock: WASocket, meta: Awaited<ReturnType<WASocket['groupMetadata']>>): boolean {
    const mine = this.myIds(sock);
    return meta.participants.some((p) => {
      const ids = [p.id, p.lid, p.phoneNumber].filter(Boolean).map((id) => jidNormalizedUser(id!));
      return ids.some((id) => mine.has(id)) && (p.admin === 'admin' || p.admin === 'superadmin');
    });
  }

  /** Changes a group setting. WhatsApp only allows this for group admins. */
  async applyGroupAction(chatId: string, action: GroupAction): Promise<void> {
    const sock = this.requireSocket();
    const meta = await sock.groupMetadata(chatId);
    if (!this.amAdminOf(sock, meta)) {
      throw new Error("You're not an admin of this group, so its settings can't be changed.");
    }
    switch (action.type) {
      case 'announce':
        await sock.groupSettingUpdate(chatId, action.enabled ? 'announcement' : 'not_announcement');
        break;
      case 'restrict':
        await sock.groupSettingUpdate(chatId, action.enabled ? 'locked' : 'unlocked');
        break;
      case 'memberAdd':
        await sock.groupMemberAddMode(chatId, action.adminsOnly ? 'admin_add' : 'all_member_add');
        break;
      case 'joinApproval':
        await sock.groupJoinApprovalMode(chatId, action.enabled ? 'on' : 'off');
        break;
      case 'ephemeral':
        await sock.groupToggleEphemeral(chatId, action.seconds);
        break;
      case 'subject':
        await sock.groupUpdateSubject(chatId, action.text);
        this.opts.store.upsertChat({ id: chatId, name: action.text });
        this.opts.emit({ type: 'chats-changed' });
        break;
      case 'description':
        await sock.groupUpdateDescription(chatId, action.text || undefined);
        break;
      case 'revokeInvite':
        await sock.groupRevokeInvite(chatId);
        break;
    }
  }

  async getGroupInfo(chatId: string): Promise<GroupInfo> {
    const sock = this.requireSocket();
    const meta = await sock.groupMetadata(chatId);
    const { store } = this.opts;
    const myIds = this.myIds(sock);
    const participants = meta.participants.map((p) => {
      const pn = p.phoneNumber ? jidNormalizedUser(p.phoneNumber) : isPnUser(p.id) ? jidNormalizedUser(p.id) : undefined;
      const lid = p.lid ? jidNormalizedUser(p.lid) : isLidUser(p.id) ? jidNormalizedUser(p.id) : undefined;
      if (lid && pn) store.saveLidMapping(lid, pn);
      const id = pn ?? lid ?? p.id;
      const isMe = myIds.has(pn) || myIds.has(lid);
      return {
        id,
        name: isMe ? 'You' : (store.contactName(id) ?? p.notify ?? fallbackName(id)),
        phone: pn ? `+${pn.split('@')[0]}` : undefined,
        isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
        isSuperAdmin: p.admin === 'superadmin',
        isMe,
      };
    });
    participants.sort(
      (a, b) =>
        Number(b.isMe) - Number(a.isMe) ||
        Number(b.isAdmin) - Number(a.isAdmin) ||
        a.name.localeCompare(b.name),
    );
    if (meta.subject) store.upsertChat({ id: chatId, name: meta.subject });
    return {
      id: chatId,
      subject: meta.subject,
      description: meta.desc ?? undefined,
      createdAt: meta.creation,
      announce: Boolean(meta.announce),
      restrict: Boolean(meta.restrict),
      adminsAddMembers: meta.memberAddMode === false,
      joinApproval: Boolean(meta.joinApprovalMode),
      ephemeralSeconds: meta.ephemeralDuration ?? 0,
      amAdmin: participants.some((p) => p.isMe && p.isAdmin),
      participants,
    };
  }

  async getGroupInviteLink(chatId: string): Promise<string> {
    const code = await this.requireSocket().groupInviteCode(chatId);
    if (!code) throw new Error('Only group admins can get the invite link.');
    return `https://chat.whatsapp.com/${code}`;
  }

  // --- Account ---

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
    await rm(this.opts.mediaDir, { recursive: true, force: true });
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
    const { store, emit } = this.opts;

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
      if (current()) void this.onConnectionUpdate(sock, update);
    });
    sock.ev.on('messaging-history.set', ({ chats, contacts, messages, lidPnMappings, syncType }) => {
      if (!current()) return;
      // History we asked for (to recover media keys) updates messages that may be on screen.
      const onDemand = syncType === proto.HistorySync.HistorySyncType.ON_DEMAND;
      store.transaction(() => {
        for (const { lid, pn } of lidPnMappings ?? []) store.saveLidMapping(jidNormalizedUser(lid), jidNormalizedUser(pn));
        this.saveContacts(contacts);
        this.saveChats(chats);
        for (const raw of messages) this.applyMessage(raw, onDemand);
      });
      emit({ type: 'chats-changed' });
      this.scheduleLidResolution();
    });
    sock.ev.on('lid-mapping.update', ({ lid, pn }) => {
      if (!current()) return;
      store.mergeLid(jidNormalizedUser(lid), jidNormalizedUser(pn));
      emit({ type: 'chats-changed' });
    });
    sock.ev.on('chats.upsert', (chats) => current() && this.saveChats(chats, true));
    sock.ev.on('chats.update', (chats) => current() && this.saveChats(chats, true));
    sock.ev.on('chats.delete', (ids) => {
      if (!current()) return;
      for (const id of ids) store.deleteChat(this.resolveJid(id));
      emit({ type: 'chats-changed' });
    });
    sock.ev.on('contacts.upsert', (contacts) => current() && this.saveContacts(contacts, true));
    sock.ev.on('contacts.update', (contacts) => current() && this.saveContacts(contacts, true));
    sock.ev.on('groups.update', (groups) => {
      if (!current()) return;
      for (const g of groups) if (g.id && g.subject) store.upsertChat({ id: g.id, name: g.subject });
      emit({ type: 'chats-changed' });
    });
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (current()) this.handleMessages(messages, type);
    });
    sock.ev.on('messages.update', (updates) => {
      if (!current()) return;
      for (const { key, update } of updates) {
        if (!key.remoteJid || !key.id) continue;
        const chatId = this.resolveJid(key.remoteJid, key.remoteJidAlt);
        if (update.messageStubType === proto.WebMessageInfo.StubType.REVOKE || update.message === null) {
          this.emitStored(store.markDeleted(chatId, key.id));
          continue;
        }
        const ack = toAck(update.status);
        if (ack) {
          store.updateAck(chatId, key.id, ack);
          emit({ type: 'ack', chatId, messageId: key.id, ack });
        }
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
      this.scheduleLidResolution();
    }

    if (connection === 'close') {
      this.sock = null;
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        // The device was removed from the phone: start over with a fresh QR code.
        await this.resetAccount();
        this.scheduleReconnect(0);
        return;
      }
      this.setState({ status: 'connecting', linked: this.state.linked });
      const delay = code === DisconnectReason.restartRequired ? 0 : Math.min(30_000, 2_000 * 2 ** this.retries++);
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

  /** Batches LID lookups: history sync arrives in many chunks. */
  private scheduleLidResolution(): void {
    clearTimeout(this.lidTimer);
    this.lidTimer = setTimeout(() => void this.resolveLids(), 2_000);
  }

  /**
   * WhatsApp increasingly identifies people by privacy IDs (LIDs). Baileys learns which
   * phone number each LID belongs to; use that to merge LID chats into phone-number chats.
   */
  private async resolveLids(): Promise<void> {
    const sock = this.sock;
    if (!sock) return;
    const { store, emit } = this.opts;
    const lids = store.unresolvedLids();
    let merged = 0;
    for (let i = 0; i < lids.length; i += LID_BATCH) {
      const batch = lids.slice(i, i + LID_BATCH);
      const pairs = await sock.signalRepository.lidMapping.getPNsForLIDs(batch).catch(() => null);
      if (!pairs?.length) continue;
      store.transaction(() => {
        for (const { lid, pn } of pairs) {
          const pnJid = jidNormalizedUser(pn);
          if (!isPnUser(pnJid)) continue;
          store.mergeLid(jidNormalizedUser(lid), pnJid);
          merged++;
        }
      });
    }
    if (merged > 0) emit({ type: 'chats-changed' });
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

  /** Emits a stored message to the window (without the raw payload). */
  private emitStored(message: ChatMessage | undefined): void {
    if (!message) return;
    const { raw: _raw, ...visible } = message as ChatMessage & { raw?: string };
    this.opts.emit({ type: 'message', message: visible });
  }

  /**
   * Stores one incoming or outgoing message (or applies an edit/delete).
   * Returns the stored message for new messages.
   */
  private applyMessage(raw: WAMessage, emit: boolean): ChatMessage | undefined {
    const { store } = this.opts;
    const parsed = parseMessage(raw, this.resolveJid);
    if (!parsed) return undefined;
    if (parsed.type === 'edit') {
      const edited = store.editMessage(parsed.chatId, parsed.targetId, parsed.body);
      if (emit) this.emitStored(edited);
      return undefined;
    }
    if (parsed.type === 'delete') {
      const deleted = store.markDeleted(parsed.chatId, parsed.targetId);
      if (emit) this.emitStored(deleted);
      return undefined;
    }
    const { message, senderId, pushName } = parsed;
    if (message.chatId === 'status@broadcast') return undefined;
    if (senderId && pushName) store.upsertContact({ id: senderId, notify: pushName });
    store.upsertMessage(message);
    const stored = store.getMessage(message.chatId, message.id);
    if (emit) this.emitStored(stored);
    return stored;
  }

  private handleMessages(messages: WAMessage[], type: string): void {
    const { store, emit, onIncoming } = this.opts;
    let changed = false;
    for (const raw of messages) {
      const message = this.applyMessage(raw, true);
      changed = true;
      if (message && type === 'notify' && !message.fromMe) {
        store.incrementUnread(message.chatId);
        onIncoming?.(message, store.chatName(message.chatId));
      }
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
