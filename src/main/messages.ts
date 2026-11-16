// Converts Baileys message objects into the app's message shape.

import {
  BufferJSON,
  getContentType,
  normalizeMessageContent,
  proto,
  toNumber,
  type WAMessage,
} from 'baileys';
import type { MediaInfo, MessageAck, MessageKind } from '../shared/types';
import type { StoredMessage } from './store';

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

/** Media details as stored: `thumb` is plain base64 here (the store adds the data: prefix). */
function mediaInfo(media: MediaFields | null | undefined): MediaInfo {
  const m = media ?? {};
  return {
    mimetype: m.mimetype ?? undefined,
    fileName: m.fileName ?? undefined,
    size: m.fileLength ? toNumber(m.fileLength as number) : undefined,
    seconds: m.seconds ?? undefined,
    ptt: m.ptt ?? undefined,
    thumb: m.jpegThumbnail?.length ? Buffer.from(m.jpegThumbnail).toString('base64') : undefined,
    width: m.width ?? undefined,
    height: m.height ?? undefined,
    downloadable: Boolean(m.mediaKey?.length && (m.directPath || m.url)),
  };
}

interface Described {
  kind: MessageKind;
  body: string;
  media?: MediaInfo;
}

function describe(content: proto.IMessage): Described | null {
  // Wrappers that newer WhatsApp versions put around ordinary messages.
  const inner = content.associatedChildMessage?.message ?? content.lottieStickerMessage?.message;
  if (inner) return describe(normalizeMessageContent(inner) ?? inner);

  const type = getContentType(content);
  if (!type || IGNORED.has(type)) return null;
  switch (type) {
    case 'conversation':
      return { kind: 'text', body: content.conversation ?? '' };
    case 'extendedTextMessage':
      return { kind: 'text', body: content.extendedTextMessage?.text ?? '' };
    case 'imageMessage':
      return { kind: 'image', body: content.imageMessage?.caption ?? '', media: mediaInfo(content.imageMessage) };
    case 'videoMessage':
      return { kind: 'video', body: content.videoMessage?.caption ?? '', media: mediaInfo(content.videoMessage) };
    case 'ptvMessage':
      return { kind: 'video', body: '', media: mediaInfo(content.ptvMessage) };
    case 'audioMessage':
      return { kind: 'audio', body: '', media: mediaInfo(content.audioMessage) };
    case 'documentMessage':
      return {
        kind: 'document',
        body: content.documentMessage?.caption ?? '',
        media: mediaInfo(content.documentMessage),
      };
    case 'documentWithCaptionMessage': {
      const doc = content.documentWithCaptionMessage?.message?.documentMessage;
      return { kind: 'document', body: doc?.caption ?? '', media: mediaInfo(doc) };
    }
    case 'stickerMessage':
      return { kind: 'sticker', body: '', media: mediaInfo(content.stickerMessage) };
    case 'locationMessage':
      return { kind: 'location', body: content.locationMessage?.name || content.locationMessage?.address || '' };
    case 'liveLocationMessage':
      return { kind: 'location', body: content.liveLocationMessage?.caption ?? '' };
    case 'contactMessage':
      return { kind: 'contact', body: content.contactMessage?.displayName ?? '' };
    case 'contactsArrayMessage':
      return { kind: 'contact', body: content.contactsArrayMessage?.displayName ?? '' };
    case 'pollCreationMessage':
    case 'pollCreationMessageV2':
    case 'pollCreationMessageV3':
      return { kind: 'poll', body: content[type]?.name ?? '' };
    case 'callLogMesssage': {
      const call = content.callLogMesssage;
      return { kind: 'call', body: call?.isVideo ? 'Video call' : 'Voice call' };
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

export type ParsedMessage =
  | {
      type: 'message';
      message: StoredMessage;
      /** Who sent it (the chat for 1:1 chats, the participant in groups); unset for our own. */
      senderId?: string;
      /** The name the sender set for themselves in WhatsApp. */
      pushName?: string;
    }
  | { type: 'edit'; chatId: string; targetId: string; body: string }
  | { type: 'delete'; chatId: string; targetId: string };

/**
 * @param resolveJid maps WhatsApp IDs to the ID the app stores chats under
 *   (phone-number IDs where known, instead of privacy LIDs).
 */
export function parseMessage(
  m: WAMessage,
  resolveJid: (jid: string, alt?: string | null) => string,
): ParsedMessage | null {
  const { key } = m;
  if (!key.remoteJid || !key.id) return null;
  const content = normalizeMessageContent(m.message);
  if (!content) return null;
  const chatId = resolveJid(key.remoteJid, key.remoteJidAlt);

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

  const described = describe(content);
  if (!described) return null;

  const isGroup = chatId.endsWith('@g.us');
  const fromMe = Boolean(key.fromMe);
  const author = isGroup && key.participant ? resolveJid(key.participant, key.participantAlt) : undefined;
  const message: StoredMessage = {
    id: key.id,
    chatId,
    fromMe,
    author,
    authorName: isGroup && !fromMe ? (m.pushName ?? undefined) : undefined,
    kind: described.kind,
    body: described.body,
    timestamp: toNumber(m.messageTimestamp) || Math.floor(Date.now() / 1000),
    ack: toAck(m.status),
    media: described.media,
    // Keep the original payload for media: it holds the keys needed to download the file later.
    raw: described.media ? JSON.stringify(m, BufferJSON.replacer) : undefined,
  };
  return {
    type: 'message',
    message,
    senderId: fromMe ? undefined : isGroup ? author : chatId,
    pushName: fromMe ? undefined : (m.pushName ?? undefined),
  };
}

export function reviveMessage(raw: string): WAMessage {
  return JSON.parse(raw, BufferJSON.reviver) as WAMessage;
}
