// Converts Baileys message objects into the app's ChatMessage shape.

import { getContentType, normalizeMessageContent, toNumber, type proto, type WAMessage } from 'baileys';
import type { ChatMessage, MessageAck, MessageKind } from '../shared/types';

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

// Message types that carry no visible content (key exchanges, revokes, reactions and so on).
const IGNORED = new Set<string>([
  'protocolMessage',
  'senderKeyDistributionMessage',
  'messageContextInfo',
  'reactionMessage',
  'pollUpdateMessage',
  'keepInChatMessage',
  'encReactionMessage',
  'pinInChatMessage',
]);

function describe(content: proto.IMessage): { kind: MessageKind; body: string } | null {
  const type = getContentType(content);
  if (!type || IGNORED.has(type)) return null;
  switch (type) {
    case 'conversation':
      return { kind: 'text', body: content.conversation ?? '' };
    case 'extendedTextMessage':
      return { kind: 'text', body: content.extendedTextMessage?.text ?? '' };
    case 'imageMessage':
      return { kind: 'image', body: content.imageMessage?.caption ?? '' };
    case 'videoMessage':
      return { kind: 'video', body: content.videoMessage?.caption ?? '' };
    case 'audioMessage':
      return { kind: 'audio', body: '' };
    case 'documentMessage':
      return {
        kind: 'document',
        body: content.documentMessage?.caption || content.documentMessage?.fileName || '',
      };
    case 'documentWithCaptionMessage': {
      const doc = content.documentWithCaptionMessage?.message?.documentMessage;
      return { kind: 'document', body: doc?.caption || doc?.fileName || '' };
    }
    case 'stickerMessage':
      return { kind: 'sticker', body: '' };
    case 'locationMessage':
      return {
        kind: 'location',
        body: content.locationMessage?.name || content.locationMessage?.address || '',
      };
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
    default:
      return { kind: 'other', body: '' };
  }
}

/**
 * @param resolveJid maps WhatsApp IDs to the ID the app stores chats under
 *   (phone-number IDs where known, instead of privacy LIDs).
 */
export function toChatMessage(m: WAMessage, resolveJid: (jid: string, alt?: string | null) => string): ChatMessage | null {
  const { key } = m;
  if (!key.remoteJid || !key.id) return null;
  const content = normalizeMessageContent(m.message);
  if (!content) return null;
  const described = describe(content);
  if (!described) return null;

  const chatId = resolveJid(key.remoteJid, key.remoteJidAlt);
  const isGroup = chatId.endsWith('@g.us');
  return {
    id: key.id,
    chatId,
    fromMe: Boolean(key.fromMe),
    author: isGroup && key.participant ? resolveJid(key.participant, key.participantAlt) : undefined,
    authorName: isGroup && !key.fromMe ? (m.pushName ?? undefined) : undefined,
    kind: described.kind,
    body: described.body,
    timestamp: toNumber(m.messageTimestamp) || Math.floor(Date.now() / 1000),
    ack: toAck(m.status),
  };
}
