// Converts Baileys message objects into the app's message shape.

import {
  aesEncryptGCM,
  BufferJSON,
  getContentType,
  hmacSign,
  normalizeMessageContent,
  proto,
  toNumber,
  type WAMessage,
} from 'baileys';
import { createHash, randomBytes } from 'node:crypto';
import type { ContactCard, MediaInfo, MessageAck, MessageKind, QuotedMessage } from '../shared/types';
import { ME, type MessageExtra, type StoredMessage } from './store.ts';

// proto.WebMessageInfo.Status values
const ACKS: Record<number, MessageAck> = {
  0: 'error',
  1: 'pending',
  2: 'sent',
  3: 'delivered',
  4: 'read',
  5: 'played',
};

export function toAck(status: number | null | undefined): MessageAck | undefined {
  return typeof status === 'number' ? ACKS[status] : undefined;
}

// Message types that carry no visible content of their own.
const IGNORED = new Set<string>([
  'senderKeyDistributionMessage',
  'messageContextInfo',
  'reactionMessage',
  'encReactionMessage',
  'pollUpdateMessage',
  'keepInChatMessage',
  'pinInChatMessage',
  'albumMessage',
  'requestPhoneNumberMessage',
  'encEventResponseMessage',
  'secretEncryptedMessage',
]);

interface MediaFields {
  mimetype?: string | null;
  fileLength?: number | { toNumber(): number } | null;
  seconds?: number | null;
  ptt?: boolean | null;
  jpegThumbnail?: Uint8Array | null;
  width?: number | null;
  height?: number | null;
  fileName?: string | null;
  mediaKey?: Uint8Array | null;
  directPath?: string | null;
  url?: string | null;
}

/**
 * Media details as stored: `thumb` is plain base64 here (the store adds the data: prefix).
 * Channel (newsletter) media is not end-to-end encrypted, so it has no media key.
 */
function mediaInfo(media: MediaFields | null | undefined, unencrypted = false): MediaInfo {
  const m = media ?? {};
  const located = Boolean(m.directPath || m.url);
  return {
    mimetype: m.mimetype ?? undefined,
    fileName: m.fileName ?? undefined,
    size: m.fileLength ? toNumber(m.fileLength as number) : undefined,
    seconds: m.seconds ?? undefined,
    ptt: m.ptt ?? undefined,
    thumb: m.jpegThumbnail?.length ? Buffer.from(m.jpegThumbnail).toString('base64') : undefined,
    width: m.width ?? undefined,
    height: m.height ?? undefined,
    downloadable: located && (unencrypted || Boolean(m.mediaKey?.length)),
  };
}

interface Described {
  kind: MessageKind;
  body: string;
  media?: MediaInfo;
  extra?: MessageExtra;
}

/** Reads a vCard (contact card) into a name and phone numbers. */
export function parseVcard(vcard: string | null | undefined, fallbackName = ''): ContactCard {
  // Long vCard lines are folded onto continuation lines that start with a space.
  const lines = (vcard ?? '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  let name = '';
  let structured = '';
  const phones: ContactCard['phones'] = [];
  for (const line of lines) {
    const match = /^(?:[\w-]+\.)?([A-Za-z]+)([^:]*):(.*)$/.exec(line);
    if (!match) continue;
    const [, field = '', params = '', value = ''] = match;
    const key = field.toUpperCase();
    if (key === 'FN') name = unescapeVcard(value).trim();
    else if (key === 'N' && !structured) structured = value.split(';').filter(Boolean).reverse().join(' ').trim();
    else if (key === 'TEL') {
      const waid = /waid=(\d+)/i.exec(params)?.[1];
      const number = value.trim();
      if (number || waid) phones.push({ number: number || `+${waid}`, jid: waid ? `${waid}@s.whatsapp.net` : undefined });
    }
  }
  return { name: name || structured || fallbackName || 'Contact', phones };
}

function unescapeVcard(text: string): string {
  return text.replace(/\\([\\;,nN])/g, (_m, c: string) => (c === 'n' || c === 'N' ? ' ' : c));
}

/** Builds a vCard for sending a contact card. */
export function buildVcard(card: ContactCard): string {
  const escape = (text: string) => text.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, ' ');
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escape(card.name)}`];
  for (const phone of card.phones) {
    const digits = phone.number.replace(/\D/g, '') || phone.jid?.split('@')[0] || '';
    if (!digits) continue;
    lines.push(`TEL;type=CELL;type=VOICE;waid=${digits}:+${digits}`);
  }
  lines.push('END:VCARD');
  return lines.join('\n');
}

/** WhatsApp identifies poll options by the SHA-256 of their text. */
export function pollOptionHash(name: string): string {
  return createHash('sha256').update(Buffer.from(name)).digest('hex');
}

/** Maps the hashed options of a poll vote back to the option names. */
export function optionsFromHashes(options: string[], hashes: Array<Uint8Array | null | undefined>): string[] {
  const wanted = new Set(hashes.filter(Boolean).map((h) => Buffer.from(h!).toString('hex')));
  return options.filter((o) => wanted.has(pollOptionHash(o)));
}

/** The reply/forward details that WhatsApp attaches to most message types. */
function contextInfoOf(content: proto.IMessage): proto.IContextInfo | undefined {
  const type = getContentType(content);
  const inner = type ? (content as Record<string, unknown>)[type] : undefined;
  if (inner && typeof inner === 'object' && 'contextInfo' in inner) {
    return (inner as { contextInfo?: proto.IContextInfo | null }).contextInfo ?? undefined;
  }
  return undefined;
}

function describe(content: proto.IMessage, unencrypted = false): Described | null {
  const info = (media: MediaFields | null | undefined) => mediaInfo(media, unencrypted);
  // Wrappers that newer WhatsApp versions put around ordinary messages.
  const inner = content.associatedChildMessage?.message ?? content.lottieStickerMessage?.message;
  if (inner) return describe(normalizeMessageContent(inner) ?? inner, unencrypted);

  const type = getContentType(content);
  if (!type || IGNORED.has(type)) return null;
  switch (type) {
    case 'conversation':
      return { kind: 'text', body: content.conversation ?? '' };
    case 'extendedTextMessage':
      return { kind: 'text', body: content.extendedTextMessage?.text ?? '' };
    case 'imageMessage':
      return { kind: 'image', body: content.imageMessage?.caption ?? '', media: info(content.imageMessage) };
    case 'videoMessage':
      return { kind: 'video', body: content.videoMessage?.caption ?? '', media: info(content.videoMessage) };
    case 'ptvMessage':
      return { kind: 'video', body: '', media: info(content.ptvMessage) };
    case 'audioMessage':
      return { kind: 'audio', body: '', media: info(content.audioMessage) };
    case 'documentMessage':
      return {
        kind: 'document',
        body: content.documentMessage?.caption ?? '',
        media: info(content.documentMessage),
      };
    case 'documentWithCaptionMessage': {
      const doc = content.documentWithCaptionMessage?.message?.documentMessage;
      return { kind: 'document', body: doc?.caption ?? '', media: info(doc) };
    }
    case 'stickerMessage':
      return { kind: 'sticker', body: '', media: info(content.stickerMessage) };
    case 'locationMessage':
    case 'liveLocationMessage': {
      const loc = type === 'locationMessage' ? content.locationMessage : content.liveLocationMessage;
      const live = type === 'liveLocationMessage';
      const name = content.locationMessage?.name ?? undefined;
      const address = content.locationMessage?.address ?? undefined;
      return {
        kind: 'location',
        body: (live ? content.liveLocationMessage?.caption : name || address) ?? '',
        extra: {
          location: {
            lat: loc?.degreesLatitude ?? 0,
            lng: loc?.degreesLongitude ?? 0,
            name,
            address,
            live: live || undefined,
            thumb: loc?.jpegThumbnail?.length ? Buffer.from(loc.jpegThumbnail).toString('base64') : undefined,
          },
        },
      };
    }
    case 'contactMessage': {
      const card = parseVcard(content.contactMessage?.vcard, content.contactMessage?.displayName ?? '');
      return { kind: 'contact', body: card.name, extra: { contacts: [card] } };
    }
    case 'contactsArrayMessage': {
      const list = content.contactsArrayMessage;
      const cards = (list?.contacts ?? []).map((c) => parseVcard(c.vcard, c.displayName ?? ''));
      return { kind: 'contact', body: list?.displayName || cards.map((c) => c.name).join(', '), extra: { contacts: cards } };
    }
    case 'pollCreationMessage':
    case 'pollCreationMessageV2':
    case 'pollCreationMessageV3':
    case 'pollCreationMessageV5': {
      const poll = content[type];
      return {
        kind: 'poll',
        body: poll?.name ?? '',
        extra: {
          poll: {
            options: (poll?.options ?? []).map((o) => o.optionName ?? '').filter(Boolean),
            selectableCount: poll?.selectableOptionsCount ?? 0,
          },
        },
      };
    }
    case 'callLogMesssage': {
      const call = content.callLogMesssage;
      const outcome = proto.Message.CallLogMessage.CallOutcome[call?.callOutcome ?? 0] ?? 'MISSED';
      return {
        kind: 'call',
        body: call?.isVideo ? 'Video call' : 'Voice call',
        extra: { call: { video: Boolean(call?.isVideo), outcome, seconds: toNumber(call?.durationSecs) || undefined } },
      };
    }
    case 'eventMessage':
      return { kind: 'other', body: `Event: ${content.eventMessage?.name ?? ''}`.trim() };
    case 'groupInviteMessage':
      return { kind: 'other', body: `Group invite: ${content.groupInviteMessage?.groupName ?? ''}`.trim() };
    // Business and bot messages: show their text.
    case 'templateMessage': {
      const t = content.templateMessage;
      const text = t?.hydratedTemplate?.hydratedContentText ?? t?.hydratedFourRowTemplate?.hydratedContentText;
      return { kind: 'text', body: text ?? '' };
    }
    case 'interactiveMessage':
      return { kind: 'text', body: content.interactiveMessage?.body?.text ?? '' };
    case 'buttonsMessage':
      return { kind: 'text', body: content.buttonsMessage?.contentText ?? '' };
    case 'listMessage':
      return { kind: 'text', body: content.listMessage?.description ?? content.listMessage?.title ?? '' };
    case 'buttonsResponseMessage':
      return { kind: 'text', body: content.buttonsResponseMessage?.selectedDisplayText ?? '' };
    case 'listResponseMessage':
      return { kind: 'text', body: content.listResponseMessage?.title ?? '' };
    case 'templateButtonReplyMessage':
      return { kind: 'text', body: content.templateButtonReplyMessage?.selectedDisplayText ?? '' };
    default:
      return { kind: 'other', body: '' };
  }
}

export interface ParsedReaction {
  /** A WhatsApp ID, or ME for our own reactions. */
  sender: string;
  emoji: string;
  /** Unix ms. */
  timestamp: number;
}

export type ParsedMessage =
  | {
      type: 'message';
      message: StoredMessage;
      /** Who sent it (the chat for 1:1 chats, the participant in groups); unset for our own. */
      senderId?: string;
      /** The name the sender set for themselves in WhatsApp. */
      pushName?: string;
      /** Reactions included with messages from history sync. */
      reactions?: ParsedReaction[];
      /** Poll votes included with messages from history sync (option hashes, already decrypted). */
      pollVotes?: Array<{ voter: string; hashes: Uint8Array[]; timestamp: number }>;
    }
  | { type: 'edit'; chatId: string; targetId: string; body: string }
  | { type: 'delete'; chatId: string; targetId: string }
  | ({ type: 'reaction'; chatId: string; targetId: string } & ParsedReaction)
  /** An encrypted poll vote; decrypting it needs the poll's secret, which the store has. */
  | {
      type: 'pollVote';
      chatId: string;
      targetId: string;
      /** The poll's key, as sent (needed to decrypt the vote). */
      pollKey: proto.IMessageKey;
      voteKey: proto.IMessageKey;
      vote: proto.Message.IPollEncValue;
      timestamp: number;
    };

/**
 * @param resolveJid maps WhatsApp IDs to the ID the app stores chats under
 *   (phone-number IDs where known, instead of privacy LIDs).
 */
export function parseMessage(
  m: WAMessage,
  resolveJid: (jid: string, alt?: string | null) => string,
  isMe: (jid: string) => boolean = () => false,
): ParsedMessage | null {
  const { key } = m;
  if (!key.remoteJid || !key.id) return null;
  const content = normalizeMessageContent(m.message);
  if (!content) return null;
  const chatId = resolveJid(key.remoteJid, key.remoteJidAlt);
  const isGroup = chatId.endsWith('@g.us');
  const fromMe = Boolean(key.fromMe);
  // Live messages carry the group sender in the key; history-sync copies carry it at the top level.
  const participant = key.participant || m.participant || undefined;
  const senderOf = (k: proto.IMessageKey | null | undefined): string | undefined => {
    if (!k) return undefined;
    if (k.fromMe) return ME;
    const who = k.participant || (isGroup ? undefined : k.remoteJid);
    return who ? resolveJid(who, (k as { participantAlt?: string }).participantAlt) : undefined;
  };

  if (content.reactionMessage) {
    const reaction = content.reactionMessage;
    const targetId = reaction.key?.id;
    const sender = fromMe ? ME : senderOf(key);
    if (!targetId || !sender) return null;
    return {
      type: 'reaction',
      chatId,
      targetId,
      sender,
      emoji: reaction.text ?? '',
      timestamp: toNumber(reaction.senderTimestampMs) || toNumber(m.messageTimestamp) * 1000,
    };
  }

  if (content.pollUpdateMessage) {
    const update = content.pollUpdateMessage;
    const pollKey = update.pollCreationMessageKey;
    if (!pollKey?.id || !update.vote) return null;
    return {
      type: 'pollVote',
      chatId,
      targetId: pollKey.id,
      pollKey,
      voteKey: { ...key, participant },
      vote: update.vote,
      timestamp: toNumber(update.senderTimestampMs) || toNumber(m.messageTimestamp) * 1000,
    };
  }

  const protocol = content.protocolMessage;
  if (protocol) {
    const targetId = protocol.key?.id;
    if (!targetId) return null;
    if (protocol.type === proto.Message.ProtocolMessage.Type.REVOKE) {
      return { type: 'delete', chatId, targetId };
    }
    if (protocol.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT && protocol.editedMessage) {
      const edited = describe(normalizeMessageContent(protocol.editedMessage) ?? protocol.editedMessage);
      return edited ? { type: 'edit', chatId, targetId, body: edited.body } : null;
    }
    return null;
  }

  const described = viewOnce(content) ?? describe(content, chatId.endsWith('@newsletter'));
  if (!described) return null;

  // In groups and status updates, the sender isn't the chat.
  const isStatus = chatId === 'status@broadcast';
  const author = (isGroup || isStatus) && participant ? resolveJid(participant, key.participantAlt) : undefined;
  const context = contextInfoOf(content);
  let quoted: QuotedMessage | undefined;
  if (context?.stanzaId && context.quotedMessage) {
    const q = describe(normalizeMessageContent(context.quotedMessage) ?? context.quotedMessage);
    const quotedAuthor = context.participant ? resolveJid(context.participant) : undefined;
    const quotedFromMe = quotedAuthor ? isMe(quotedAuthor) : false;
    quoted = {
      id: context.stanzaId,
      author: quotedFromMe ? undefined : quotedAuthor,
      fromMe: quotedFromMe || undefined,
      kind: q?.kind ?? 'other',
      body: q?.body ?? '',
    };
  }
  const message: StoredMessage = {
    id: key.id,
    chatId,
    fromMe,
    author,
    authorName: (isGroup || isStatus) && !fromMe ? (m.pushName ?? undefined) : undefined,
    kind: described.kind,
    body: described.body,
    timestamp: toNumber(m.messageTimestamp) || Math.floor(Date.now() / 1000),
    ack: toAck(m.status),
    media: described.media,
    quoted,
    forwarded: context?.isForwarded || undefined,
    extra: described.extra,
    // Keep the original payload for media (it holds the keys needed to download the file
    // later), polls (the secret that decrypts votes), locations and contact cards (to forward them).
    raw: described.media || described.extra ? JSON.stringify(m, BufferJSON.replacer) : undefined,
  };
  const reactions = (m.reactions ?? [])
    .map((r): ParsedReaction | null => {
      const sender = senderOf(r.key);
      return sender ? { sender, emoji: r.text ?? '', timestamp: toNumber(r.senderTimestampMs) } : null;
    })
    .filter((r): r is ParsedReaction => r !== null && r.emoji !== '');
  const pollVotes = (m.pollUpdates ?? [])
    .map((u) => {
      const voter = senderOf(u.pollUpdateMessageKey);
      const hashes = (u.vote?.selectedOptions ?? []).filter((h): h is Uint8Array => Boolean(h));
      return voter ? { voter, hashes, timestamp: toNumber(u.senderTimestampMs) } : null;
    })
    .filter((v) => v !== null);
  return {
    type: 'message',
    message,
    senderId: fromMe ? undefined : isGroup || isStatus ? author : chatId,
    pushName: fromMe ? undefined : (m.pushName ?? undefined),
    reactions: reactions.length ? reactions : undefined,
    pollVotes: pollVotes.length ? pollVotes : undefined,
  };
}

/**
 * View-once photos and videos are meant to be seen once on the phone: don't show or keep them.
 */
function viewOnce(content: proto.IMessage): Described | null {
  const media = content.imageMessage ?? content.videoMessage ?? content.audioMessage;
  if (!media?.viewOnce) return null;
  return { kind: 'other', body: 'View-once message. Open it on your phone.' };
}

export function reviveMessage(raw: string): WAMessage {
  return JSON.parse(raw, BufferJSON.reviver) as WAMessage;
}

/**
 * Encrypts a poll vote the way WhatsApp does (the inverse of Baileys' decryptPollVote).
 * The key is derived from the poll's secret and the poll and voter IDs.
 */
export function encryptPollVote(
  selectedOptions: Uint8Array[],
  ctx: { pollEncKey: Uint8Array; pollCreatorJid: string; pollMsgId: string; voterJid: string },
): { encPayload: Buffer; encIv: Buffer } {
  const sign = Buffer.concat([
    Buffer.from(ctx.pollMsgId),
    Buffer.from(ctx.pollCreatorJid),
    Buffer.from(ctx.voterJid),
    Buffer.from('Poll Vote'),
    new Uint8Array([1]),
  ]);
  const key0 = hmacSign(ctx.pollEncKey, new Uint8Array(32), 'sha256');
  const encKey = hmacSign(sign, key0, 'sha256');
  const encIv = randomBytes(12);
  const aad = Buffer.from(`${ctx.pollMsgId}\u0000${ctx.voterJid}`);
  const plain = proto.Message.PollVoteMessage.encode({ selectedOptions }).finish();
  return { encPayload: aesEncryptGCM(plain, encKey, encIv, aad), encIv };
}
