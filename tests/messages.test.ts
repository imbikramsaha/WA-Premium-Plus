import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildVcard, encryptPollVote, optionsFromHashes, parseMessage, parseVcard, pollOptionHash } from '../src/main/messages.ts';
import { ME } from '../src/main/store.ts';
import { decryptPollVote } from 'baileys';

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

  it('reads replies and forwards', () => {
    const me = '15550009999@s.whatsapp.net';
    const parsed = parseMessage(
      {
        key: { remoteJid: '15550001111@s.whatsapp.net', id: 'R1' },
        messageTimestamp: 1700000000,
        message: {
          extendedTextMessage: {
            text: 'yes!',
            contextInfo: { stanzaId: 'Q1', participant: me, quotedMessage: { conversation: 'coming?' }, isForwarded: true },
          },
        },
      },
      keep,
      (jid) => jid === me,
    );
    assert.ok(parsed?.type === 'message');
    assert.deepEqual(parsed.message.quoted, { id: 'Q1', author: undefined, fromMe: true, kind: 'text', body: 'coming?' });
    assert.equal(parsed.message.forwarded, true);
  });

  it('turns reactions into actions on the original message', () => {
    const mine = parseMessage(
      {
        key: { remoteJid: '15550001111@s.whatsapp.net', id: 'X1', fromMe: true },
        messageTimestamp: 1700000000,
        message: { reactionMessage: { key: { id: 'T1' }, text: '❤️', senderTimestampMs: 1700000000123 } },
      },
      keep,
    );
    assert.deepEqual(mine, { type: 'reaction', chatId: '15550001111@s.whatsapp.net', targetId: 'T1', sender: ME, emoji: '❤️', timestamp: 1700000000123 });
    const theirs = parseMessage(
      {
        key: { remoteJid: '120363000000000001@g.us', id: 'X2', participant: '15550002222@s.whatsapp.net' },
        message: { reactionMessage: { key: { id: 'T1' }, text: '' } },
        messageTimestamp: 1700000001,
      },
      keep,
    );
    assert.equal(theirs?.type === 'reaction' && theirs.sender, '15550002222@s.whatsapp.net');
    assert.equal(theirs?.type === 'reaction' && theirs.emoji, '');
  });

  it('reads polls, locations and contact cards', () => {
    const poll = parseMessage(
      {
        key: { remoteJid: '15550001111@s.whatsapp.net', id: 'P1' },
        message: { pollCreationMessageV3: { name: 'Lunch?', options: [{ optionName: 'Pizza' }, { optionName: 'Salad' }], selectableOptionsCount: 1 } },
        messageTimestamp: 1700000000,
      },
      keep,
    );
    assert.ok(poll?.type === 'message');
    assert.equal(poll.message.kind, 'poll');
    assert.deepEqual(poll.message.extra?.poll, { options: ['Pizza', 'Salad'], selectableCount: 1 });
    assert.ok(poll.message.raw, 'keeps the payload with the secret needed to decrypt votes');

    const location = parseMessage(
      {
        key: { remoteJid: '15550001111@s.whatsapp.net', id: 'L1' },
        message: { locationMessage: { degreesLatitude: 22.57, degreesLongitude: 88.36, name: 'Victoria Memorial' } },
        messageTimestamp: 1700000000,
      },
      keep,
    );
    assert.ok(location?.type === 'message');
    assert.equal(location.message.body, 'Victoria Memorial');
    assert.equal(location.message.extra?.location?.lat, 22.57);

    const vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:Asha Rao\nitem1.TEL;waid=919876543210:+91 98765 43210\nTEL;type=HOME:+91 33 2222 1111\nEND:VCARD';
    const contact = parseMessage(
      {
        key: { remoteJid: '15550001111@s.whatsapp.net', id: 'V1' },
        message: { contactMessage: { displayName: 'Asha', vcard } },
        messageTimestamp: 1700000000,
      },
      keep,
    );
    assert.ok(contact?.type === 'message');
    assert.deepEqual(contact.message.extra?.contacts, [
      {
        name: 'Asha Rao',
        phones: [
          { number: '+91 98765 43210', jid: '919876543210@s.whatsapp.net' },
          { number: '+91 33 2222 1111', jid: undefined },
        ],
      },
    ]);
  });

  it('builds vCards that read back the same', () => {
    const card = { name: 'Rahul; Sen', phones: [{ number: '+91 98300 00000' }] };
    const parsed = parseVcard(buildVcard(card));
    assert.equal(parsed.name, 'Rahul; Sen');
    assert.deepEqual(parsed.phones, [{ number: '+919830000000', jid: '919830000000@s.whatsapp.net' }]);
  });

  it('hides view-once media', () => {
    const parsed = parseMessage(
      {
        key: { remoteJid: '15550001111@s.whatsapp.net', id: 'VO' },
        message: { viewOnceMessageV2: { message: { imageMessage: { viewOnce: true, mimetype: 'image/jpeg', mediaKey: new Uint8Array(32), directPath: '/x' } } } },
        messageTimestamp: 1700000000,
      },
      keep,
    );
    assert.ok(parsed?.type === 'message');
    assert.equal(parsed.message.kind, 'other');
    assert.equal(parsed.message.media, undefined);
  });

  it('encrypts poll votes so WhatsApp can decrypt them', () => {
    const ctx = {
      pollEncKey: new Uint8Array(32).fill(7),
      pollCreatorJid: '15550001111@s.whatsapp.net',
      pollMsgId: 'POLL1',
      voterJid: '15550009999@s.whatsapp.net',
    };
    const options = ['Pizza', 'Salad', 'Soup'];
    const vote = encryptPollVote([Buffer.from(pollOptionHash('Salad'), 'hex')], ctx);
    const decrypted = decryptPollVote(vote, ctx);
    assert.deepEqual(optionsFromHashes(options, decrypted.selectedOptions ?? []), ['Salad']);
  });
});
