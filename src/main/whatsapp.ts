// Manages the WhatsApp connection (via Baileys, the library behind WAHA's NOWEB engine)
// and keeps the local store in sync with it.

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import makeWASocket, {
  BufferJSON,
  decryptPollVote,
  DisconnectReason,
  downloadMediaMessage,
  generateWAMessageFromContent,
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
  type MiscMessageGenerationOptions,
  type WACallEvent,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
} from 'baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import type {
  AppEvent,
  ChannelInfo,
  ChatAction,
  ChatMessage,
  ConnectionState,
  GroupAction,
  GroupInfo,
  RichContent,
} from '../shared/types';
import { PermanentError } from './errors';
import { describeFile, mediaFileName, writeTempFile } from './media';
import { buildVcard, encryptPollVote, optionsFromHashes, parseMessage, pollOptionHash, reviveMessage, toAck } from './messages';
import { webmOpusToOgg } from './opus-ogg';
import { fallbackName, ME, STATUS_CHAT, type Attachment, type DueMessage, type Store } from './store';

/** A call, as reported live by WhatsApp. */
export interface IncomingCall {
  id: string;
  /** Who is calling (for group calls, the group). */
  chatId: string;
  /** The caller's ID as WhatsApp sent it (needed to reject the call). */
  from: string;
  isVideo: boolean;
  isGroup: boolean;
}

/** Events for the app's own features (automation, webhooks, reminders). */
export interface WhatsAppEvents {
  /** A message was stored. `live` is false for history sync. */
  message: [message: ChatMessage, info: { live: boolean; notify: boolean }];
  /** Someone is calling. */
  call: [call: IncomingCall];
  /** People joined or left a group. */
  'group-participants': [update: { groupId: string; participants: string[]; action: string }];
}

export interface WhatsAppOptions {
  authDir: string;
  /** Where downloaded and sent media files are kept. */
  mediaDir: string;
  /** Where profile pictures are kept. */
  avatarsDir: string;
  /** Turns a stored profile picture file name into a URL the window can load. */
  avatarUrl: (fileName: string) => string;
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
/** WhatsApp lets you forward a message to at most 5 chats at once. */
const MAX_FORWARD = 5;
const MAX_PINNED = 3;
const AVATAR_FRESH_MS = 3 * 24 * 60 * 60 * 1000;
const NO_AVATAR_FRESH_MS = 24 * 60 * 60 * 1000;
const AVATAR_CONCURRENCY = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

export class WhatsApp extends EventEmitter<WhatsAppEvents> {
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
  private readonly avatarQueue: string[] = [];
  private readonly avatarQueued = new Set<string>();
  private avatarsActive = 0;
  private readonly opts: WhatsAppOptions;

  constructor(opts: WhatsAppOptions) {
    super();
    this.opts = opts;
  }

  get connection(): ConnectionState {
    return this.state;
  }

  get isOpen(): boolean {
    return this.state.status === 'open';
  }

  /** Sends an event to the window on behalf of this account. */
  emitLocal(event: AppEvent): void {
    this.opts.emit(event);
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

  private async send(
    chatId: string,
    content: AnyMessageContent,
    localCopy?: string,
    options?: MiscMessageGenerationOptions,
  ): Promise<string | undefined> {
    const sent = await this.requireSocket().sendMessage(chatId, content, options);
    if (!sent) return undefined;
    if (sent.key.id && sent.message) this.rememberSent(sent.key.id, sent.message);
    this.handleMessages([sent], 'append');
    if (localCopy && sent.key.id) {
      // Keep a copy of what we sent so it shows without downloading it again.
      const parsed = parseMessage(sent, this.resolveJid);
      if (parsed?.type === 'message') {
        const { message } = parsed;
        const name = mediaFileName(message.chatId, message.id, message.media?.mimetype, message.media?.fileName);
        await mkdir(this.opts.mediaDir, { recursive: true });
        await copyFile(localCopy, join(this.opts.mediaDir, name));
        this.opts.store.setLocalFile(message.chatId, message.id, name);
        this.emitStored(this.opts.store.getMessage(message.chatId, message.id));
      }
    }
    return sent.key.id ?? undefined;
  }

  /** A stored message as a WhatsApp message, for quoting or forwarding it. */
  private waMessageFor(chatId: string, messageId: string): WAMessage {
    const stored = this.opts.store.getMessage(chatId, messageId);
    if (!stored) throw new Error("This message isn't available on this computer.");
    if (stored.raw) return reviveMessage(stored.raw);
    return {
      key: { remoteJid: chatId, id: stored.id, fromMe: stored.fromMe, participant: stored.author },
      message: { conversation: stored.body },
      messageTimestamp: stored.timestamp,
    };
  }

  private keyFor(chatId: string, messageId: string): WAMessageKey {
    const stored = this.opts.store.getMessage(chatId, messageId);
    if (!stored) throw new Error("This message isn't available on this computer.");
    if (stored.raw) return reviveMessage(stored.raw).key;
    return { remoteJid: chatId, id: stored.id, fromMe: stored.fromMe, participant: stored.author };
  }

  private quoteOptions(chatId: string, quotedId?: string): MiscMessageGenerationOptions | undefined {
    return quotedId ? { quoted: this.waMessageFor(chatId, quotedId) } : undefined;
  }

  /** Sends text; `mentions` are the WhatsApp IDs of people @-mentioned in it. */
  async sendText(chatId: string, text: string, quotedId?: string, mentions?: string[]): Promise<string | undefined> {
    return this.send(chatId, mentions?.length ? { text, mentions } : { text }, undefined, this.quoteOptions(chatId, quotedId));
  }

  /** Sends a poll, a location or contact cards. */
  async sendRich(chatId: string, content: RichContent, quotedId?: string): Promise<void> {
    let message: AnyMessageContent;
    switch (content.type) {
      case 'poll':
        message = {
          poll: { name: content.question, values: content.options, selectableCount: content.multiple ? 0 : 1 },
        };
        break;
      case 'location':
        message = {
          location: {
            degreesLatitude: content.lat,
            degreesLongitude: content.lng,
            name: content.name || undefined,
            address: content.address || undefined,
          },
        };
        break;
      case 'contacts':
        message = {
          contacts: {
            displayName: content.contacts.length === 1 ? content.contacts[0]!.name : `${content.contacts.length} contacts`,
            contacts: content.contacts.map((c) => ({ displayName: c.name, vcard: buildVcard(c) })),
          },
        };
        break;
    }
    await this.send(chatId, message, undefined, this.quoteOptions(chatId, quotedId));
  }

  /** Reacts to a message; an empty emoji removes our reaction. */
  async react(chatId: string, messageId: string, emoji: string): Promise<void> {
    const key = this.keyFor(chatId, messageId);
    await this.requireSocket().sendMessage(chatId, { react: { text: emoji, key } });
    this.opts.store.setReaction(chatId, messageId, ME, emoji, Date.now());
    this.emitStored(this.opts.store.getMessage(chatId, messageId));
  }

  async forward(chatId: string, messageId: string, targets: string[]): Promise<void> {
    if (targets.length === 0) throw new Error('Choose a chat to forward to.');
    if (targets.length > MAX_FORWARD) throw new Error(`You can forward to up to ${MAX_FORWARD} chats at once.`);
    const stored = this.opts.store.getMessage(chatId, messageId);
    if (!stored) throw new Error("This message isn't available on this computer.");
    const localFile = this.opts.store.getLocalFile(chatId, messageId);
    for (const [i, target] of targets.entries()) {
      if (i > 0) await sleep(700);
      if (stored.media && !stored.raw && localFile) {
        // We can't forward without the media keys, but we have the file: send it again.
        await this.sendFile(target, join(this.opts.mediaDir, localFile), stored.body, stored.media.fileName, stored.media.mimetype);
      } else {
        await this.send(target, { forward: this.waMessageFor(chatId, messageId) });
      }
    }
  }

  /** Edits one of our own text messages (WhatsApp allows this for 15 minutes). */
  async editMessage(chatId: string, messageId: string, text: string): Promise<void> {
    const stored = this.opts.store.getMessage(chatId, messageId);
    if (!stored?.fromMe) throw new Error('You can only edit your own messages.');
    await this.requireSocket().sendMessage(chatId, { text, edit: this.keyFor(chatId, messageId) });
    this.emitStored(this.opts.store.editMessage(chatId, messageId, text));
  }

  async deleteMessage(chatId: string, messageId: string, forEveryone: boolean): Promise<void> {
    const sock = this.requireSocket();
    const key = this.keyFor(chatId, messageId);
    const stored = this.opts.store.getMessage(chatId, messageId);
    if (forEveryone) {
      await sock.sendMessage(chatId, { delete: key });
      this.emitStored(this.opts.store.markDeleted(chatId, messageId));
      return;
    }
    await sock.chatModify(
      { deleteForMe: { deleteMedia: true, key, timestamp: stored?.timestamp ?? Math.floor(Date.now() / 1000) } },
      chatId,
    );
    const file = this.opts.store.removeMessage(chatId, messageId);
    if (file) await rm(join(this.opts.mediaDir, file), { force: true });
    this.opts.emit({ type: 'chats-changed' });
  }

  /** IDs the poll's creator and we (the voter) use for encrypting votes in this poll. */
  private pollIds(sock: WASocket, pollKey: WAMessageKey): { creator: string; me: string } {
    const lidMode = (pollKey.participant ?? pollKey.remoteJid ?? '').endsWith('@lid');
    const mePn = jidNormalizedUser(sock.user?.id);
    const meLid = sock.user?.lid ? jidNormalizedUser(sock.user.lid) : mePn;
    const me = lidMode ? meLid : mePn;
    const creator = pollKey.fromMe ? me : jidNormalizedUser(pollKey.participant || pollKey.remoteJid || '');
    return { creator, me };
  }

  async votePoll(chatId: string, messageId: string, options: string[]): Promise<void> {
    const sock = this.requireSocket();
    const stored = this.opts.store.getMessage(chatId, messageId);
    const poll = stored?.extra?.poll;
    if (!stored?.raw || !poll) throw new Error("This poll can't be answered from this computer. Use your phone.");
    if (poll.selectableCount === 1 && options.length > 1) throw new Error('Pick one option.');
    const raw = reviveMessage(stored.raw);
    const secret = raw.message?.messageContextInfo?.messageSecret;
    if (!secret?.length) throw new Error("This poll can't be answered from this computer. Use your phone.");
    const { creator, me } = this.pollIds(sock, raw.key);
    const vote = encryptPollVote(
      options.map((o) => Buffer.from(pollOptionHash(o), 'hex')),
      { pollEncKey: secret, pollCreatorJid: creator, pollMsgId: messageId, voterJid: me },
    );
    const msg = generateWAMessageFromContent(
      chatId,
      { pollUpdateMessage: { pollCreationMessageKey: raw.key, vote, senderTimestampMs: Date.now() } },
      { userJid: sock.user!.id },
    );
    await sock.relayMessage(chatId, msg.message!, {
      messageId: msg.key.id!,
      additionalNodes: [{ tag: 'meta', attrs: { polltype: 'vote' } }],
    });
    this.opts.store.setPollVote(chatId, messageId, ME, options, Date.now());
    this.emitStored(this.opts.store.getMessage(chatId, messageId));
  }

  /** Decrypts and records a poll vote. Tries both ID styles, since WhatsApp uses either. */
  private applyPollVote(parsed: Extract<ReturnType<typeof parseMessage>, { type: 'pollVote' }>): void {
    const { store } = this.opts;
    const stored = store.getMessage(parsed.chatId, parsed.targetId);
    const poll = stored?.extra?.poll;
    if (!stored?.raw || !poll) return;
    const raw = reviveMessage(stored.raw);
    const secret = raw.message?.messageContextInfo?.messageSecret;
    const sock = this.sock;
    if (!secret?.length || !sock || !parsed.vote.encPayload || !parsed.vote.encIv) return;
    const meIds = [jidNormalizedUser(sock.user?.id), sock.user?.lid ? jidNormalizedUser(sock.user.lid) : undefined].filter(
      (id): id is string => Boolean(id),
    );
    const idsFor = (key: WAMessageKey) =>
      key.fromMe
        ? meIds
        : [key.participant, (key as { participantAlt?: string }).participantAlt, key.remoteJid, (key as { remoteJidAlt?: string }).remoteJidAlt]
            .filter((id): id is string => Boolean(id) && !id!.endsWith('@g.us'))
            .map((id) => jidNormalizedUser(id));
    for (const creator of idsFor(raw.key)) {
      for (const voter of idsFor(parsed.voteKey)) {
        try {
          const vote = decryptPollVote(
            { encPayload: parsed.vote.encPayload, encIv: parsed.vote.encIv },
            { pollEncKey: secret, pollCreatorJid: creator, pollMsgId: parsed.targetId, voterJid: voter },
          );
          const picked = optionsFromHashes(poll.options, vote.selectedOptions ?? []);
          const who = parsed.voteKey.fromMe ? ME : this.resolveJid(voter);
          store.setPollVote(parsed.chatId, parsed.targetId, who, picked, parsed.timestamp);
          this.emitStored(store.getMessage(parsed.chatId, parsed.targetId));
          return;
        } catch {
          // wrong ID combination; try the next
        }
      }
    }
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
      if (!item.groupAction) throw new PermanentError('This scheduled group change has no setting to apply.');
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
  private async postStatus(content: AnyMessageContent, isMedia: boolean, backgroundColor = '#047857'): Promise<void> {
    const sock = this.requireSocket();
    const me = this.state.me?.id;
    const audience = [...new Set([...this.opts.store.statusAudience(), ...(me ? [me] : [])])];
    if (audience.length === 0) throw new Error('No saved contacts to share the status with.');
    const sent = await sock.sendMessage(STATUS_CHAT, content, {
      statusJidList: audience,
      broadcast: true,
      ...(isMedia ? {} : { backgroundColor, font: 1 }),
    });
    if (sent) this.applyMessage(sent, true);
  }

  /** Posts a status update now: text (with a background colour), or a photo or video with a caption. */
  async postStatusNow(text: string, file?: { path: string; name?: string; mimetype?: string }, backgroundColor?: string): Promise<void> {
    if (file) {
      const info = await describeFile(file.path, file.name, file.mimetype);
      if (info.kind !== 'image' && info.kind !== 'video') throw new Error('A status can include a photo or a video.');
      await this.postStatus(fileContent(file.path, info, text), true);
      return;
    }
    if (!text.trim()) throw new Error('Write something for your status.');
    await this.postStatus({ text }, false, backgroundColor);
  }

  /** Tells the author we've seen their status, like the phone does when you view it. */
  async markStatusViewed(messageId: string, author: string): Promise<void> {
    const sock = this.sock;
    if (!sock || !this.isOpen) return;
    await sock.readMessages([{ remoteJid: STATUS_CHAT, id: messageId, participant: author, fromMe: false }]).catch(() => undefined);
  }

  // --- Channels ---

  /** Follows a channel from its invite link (https://whatsapp.com/channel/...). */
  async followChannel(link: string): Promise<string> {
    const sock = this.requireSocket();
    const code = /channel\/([\w-]+)/.exec(link)?.[1] ?? (/^[\w-]{10,}$/.test(link.trim()) ? link.trim() : undefined);
    if (!code) throw new Error('Paste a channel link, like https://whatsapp.com/channel/…');
    const meta = await sock.newsletterMetadata('invite', code);
    if (!meta) throw new Error("Couldn't find that channel.");
    await sock.newsletterFollow(meta.id);
    this.opts.store.upsertChat({ id: meta.id, name: meta.thread_metadata?.name ?? meta.name, lastActivity: Math.floor(Date.now() / 1000) });
    this.opts.emit({ type: 'chats-changed' });
    return meta.id;
  }

  async unfollowChannel(id: string): Promise<void> {
    await this.requireSocket().newsletterUnfollow(id);
    this.opts.store.deleteChat(id);
    this.opts.emit({ type: 'chats-changed' });
  }

  async getChannelInfo(id: string): Promise<ChannelInfo> {
    const meta = await this.requireSocket().newsletterMetadata('jid', id);
    if (!meta) throw new Error("Couldn't load this channel.");
    const name = meta.thread_metadata?.name ?? meta.name;
    if (name) this.opts.store.upsertChat({ id, name });
    return {
      id,
      name: name || 'Channel',
      description: meta.thread_metadata?.description ?? meta.description ?? undefined,
      subscribers: meta.subscribers ?? undefined,
      verified: meta.verification === 'VERIFIED',
      link: meta.invite ? `https://whatsapp.com/channel/${meta.invite}` : undefined,
      muted: meta.mute_state === 'ON',
      createdAt: meta.creation_time ?? meta.thread_metadata?.creation_time ?? undefined,
    };
  }

  async muteChannel(id: string, muted: boolean): Promise<void> {
    const sock = this.requireSocket();
    if (muted) await sock.newsletterMute(id);
    else await sock.newsletterUnmute(id);
    this.opts.store.upsertChat({ id, mutedUntil: muted ? -1 : 0 });
    this.opts.emit({ type: 'chats-changed' });
  }

  // --- Group admin ---

  /** Adds, removes, promotes or demotes members. Returns a problem per person, if any. */
  async updateMembers(
    groupId: string,
    ids: string[],
    action: 'add' | 'remove' | 'promote' | 'demote',
  ): Promise<Array<{ id: string; problem: string }>> {
    const sock = this.requireSocket();
    if (ids.length === 0) return [];
    const results = await sock.groupParticipantsUpdate(groupId, ids, action);
    const problems: Array<{ id: string; problem: string }> = [];
    for (const r of results) {
      const status = String(r.status);
      if (status === '200') continue;
      const id = this.resolveJid(r.jid ?? '');
      const problem =
        status === '403'
          ? "Their privacy settings don't allow being added. Send them the invite link instead."
          : status === '408'
            ? 'They left recently and can only rejoin with the invite link.'
            : status === '409'
              ? 'Already in the group.'
              : status === '401'
                ? 'They blocked you.'
                : `WhatsApp refused (${status}).`;
      problems.push({ id, problem });
    }
    return problems;
  }

  async createGroup(subject: string, members: string[]): Promise<string> {
    const name = subject.trim();
    if (!name) throw new Error('Give the group a name.');
    if (name.length > 100) throw new Error('Group names can be up to 100 characters.');
    const meta = await this.requireSocket().groupCreate(name, members);
    this.opts.store.upsertChat({ id: meta.id, name: meta.subject, lastActivity: Math.floor(Date.now() / 1000) });
    this.opts.emit({ type: 'chats-changed' });
    return meta.id;
  }

  async leaveGroup(groupId: string): Promise<void> {
    await this.requireSocket().groupLeave(groupId);
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

  /** Archives, pins, mutes, marks unread or deletes a chat, on the phone too. */
  async chatAction(chatId: string, action: ChatAction): Promise<void> {
    const sock = this.requireSocket();
    const { store, emit } = this.opts;
    const last = store.newestMessage(chatId);
    const lastMessages = last
      ? [
          {
            key: { remoteJid: chatId, id: last.id, fromMe: last.fromMe, participant: last.author },
            messageTimestamp: last.timestamp,
          },
        ]
      : [];
    switch (action.type) {
      case 'archive':
        await sock.chatModify({ archive: action.value, lastMessages }, chatId);
        // WhatsApp unpins chats when they're archived.
        store.upsertChat({ id: chatId, archived: action.value, ...(action.value ? { pinned: 0 } : {}) });
        break;
      case 'pin': {
        if (action.value && store.listChats().filter((c) => c.pinned).length >= MAX_PINNED) {
          throw new Error(`You can pin up to ${MAX_PINNED} chats.`);
        }
        await sock.chatModify({ pin: action.value }, chatId);
        store.upsertChat({ id: chatId, pinned: action.value ? Date.now() : 0 });
        break;
      }
      case 'mute':
        await sock.chatModify({ mute: action.until === 0 ? null : action.until }, chatId);
        store.upsertChat({ id: chatId, mutedUntil: action.until });
        break;
      case 'markUnread':
        await sock.chatModify({ markRead: false, lastMessages }, chatId);
        store.upsertChat({ id: chatId, unreadCount: Math.max(1, store.unreadCount(chatId)) });
        break;
      case 'delete':
        await sock.chatModify({ delete: true, lastMessages }, chatId);
        store.deleteChat(chatId);
        break;
    }
    emit({ type: 'chats-changed' });
  }

  /** Which of these phone numbers use WhatsApp. */
  async checkNumbers(phones: string[]): Promise<Array<{ phone: string; jid?: string }>> {
    const sock = this.requireSocket();
    const results: Array<{ phone: string; jid?: string }> = [];
    for (let i = 0; i < phones.length; i += 50) {
      const batch = phones.slice(i, i + 50);
      const found = (await sock.onWhatsApp(...batch)) ?? [];
      const byNumber = new Map(found.filter((f) => f.exists).map((f) => [f.jid.split('@')[0]!, f.jid]));
      for (const phone of batch) {
        const digits = phone.replace(/\D/g, '');
        results.push({ phone, jid: byNumber.get(digits) ? jidNormalizedUser(byNumber.get(digits)) : undefined });
      }
      if (i + 50 < phones.length) await sleep(1_000);
    }
    return results;
  }

  /**
   * Links by phone number instead of a QR code. WhatsApp shows a notification on that phone;
   * the user types the returned code there.
   */
  async requestPairingCode(phone: string): Promise<string> {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) throw new Error('Enter your full phone number with the country code.');
    const sock = this.sock;
    if (!sock || this.state.linked) throw new Error('Wait for the QR code to appear, then try again.');
    const code = await sock.requestPairingCode(digits);
    const pretty = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
    this.opts.emit({ type: 'pairing-code', code: pretty });
    return pretty;
  }

  /** Rejects an incoming call. */
  async rejectCall(callId: string, from: string): Promise<void> {
    await this.requireSocket().rejectCall(callId, from);
    const known = this.opts.store.getCall(callId);
    if (known) {
      this.opts.store.upsertCall({ id: callId, chatId: '', status: 'auto-rejected', startedAt: known.startedAt });
      this.opts.emit({ type: 'calls-changed' });
    }
  }

  // --- Profile pictures ---

  /**
   * The cached profile picture URL, or null if there's none. Fetches it in the background
   * when it's missing or old, and sends an 'avatar' event when it changes.
   */
  getAvatar(id: string): string | null {
    const cached = this.opts.store.getProfilePic(id);
    const maxAge = cached?.file ? AVATAR_FRESH_MS : NO_AVATAR_FRESH_MS;
    if (!cached || Date.now() - cached.fetchedAt > maxAge) this.queueAvatar(id);
    return cached?.file ? this.opts.avatarUrl(cached.file) : null;
  }

  private queueAvatar(id: string): void {
    if (this.avatarQueued.has(id) || !this.sock || !this.isOpen) return;
    if (!/@(s\.whatsapp\.net|g\.us|lid|newsletter)$/.test(id)) return;
    this.avatarQueued.add(id);
    this.avatarQueue.push(id);
    this.pumpAvatars();
  }

  private pumpAvatars(): void {
    while (this.avatarsActive < AVATAR_CONCURRENCY && this.avatarQueue.length > 0) {
      const id = this.avatarQueue.shift()!;
      this.avatarsActive++;
      void this.fetchAvatar(id).finally(() => {
        this.avatarsActive--;
        this.avatarQueued.delete(id);
        setTimeout(() => this.pumpAvatars(), 120);
      });
    }
  }

  private async fetchAvatar(id: string): Promise<void> {
    const sock = this.sock;
    const { store, avatarsDir, emit } = this.opts;
    if (!sock || !this.isOpen) return;
    let url: string | undefined;
    try {
      url = id.endsWith('@newsletter')
        ? await this.channelPictureUrl(sock, id)
        : await sock.profilePictureUrl(id, 'preview', 10_000);
    } catch (err) {
      // 401/403/404: no picture, or hidden by their privacy settings. Anything else: try later.
      const status = httpStatusOf(err);
      if (status !== 401 && status !== 403 && status !== 404) return;
    }
    const previous = store.getProfilePic(id)?.file ?? null;
    let file: string | null = null;
    if (url) {
      const res = await fetch(url).catch(() => null);
      if (!res?.ok) return;
      file = `${createHash('sha1').update(id).digest('hex').slice(0, 20)}-${Date.now().toString(36)}.jpg`;
      await mkdir(avatarsDir, { recursive: true });
      await writeFile(join(avatarsDir, file), Buffer.from(await res.arrayBuffer()));
    }
    store.setProfilePic(id, file);
    if (previous && previous !== file) await rm(join(avatarsDir, previous), { force: true });
    if (previous !== file) emit({ type: 'avatar', id, url: file ? this.opts.avatarUrl(file) : null });
  }

  private async channelPictureUrl(sock: WASocket, id: string): Promise<string | undefined> {
    const meta = await sock.newsletterMetadata('jid', id);
    const path = meta?.picture?.directPath;
    return path ? getUrlFromDirectPath(path) : meta?.picture?.url;
  }

  // --- Calls ---

  private onCall(call: WACallEvent): void {
    const { store, emit } = this.opts;
    const isGroup = Boolean(call.isGroup && call.groupJid);
    const caller = this.resolveJid(call.from, call.callerPn);
    const chatId = isGroup ? call.groupJid! : caller;
    const fromMe = this.myIds(this.sock!).has(jidNormalizedUser(call.from)) || caller === this.state.me?.id;
    const startedAt = call.date ? new Date(call.date).getTime() : Date.now();
    const known = store.getCall(call.id);
    switch (call.status) {
      case 'offer':
        if (known) return;
        store.upsertCall({ id: call.id, chatId, fromMe, isVideo: call.isVideo, isGroup, status: fromMe ? 'outgoing' : 'missed', startedAt });
        if (!fromMe && !call.offline) {
          this.emit('call', { id: call.id, chatId, from: call.from, isVideo: Boolean(call.isVideo), isGroup });
        }
        break;
      case 'accept':
        store.upsertCall({ id: call.id, chatId, fromMe, isGroup, status: fromMe ? 'outgoing' : 'answered', startedAt: known?.startedAt ?? startedAt });
        break;
      case 'reject':
        store.upsertCall({ id: call.id, chatId, fromMe, isGroup, status: fromMe ? 'outgoing' : 'rejected', startedAt: known?.startedAt ?? startedAt });
        break;
      case 'timeout':
        store.upsertCall({ id: call.id, chatId, fromMe, isGroup, status: fromMe ? 'outgoing' : 'missed', startedAt: known?.startedAt ?? startedAt });
        break;
      case 'terminate':
        if (!known) return;
        store.upsertCall({ id: call.id, chatId, status: known.status, startedAt: known.startedAt, endedAt: Date.now() });
        break;
      default:
        return;
    }
    emit({ type: 'calls-changed' });
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
      throw new PermanentError("You're not an admin of this group, so its settings can't be changed.");
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
  async logout({ restart = true }: { restart?: boolean } = {}): Promise<void> {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    const sock = this.sock;
    this.sock = null;
    if (sock) await sock.logout().catch(() => undefined);
    await this.resetAccount();
    if (restart) await this.start();
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
    await rm(this.opts.avatarsDir, { recursive: true, force: true });
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
      // WhatsApp asks for a message again when a recipient couldn't decrypt it.
      getMessage: async (key) => {
        if (!key.id) return undefined;
        const cached = this.sentCache.get(key.id);
        if (cached) return cached;
        if (!key.remoteJid) return undefined;
        const stored = this.opts.store.getMessage(this.resolveJid(key.remoteJid), key.id);
        return stored?.raw ? (reviveMessage(stored.raw).message ?? undefined) : undefined;
      },
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
    sock.ev.on('contacts.update', (contacts) => {
      if (!current()) return;
      this.saveContacts(contacts, true);
      // A changed or removed profile picture: fetch it again when it's next shown.
      for (const c of contacts) {
        if (!c.id || c.imgUrl === undefined) continue;
        const id = this.resolveJid(c.id);
        store.expireProfilePic(id);
        this.queueAvatar(id);
      }
    });
    sock.ev.on('groups.update', (groups) => {
      if (!current()) return;
      for (const g of groups) if (g.id && g.subject) store.upsertChat({ id: g.id, name: g.subject });
      emit({ type: 'chats-changed' });
    });
    sock.ev.on('group-participants.update', ({ id, participants, action }) => {
      if (!current()) return;
      const ids = participants
        .map((p) => {
          const pn = (p as { phoneNumber?: string }).phoneNumber;
          return this.resolveJid(p.id, pn);
        })
        .filter(Boolean);
      this.emit('group-participants', { groupId: id, participants: ids, action });
    });
    sock.ev.on('call', (calls) => {
      if (!current()) return;
      for (const call of calls) this.onCall(call);
    });
    sock.ev.on('labels.edit', (label) => {
      if (!current()) return;
      if (label.deleted) {
        const id = store.labelIdForWa(label.id);
        if (id) store.deleteLabel(id);
      } else {
        store.saveLabel({ name: label.name, color: label.color, waId: label.id });
      }
      emit({ type: 'labels-changed' });
      emit({ type: 'chats-changed' });
    });
    sock.ev.on('labels.association', ({ association, type }) => {
      if (!current() || !('chatId' in association) || !association.chatId) return;
      const labelId = store.labelIdForWa(association.labelId);
      if (!labelId) return;
      store.setChatLabel(this.resolveJid(association.chatId), labelId, type === 'add');
      emit({ type: 'labels-changed' });
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
    if (parsed.type === 'reaction') {
      store.setReaction(parsed.chatId, parsed.targetId, parsed.sender, parsed.emoji, parsed.timestamp);
      if (emit) this.emitStored(store.getMessage(parsed.chatId, parsed.targetId));
      return undefined;
    }
    if (parsed.type === 'pollVote') {
      this.applyPollVote(parsed);
      return undefined;
    }
    const { message, senderId, pushName } = parsed;
    if (senderId && pushName) store.upsertContact({ id: senderId, notify: pushName });
    if (message.chatId === STATUS_CHAT) {
      // Status updates: keep them (they're shown for a day), but not our own text-only echoes.
      if (!message.author && !message.fromMe) return undefined;
      store.upsertMessage(message);
      if (emit) this.opts.emit({ type: 'statuses-changed' });
      return undefined;
    }
    store.upsertMessage(message);
    for (const r of parsed.reactions ?? []) store.setReaction(message.chatId, message.id, r.sender, r.emoji, r.timestamp);
    const poll = message.extra?.poll;
    for (const v of parsed.pollVotes ?? []) {
      if (poll) store.setPollVote(message.chatId, message.id, v.voter, optionsFromHashes(poll.options, v.hashes), v.timestamp);
    }
    if (message.kind === 'call' && message.extra?.call) {
      const call = message.extra.call;
      store.upsertCall({
        id: message.id,
        chatId: message.chatId,
        fromMe: message.fromMe,
        isVideo: call.video,
        isGroup: message.chatId.endsWith('@g.us'),
        status: message.fromMe ? 'outgoing' : call.outcome === 'CONNECTED' ? 'answered' : call.outcome === 'REJECTED' ? 'rejected' : 'missed',
        startedAt: message.timestamp * 1000,
        endedAt: call.seconds ? message.timestamp * 1000 + call.seconds * 1000 : undefined,
      });
    }
    const stored = store.getMessage(message.chatId, message.id);
    if (emit) this.emitStored(stored);
    return stored;
  }

  private handleMessages(messages: WAMessage[], type: string): void {
    const { store, emit, onIncoming } = this.opts;
    let changed = false;
    for (const raw of messages) {
      const isNew = Boolean(raw.key.remoteJid && raw.key.id) && !store.getMessage(this.resolveJid(raw.key.remoteJid!, raw.key.remoteJidAlt), raw.key.id!);
      const message = this.applyMessage(raw, true);
      changed = true;
      if (!message) continue;
      const notify = type === 'notify';
      if (notify && !message.fromMe) {
        store.incrementUnread(message.chatId);
        if (!store.isMuted(message.chatId)) onIncoming?.(message, store.chatName(message.chatId));
      }
      if (isNew) {
        const { raw: _raw, extra: _extra, ...visible } = message as ChatMessage & { raw?: string; extra?: unknown };
        this.emit('message', visible, { live: true, notify });
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
      const muteEnd = c.muteEndTime === undefined ? undefined : c.muteEndTime === null ? 0 : toNumber(c.muteEndTime);
      const pinned = c.pinned === undefined ? undefined : c.pinned === null ? 0 : toNumber(c.pinned) || Date.now();
      this.opts.store.upsertChat({
        id,
        name: c.name,
        unreadCount: unread,
        lastActivity: c.conversationTimestamp ? toNumber(c.conversationTimestamp) : undefined,
        archived: typeof c.archived === 'boolean' ? c.archived : c.archived === null ? false : undefined,
        pinned,
        // WhatsApp sends -1 for "always"; other values are when the mute ends (Unix ms or seconds).
        mutedUntil: muteEnd === undefined ? undefined : muteEnd > 0 && muteEnd < 1e12 ? muteEnd * 1000 : muteEnd,
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
