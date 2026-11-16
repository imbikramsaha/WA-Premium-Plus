// Handlers for the window's requests (window.wapp.* in the renderer). Every request acts on
// the account currently shown in the window.

import { copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { dialog, ipcMain, shell, systemPreferences } from 'electron';
import { inverseGroupAction, normalizeGroupAction } from '../shared/group-actions';
import { firstOccurrence, normalizeRule } from '../shared/schedule';
import { isValidZone, localZone, parseWallTime, zoneCity, zoneForPhone } from '../shared/timezones';
import type { ChatAction, ContactCard, GroupAction, MemberAction, RepeatRule, RichContent, ScheduleTarget } from '../shared/types';
import type { Account } from './account';
import type { Accounts } from './accounts';
import { describeFile, keepAttachment, writeTempFile } from './media';
import type { Attachment, NewSchedule } from './store';

const MAX_TEXT_LENGTH = 65_536;
const MAX_RECIPIENTS = 256;

export function requireString(value: unknown, what: string, max = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${what} is required.`);
  if (value.length > max) throw new Error(`${what} is too long.`);
  return value;
}

export function optionalString(value: unknown, max = MAX_TEXT_LENGTH): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid text.');
  return value;
}

export function requireId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error('Invalid ID.');
  return value;
}

function requireIds(value: unknown, what: string, max = MAX_RECIPIENTS): string[] {
  const list = Array.isArray(value) ? value : [];
  const ids = [...new Set(list.map((id) => requireString(id, what, 200)))];
  if (ids.length > max) throw new Error(`Pick up to ${max}.`);
  return ids;
}

interface ParsedScheduleInput {
  target: ScheduleTarget;
  chatIds: string[];
  body: string;
  sendAt: number;
  rule: NewSchedule['rule'];
  attachmentPath?: string | null;
  groupAction?: GroupAction;
  revertAt?: number;
  wallTime?: string;
  /** An IANA zone, or 'recipient'. */
  timeZone?: string;
}

/**
 * When and how often one recipient gets the message. With a wall time and a zone, the time
 * is that wall-clock time in the zone ('recipient': the zone of the person's phone number).
 */
function timingFor(input: ParsedScheduleInput, chatId: string): { sendAt: number; rule: RepeatRule } {
  if (!input.wallTime || !input.timeZone) return { sendAt: input.sendAt, rule: input.rule };
  const { timeZone: _old, ...base } = input.rule;
  const zone = input.timeZone === 'recipient' ? zoneForPhone(chatId)?.zone : input.timeZone;
  const effective = zone ?? localZone();
  const sendAt = parseWallTime(input.wallTime, effective);
  if (Number.isNaN(sendAt)) throw new Error('Pick a date and time.');
  if (sendAt < Date.now() - 60_000) {
    throw new Error(`${input.wallTime.replace('T', ' ')} in ${zoneCity(effective)} has already passed. Pick a later time.`);
  }
  return { sendAt, rule: zone ? { ...base, timeZone: zone } : base };
}

function parseScheduleInput(value: unknown): ParsedScheduleInput {
  const input = (value ?? {}) as Record<string, unknown>;
  const target: ScheduleTarget = input.target === 'status' ? 'status' : input.target === 'group' ? 'group' : 'chat';
  const sendAt = input.sendAt;
  if (typeof sendAt !== 'number' || !Number.isFinite(sendAt)) throw new Error('Pick a date and time.');
  if (sendAt < Date.now() - 60_000) throw new Error('Pick a time in the future.');
  const rule = normalizeRule(input.rule);
  if (rule.endAt !== undefined && rule.endAt < sendAt) throw new Error('The end date is before the first send.');

  let chatIds: string[] = ['status@broadcast'];
  if (target !== 'status') {
    const ids = Array.isArray(input.chatIds) ? input.chatIds : [];
    chatIds = [...new Set(ids.map((id) => requireString(id, 'Chat')))];
    if (chatIds.length === 0) throw new Error(target === 'group' ? 'Choose at least one group.' : 'Choose at least one chat.');
    if (chatIds.length > MAX_RECIPIENTS) throw new Error(`You can pick up to ${MAX_RECIPIENTS} chats at once.`);
  }

  if (target === 'group') {
    if (chatIds.some((id) => !id.endsWith('@g.us'))) throw new Error('Group settings can only be scheduled for groups.');
    if (input.attachmentPath) throw new Error("A group settings change can't include a file.");
    const groupAction = normalizeGroupAction(input.groupAction);
    let revertAt: number | undefined;
    if (input.revertAt !== undefined && input.revertAt !== null) {
      if (!inverseGroupAction(groupAction)) throw new Error("This change can't be switched back automatically.");
      if (typeof input.revertAt !== 'number' || !Number.isFinite(input.revertAt) || input.revertAt <= sendAt) {
        throw new Error('The time to switch back must be after the change.');
      }
      revertAt = input.revertAt;
    }
    return { target, chatIds, body: '', sendAt, rule, groupAction, revertAt };
  }

  const attachmentPath = input.attachmentPath;
  if (attachmentPath !== undefined && attachmentPath !== null && typeof attachmentPath !== 'string') {
    throw new Error('Invalid attachment.');
  }
  const body = optionalString(input.body).trim();
  if (!body && !attachmentPath) throw new Error('Write a message or attach a file.');
  let wallTime: string | undefined;
  let timeZone: string | undefined;
  if (target === 'chat' && input.timeZone !== undefined && input.timeZone !== null) {
    if (typeof input.wallTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.wallTime)) {
      throw new Error('Pick a date and time.');
    }
    if (input.timeZone !== 'recipient' && !isValidZone(input.timeZone)) throw new Error('Unknown time zone.');
    wallTime = input.wallTime;
    timeZone = input.timeZone as string;
  }
  return { target, chatIds, body, sendAt, rule, attachmentPath, wallTime, timeZone };
}

/**
 * The "switch back" action runs a fixed time after the change, so its series must end that
 * much later too; otherwise the last switch-back would be skipped and the group left changed.
 */
function shiftEnd(rule: RepeatRule, offsetMs: number): RepeatRule {
  return rule.endAt === undefined ? rule : { ...rule, endAt: rule.endAt + offsetMs };
}

/** Statuses can only show a photo or a video. */
async function checkStatusAttachment(target: ScheduleTarget, path: string | undefined, kind?: string) {
  if (target !== 'status') return;
  const fileKind = kind ?? (path ? (await describeFile(path)).kind : undefined);
  if (fileKind && fileKind !== 'image' && fileKind !== 'video') {
    throw new Error('A status can include a photo or a video, but not other files.');
  }
}

function parseChatAction(value: unknown): ChatAction {
  const a = (value ?? {}) as Record<string, unknown>;
  switch (a.type) {
    case 'archive':
    case 'pin':
      return { type: a.type, value: Boolean(a.value) };
    case 'mute': {
      const until = Number(a.until);
      if (!Number.isFinite(until) || (until !== -1 && until < 0)) throw new Error('Invalid mute time.');
      return { type: 'mute', until };
    }
    case 'markUnread':
    case 'delete':
      return { type: a.type };
    default:
      throw new Error('Unknown chat action.');
  }
}

function parseRichContent(value: unknown): RichContent {
  const c = (value ?? {}) as Record<string, unknown>;
  switch (c.type) {
    case 'poll': {
      const question = requireString(c.question, 'Question', 255).trim();
      const options = (Array.isArray(c.options) ? c.options : [])
        .map((o) => optionalString(o, 100).trim())
        .filter(Boolean);
      if (new Set(options).size !== options.length) throw new Error('Each option must be different.');
      if (options.length < 2) throw new Error('Add at least two options.');
      if (options.length > 12) throw new Error('A poll can have up to 12 options.');
      return { type: 'poll', question, options, multiple: Boolean(c.multiple) };
    }
    case 'location': {
      const lat = Number(c.lat);
      const lng = Number(c.lng);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
        throw new Error('Enter a valid latitude and longitude.');
      }
      return { type: 'location', lat, lng, name: optionalString(c.name, 200), address: optionalString(c.address, 300) };
    }
    case 'contacts': {
      const list = Array.isArray(c.contacts) ? c.contacts : [];
      const contacts: ContactCard[] = list.slice(0, 20).map((raw) => {
        const card = (raw ?? {}) as Record<string, unknown>;
        const phones = (Array.isArray(card.phones) ? card.phones : [])
          .map((p) => {
            const phone = (p ?? {}) as Record<string, unknown>;
            return { number: optionalString(phone.number, 40), jid: typeof phone.jid === 'string' ? phone.jid : undefined };
          })
          .filter((p) => p.number || p.jid);
        return { name: requireString(card.name, 'Contact name', 200), phones };
      });
      if (contacts.length === 0) throw new Error('Pick a contact to share.');
      return { type: 'contacts', contacts };
    }
    default:
      throw new Error('Unknown message type.');
  }
}

export interface IpcContext {
  accounts: Accounts;
  onAccountsChanged: () => void;
  onAccountSwitched: () => void;
  openCallsWindow: (account: Account, chatId?: string) => Promise<void>;
}

export function registerIpc(ctx: IpcContext): void {
  const { accounts } = ctx;
  /** The account shown in the window. */
  const active = () => accounts.active;
  const scheduledChanged = (account: Account) => {
    ctx.onAccountsChanged();
    account.scheduler.poke();
  };
  const handle = (channel: string, fn: (account: Account, ...args: unknown[]) => unknown) => {
    ipcMain.handle(`wapp:${channel}`, (_e, ...args: unknown[]) => fn(active(), ...args));
  };

  const mediaPath = async (account: Account, chatId: unknown, messageId: unknown) => {
    const name = await account.whatsapp.downloadMedia(requireString(chatId, 'Chat'), requireString(messageId, 'Message'));
    return join(account.mediaDir, name);
  };

  /** A file from the window: a path from a file picker, or pasted bytes saved to a temp file. */
  const withFile = async <T>(account: Account, file: unknown, fn: (path: string, name?: string, mimetype?: string) => Promise<T>) => {
    const f = (file ?? {}) as Record<string, unknown>;
    if (typeof f.path === 'string') return fn(f.path);
    if (f.data instanceof Uint8Array && typeof f.name === 'string' && typeof f.mimetype === 'string') {
      const path = await writeTempFile(join(account.dir, 'tmp'), f.name, f.data);
      try {
        return await fn(path, f.name, f.mimetype);
      } finally {
        await rm(path, { force: true });
      }
    }
    throw new Error('Invalid file.');
  };

  // --- Connection and accounts ---

  handle('getConnection', (a) => a.whatsapp.connection);
  handle('logout', (a) => a.whatsapp.logout());
  handle('requestPairingCode', (a, phone) => a.whatsapp.requestPairingCode(requireString(phone, 'Phone number', 40)));
  handle('listAccounts', () => accounts.list());
  handle('switchAccount', (_a, id) => {
    accounts.switchTo(requireString(id, 'Account', 40));
    ctx.onAccountSwitched();
  });
  handle('addAccount', () => {
    accounts.add();
    ctx.onAccountSwitched();
  });
  handle('removeAccount', async (_a, id) => {
    await accounts.remove(requireString(id, 'Account', 40));
    ctx.onAccountSwitched();
  });

  // --- Chats and messages ---

  handle('listChats', (a) => a.store.listChats());
  handle('listContacts', (a) => a.store.listContacts());
  handle('startChat', async (a, phone) => {
    const digits = requireString(phone, 'Phone number', 40).replace(/\D/g, '');
    if (digits.length < 7) throw new Error('Enter the full number with the country code.');
    const [result] = await a.whatsapp.checkNumbers([digits]);
    if (!result?.jid) throw new Error(`+${digits} isn't on WhatsApp.`);
    if (!a.store.hasChat(result.jid)) a.store.upsertChat({ id: result.jid, lastActivity: Math.floor(Date.now() / 1000) });
    ctx.onAccountsChanged();
    return result.jid;
  });
  handle('checkNumbers', (a, phones) =>
    a.whatsapp.checkNumbers(requireIds(phones, 'Phone number', 5000).map((p) => p.replace(/\D/g, ''))),
  );
  handle('listMessages', (a, chatId, before) =>
    a.store.listMessages(requireString(chatId, 'Chat'), 100, typeof before === 'number' ? before : undefined),
  );
  handle('listMessagesAround', (a, chatId, messageId) =>
    a.store.messagesAround(requireString(chatId, 'Chat'), requireString(messageId, 'Message')),
  );
  handle('searchMessages', (a, query, chatId) =>
    a.store.searchMessages(optionalString(query, 500), typeof chatId === 'string' ? chatId : undefined),
  );
  handle('markRead', (a, chatId) => a.whatsapp.markRead(requireString(chatId, 'Chat')));
  handle('sendText', (a, chatId, text, quotedId) =>
    a.whatsapp.sendText(
      requireString(chatId, 'Chat'),
      requireString(text, 'Message').trim(),
      typeof quotedId === 'string' ? quotedId : undefined,
    ),
  );
  handle('sendRich', (a, chatId, content, quotedId) =>
    a.whatsapp.sendRich(
      requireString(chatId, 'Chat'),
      parseRichContent(content),
      typeof quotedId === 'string' ? quotedId : undefined,
    ),
  );
  handle('sendFile', (a, chatId, file, caption) => {
    const id = requireString(chatId, 'Chat');
    return withFile(a, file, (path, name, mimetype) => a.whatsapp.sendFile(id, path, optionalString(caption), name, mimetype));
  });
  handle('sendVoiceNote', (a, chatId, webm, seconds, waveform) => {
    if (!(webm instanceof Uint8Array)) throw new Error('Invalid recording.');
    const bars = Array.isArray(waveform) ? waveform.filter((v): v is number => typeof v === 'number') : [];
    return a.whatsapp.sendVoiceNote(requireString(chatId, 'Chat'), webm, typeof seconds === 'number' ? seconds : 0, bars);
  });
  handle('react', (a, chatId, messageId, emoji) =>
    a.whatsapp.react(requireString(chatId, 'Chat'), requireString(messageId, 'Message'), optionalString(emoji, 32)),
  );
  handle('forward', (a, chatId, messageId, targets) =>
    a.whatsapp.forward(requireString(chatId, 'Chat'), requireString(messageId, 'Message'), requireIds(targets, 'Chat', 5)),
  );
  handle('editMessage', (a, chatId, messageId, text) =>
    a.whatsapp.editMessage(requireString(chatId, 'Chat'), requireString(messageId, 'Message'), requireString(text, 'Message').trim()),
  );
  handle('deleteMessage', (a, chatId, messageId, forEveryone) =>
    a.whatsapp.deleteMessage(requireString(chatId, 'Chat'), requireString(messageId, 'Message'), Boolean(forEveryone)),
  );
  handle('votePoll', (a, chatId, messageId, options) =>
    a.whatsapp.votePoll(
      requireString(chatId, 'Chat'),
      requireString(messageId, 'Message'),
      (Array.isArray(options) ? options : []).map((o) => requireString(o, 'Option', 100)),
    ),
  );
  ipcMain.handle('wapp:requestMicrophone', async () => {
    if (process.platform !== 'darwin') return true;
    return systemPreferences.askForMediaAccess('microphone');
  });

  handle('chatAction', (a, chatId, action) => a.whatsapp.chatAction(requireString(chatId, 'Chat'), parseChatAction(action)));
  handle('listLabels', (a) => a.store.listLabels());
  handle('saveLabel', (a, value) => {
    const label = (value ?? {}) as Record<string, unknown>;
    const name = requireString(label.name, 'Label name', 60).trim();
    const color = Number(label.color);
    a.store.saveLabel({ id: typeof label.id === 'number' ? label.id : undefined, name, color: Number.isInteger(color) ? color : 0 });
    a.whatsapp.emitLocal({ type: 'labels-changed' });
  });
  handle('deleteLabel', (a, id) => {
    a.store.deleteLabel(requireId(id));
    a.whatsapp.emitLocal({ type: 'labels-changed' });
    a.whatsapp.emitLocal({ type: 'chats-changed' });
  });
  handle('setChatLabel', (a, chatId, labelId, on) => {
    a.store.setChatLabel(requireString(chatId, 'Chat'), requireId(labelId), Boolean(on));
    a.whatsapp.emitLocal({ type: 'labels-changed' });
    a.whatsapp.emitLocal({ type: 'chats-changed' });
  });
  handle('getAvatar', (a, id) => a.whatsapp.getAvatar(requireString(id, 'ID', 200)));
  handle('listCalls', (a) => a.store.listCalls());

  // --- Media ---

  handle('refreshChatMedia', (a, chatId) => a.whatsapp.refreshChatMedia(requireString(chatId, 'Chat')).catch(() => false));
  handle('downloadMedia', async (a, chatId, messageId) => {
    const name = await a.whatsapp.downloadMedia(requireString(chatId, 'Chat'), requireString(messageId, 'Message'));
    return a.store.mediaUrl(name);
  });
  handle('openMedia', async (a, chatId, messageId) => {
    const error = await shell.openPath(await mediaPath(a, chatId, messageId));
    if (error) throw new Error(error);
  });
  handle('saveMedia', async (a, chatId, messageId) => {
    const source = await mediaPath(a, chatId, messageId);
    const message = a.store.getMessage(String(chatId), String(messageId));
    const suggested = message?.media?.fileName ?? source.split(/[\\/]/).pop();
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: suggested });
    if (canceled || !filePath) return;
    await copyFile(source, filePath);
  });

  // --- Status and channels ---

  handle('listStatuses', (a) => a.store.listStatuses());
  handle('postStatus', (a, text, file, background) => {
    const caption = optionalString(text, 700);
    const color = typeof background === 'string' && /^#[0-9a-f]{6}$/i.test(background) ? background : undefined;
    if (!file) return a.whatsapp.postStatusNow(caption, undefined, color);
    return withFile(a, file, (path, name, mimetype) => a.whatsapp.postStatusNow(caption, { path, name, mimetype }));
  });
  handle('markStatusViewed', (a, messageId, author) =>
    a.whatsapp.markStatusViewed(requireString(messageId, 'Status'), requireString(author, 'Author', 200)),
  );
  handle('followChannel', (a, link) => a.whatsapp.followChannel(requireString(link, 'Channel link', 500)));
  handle('unfollowChannel', (a, id) => a.whatsapp.unfollowChannel(requireString(id, 'Channel')));
  handle('getChannelInfo', (a, id) => a.whatsapp.getChannelInfo(requireString(id, 'Channel')));
  handle('muteChannel', (a, id, muted) => a.whatsapp.muteChannel(requireString(id, 'Channel'), Boolean(muted)));

  // --- Groups ---

  handle('getGroupInfo', (a, chatId) => a.whatsapp.getGroupInfo(requireString(chatId, 'Chat')));
  handle('getGroupInviteLink', (a, chatId) => a.whatsapp.getGroupInviteLink(requireString(chatId, 'Chat')));
  handle('applyGroupAction', (a, chatId, action) =>
    a.whatsapp.applyGroupAction(requireString(chatId, 'Chat'), normalizeGroupAction(action)),
  );
  handle('updateMembers', (a, groupId, ids, action) => {
    const actions: MemberAction[] = ['add', 'remove', 'promote', 'demote'];
    if (!actions.includes(action as MemberAction)) throw new Error('Unknown member action.');
    return a.whatsapp.updateMembers(requireString(groupId, 'Group'), requireIds(ids, 'Member'), action as MemberAction);
  });
  handle('createGroup', (a, subject, members) =>
    a.whatsapp.createGroup(requireString(subject, 'Group name', 100), requireIds(members, 'Member')),
  );
  handle('leaveGroup', (a, groupId) => a.whatsapp.leaveGroup(requireString(groupId, 'Group')));

  // --- Scheduling ---

  handle('listScheduled', (a) => a.store.listScheduled());
  handle('createScheduled', async (a, value) => {
    const { store } = a;
    const input = parseScheduleInput(value);
    if (input.target === 'group' && input.groupAction) {
      const action = input.groupAction;
      const revert = input.revertAt !== undefined ? inverseGroupAction(action) : null;
      store.transaction(() => {
        for (const chatId of input.chatIds) {
          store.createScheduled({
            target: 'group',
            chatId,
            body: '',
            sendAt: firstOccurrence(input.sendAt, input.rule),
            anchorAt: input.sendAt,
            rule: input.rule,
            groupAction: action,
          });
          if (revert && input.revertAt !== undefined) {
            const rule = shiftEnd(input.rule, input.revertAt - input.sendAt);
            store.createScheduled({
              target: 'group',
              chatId,
              body: '',
              sendAt: firstOccurrence(input.revertAt, rule),
              anchorAt: input.revertAt,
              rule,
              groupAction: revert,
            });
          }
        }
      });
      a.whatsapp.emitLocal({ type: 'scheduled-changed' });
      scheduledChanged(a);
      return;
    }
    await checkStatusAttachment(input.target, input.attachmentPath ?? undefined);
    const attachment: Attachment | null = input.attachmentPath
      ? await keepAttachment(input.attachmentPath, a.attachmentsDir)
      : null;
    // Work out every recipient's time first, so a time that has passed somewhere creates nothing.
    const timings = input.chatIds.map((chatId) => ({ chatId, ...timingFor(input, chatId) }));
    store.transaction(() => {
      for (const { chatId, sendAt, rule } of timings) {
        store.createScheduled({ ...input, chatId, attachment, rule, sendAt: firstOccurrence(sendAt, rule), anchorAt: sendAt });
      }
    });
    a.whatsapp.emitLocal({ type: 'scheduled-changed' });
    scheduledChanged(a);
  });
  handle('updateScheduled', async (a, id, value) => {
    const { store } = a;
    const scheduleId = requireId(id);
    const input = parseScheduleInput(value);
    if (input.chatIds.length !== 1) throw new Error('A scheduled message goes to one chat. Create new ones for others.');
    const previous = store.getScheduled(scheduleId);
    if (typeof input.attachmentPath === 'string') await checkStatusAttachment(input.target, input.attachmentPath);
    else if (input.attachmentPath === undefined) await checkStatusAttachment(input.target, undefined, previous?.attachment?.kind);
    let attachment: Attachment | null | undefined;
    if (input.attachmentPath === null) attachment = null;
    else if (typeof input.attachmentPath === 'string' && input.attachmentPath !== previous?.attachment?.path) {
      attachment = await keepAttachment(input.attachmentPath, a.attachmentsDir);
    }
    const chatId = input.chatIds[0]!;
    const { sendAt, rule } = timingFor(input, chatId);
    store.updateScheduled(scheduleId, {
      ...input,
      chatId,
      attachment,
      rule,
      sendAt: firstOccurrence(sendAt, rule),
      anchorAt: sendAt,
    });
    const oldPath = previous?.attachment?.path;
    if (attachment !== undefined && oldPath && !store.isAttachmentUsed(oldPath)) await rm(oldPath, { force: true });
    a.whatsapp.emitLocal({ type: 'scheduled-changed' });
    scheduledChanged(a);
  });
  handle('cancelScheduled', (a, id) => {
    a.store.setScheduledStatus(requireId(id), 'cancelled');
    a.whatsapp.emitLocal({ type: 'scheduled-changed' });
    scheduledChanged(a);
  });
  handle('deleteScheduled', async (a, id) => {
    const unusedFile = a.store.deleteScheduled(requireId(id));
    if (unusedFile) await rm(unusedFile, { force: true });
    a.whatsapp.emitLocal({ type: 'scheduled-changed' });
    scheduledChanged(a);
  });
  handle('sendScheduledNow', (a, id) => {
    a.store.setScheduledStatus(requireId(id), 'pending', { sendAt: Date.now(), error: null });
    a.whatsapp.emitLocal({ type: 'scheduled-changed' });
    scheduledChanged(a);
  });

  handle('openCallsWindow', (a, chatId) => ctx.openCallsWindow(a, typeof chatId === 'string' ? chatId : undefined));
}
