import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMessage } from '../src/main/messages.ts';

const keep = (jid: string) => jid;

describe('parseMessage', () => {
  it('reads the group sender from history-sync messages (top-level participant)', () => {
    const parsed = parseMessage(
      {
        key: { remoteJid: '120363000000000001@g.us', fromMe: false, id: 'A1' },
        participant: '15550001111@s.whatsapp.net',
        messageTimestamp: 1700000000,
        message: { conversation: 'hello' },
      },
      keep,
    );
    assert.equal(parsed?.type, 'message');
    assert.equal(parsed?.type === 'message' && parsed.message.author, '15550001111@s.whatsapp.net');
    assert.equal(parsed?.type === 'message' && parsed.senderId, '15550001111@s.whatsapp.net');
  });

  it('prefers the sender in the key for live messages', () => {
    const parsed = parseMessage(
      {
        key: { remoteJid: '120363000000000001@g.us', fromMe: false, id: 'A2', participant: '15550002222@s.whatsapp.net' },
        message: { conversation: 'hi' },
        messageTimestamp: 1700000000,
      },
      keep,
    );
    assert.equal(parsed?.type === 'message' && parsed.message.author, '15550002222@s.whatsapp.net');
  });

  it('treats channel media without a media key as downloadable', () => {
    const image = { url: 'https://mmg.whatsapp.net/x', directPath: '/x', mimetype: 'image/jpeg' };
    const channel = parseMessage({ key: { remoteJid: '1203630000@newsletter', id: 'C1' }, message: { imageMessage: image } }, keep);
    const chat = parseMessage({ key: { remoteJid: '15550001111@s.whatsapp.net', id: 'C2' }, message: { imageMessage: image } }, keep);
    assert.equal(channel?.type === 'message' && channel.message.media?.downloadable, true);
    assert.equal(chat?.type === 'message' && chat.message.media?.downloadable, false);
  });

  it('turns edits and deletions into actions on the original message', () => {
    const edit = parseMessage(
      {
        key: { remoteJid: '15550001111@s.whatsapp.net', id: 'E1' },
        message: { protocolMessage: { type: 14, key: { id: 'ORIG' }, editedMessage: { conversation: 'fixed' } } },
      },
      keep,
    );
    assert.deepEqual(edit, { type: 'edit', chatId: '15550001111@s.whatsapp.net', targetId: 'ORIG', body: 'fixed' });
    const del = parseMessage(
      { key: { remoteJid: '15550001111@s.whatsapp.net', id: 'D1' }, message: { protocolMessage: { type: 0, key: { id: 'ORIG' } } } },
      keep,
    );
    assert.deepEqual(del, { type: 'delete', chatId: '15550001111@s.whatsapp.net', targetId: 'ORIG' });
  });
});
