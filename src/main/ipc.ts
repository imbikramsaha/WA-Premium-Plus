import { copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { dialog, ipcMain, shell, systemPreferences } from 'electron';
import { firstOccurrence, normalizeRule } from '../shared/schedule';
import type { ScheduleTarget } from '../shared/types';
import { describeFile, keepAttachment } from './media';
import type { Scheduler } from './scheduler';
import type { Attachment, NewSchedule, Store } from './store';
import type { WhatsApp } from './whatsapp';

const MAX_TEXT_LENGTH = 65_536;
const MAX_RECIPIENTS = 256;

function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${what} is required.`);
  if (value.length > MAX_TEXT_LENGTH) throw new Error(`${what} is too long.`);
  return value;
}

function optionalString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) throw new Error('Invalid text.');
  return value;
}

function requireId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error('Invalid ID.');
  return value;
}

interface ParsedScheduleInput {
  target: ScheduleTarget;
  chatIds: string[];
  body: string;
  sendAt: number;
  rule: NewSchedule['rule'];
  attachmentPath?: string | null;
}

function parseScheduleInput(value: unknown): ParsedScheduleInput {
  const input = (value ?? {}) as Record<string, unknown>;
  const target = input.target === 'status' ? 'status' : 'chat';
  const sendAt = input.sendAt;
  if (typeof sendAt !== 'number' || !Number.isFinite(sendAt)) throw new Error('Pick a date and time.');
  if (sendAt < Date.now() - 60_000) throw new Error('Pick a time in the future.');
  const rule = normalizeRule(input.rule);
  if (rule.endAt !== undefined && rule.endAt < sendAt) throw new Error('The end date is before the first send.');

  let chatIds: string[] = ['status@broadcast'];
  if (target === 'chat') {
    const ids = Array.isArray(input.chatIds) ? input.chatIds : [];
    chatIds = [...new Set(ids.map((id) => requireString(id, 'Chat')))];
    if (chatIds.length === 0) throw new Error('Choose at least one chat.');
    if (chatIds.length > MAX_RECIPIENTS) throw new Error(`You can pick up to ${MAX_RECIPIENTS} chats at once.`);
  }

  const attachmentPath = input.attachmentPath;
  if (attachmentPath !== undefined && attachmentPath !== null && typeof attachmentPath !== 'string') {
    throw new Error('Invalid attachment.');
  }
  const body = optionalString(input.body).trim();
  if (!body && !attachmentPath) throw new Error('Write a message or attach a file.');
  return { target, chatIds, body, sendAt, rule, attachmentPath };
}

/** Statuses can only show a photo or a video. */
async function checkStatusAttachment(target: ScheduleTarget, path: string | undefined, kind?: string) {
  if (target !== 'status') return;
  const fileKind = kind ?? (path ? (await describeFile(path)).kind : undefined);
  if (fileKind && fileKind !== 'image' && fileKind !== 'video') {
    throw new Error('A status can include a photo or a video, but not other files.');
  }
}

export function registerIpc({
  store,
  whatsapp,
  scheduler,
  attachmentsDir,
  mediaDir,
  onScheduledChanged,
  openCallsWindow,
}: {
  store: Store;
  whatsapp: WhatsApp;
  scheduler: Scheduler;
  attachmentsDir: string;
  mediaDir: string;
  onScheduledChanged: () => void;
  openCallsWindow: (chatId?: string) => Promise<void>;
}): void {
  const scheduledChanged = () => {
    onScheduledChanged();
    scheduler.poke();
  };

  const mediaPath = async (chatId: unknown, messageId: unknown) => {
    const name = await whatsapp.downloadMedia(requireString(chatId, 'Chat'), requireString(messageId, 'Message'));
    return join(mediaDir, name);
  };

  ipcMain.handle('wapp:getConnection', () => whatsapp.connection);
  ipcMain.handle('wapp:logout', () => whatsapp.logout());

  ipcMain.handle('wapp:listChats', () => store.listChats());
  ipcMain.handle('wapp:listMessages', (_e, chatId: unknown, before: unknown) =>
    store.listMessages(requireString(chatId, 'Chat'), 100, typeof before === 'number' ? before : undefined),
  );
  ipcMain.handle('wapp:markRead', (_e, chatId: unknown) => whatsapp.markRead(requireString(chatId, 'Chat')));
  ipcMain.handle('wapp:sendText', (_e, chatId: unknown, text: unknown) =>
    whatsapp.sendText(requireString(chatId, 'Chat'), requireString(text, 'Message').trim()),
  );
  ipcMain.handle('wapp:sendFile', async (_e, chatId: unknown, file: unknown, caption: unknown) => {
    const id = requireString(chatId, 'Chat');
    const f = (file ?? {}) as Record<string, unknown>;
    if (typeof f.path === 'string') {
      await whatsapp.sendFile(id, f.path, optionalString(caption));
    } else if (f.data instanceof Uint8Array && typeof f.name === 'string' && typeof f.mimetype === 'string') {
      await whatsapp.sendPastedFile(id, f.data, f.name, f.mimetype, optionalString(caption));
    } else {
      throw new Error('Invalid file.');
    }
  });
  ipcMain.handle('wapp:sendVoiceNote', (_e, chatId: unknown, webm: unknown, seconds: unknown, waveform: unknown) => {
    if (!(webm instanceof Uint8Array)) throw new Error('Invalid recording.');
    const bars = Array.isArray(waveform) ? waveform.filter((v): v is number => typeof v === 'number') : [];
    return whatsapp.sendVoiceNote(requireString(chatId, 'Chat'), webm, typeof seconds === 'number' ? seconds : 0, bars);
  });
  ipcMain.handle('wapp:requestMicrophone', async () => {
    if (process.platform !== 'darwin') return true;
    return systemPreferences.askForMediaAccess('microphone');
  });

  ipcMain.handle('wapp:refreshChatMedia', (_e, chatId: unknown) =>
    whatsapp.refreshChatMedia(requireString(chatId, 'Chat')).catch(() => false),
  );
  ipcMain.handle('wapp:downloadMedia', async (_e, chatId: unknown, messageId: unknown) => {
    const name = await whatsapp.downloadMedia(requireString(chatId, 'Chat'), requireString(messageId, 'Message'));
    return store.mediaUrl(name);
  });
  ipcMain.handle('wapp:openMedia', async (_e, chatId: unknown, messageId: unknown) => {
    const error = await shell.openPath(await mediaPath(chatId, messageId));
    if (error) throw new Error(error);
  });
  ipcMain.handle('wapp:saveMedia', async (_e, chatId: unknown, messageId: unknown) => {
    const source = await mediaPath(chatId, messageId);
    const message = store.getMessage(String(chatId), String(messageId));
    const suggested = message?.media?.fileName ?? source.split(/[\\/]/).pop();
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: suggested });
    if (canceled || !filePath) return;
    await copyFile(source, filePath);
  });

  ipcMain.handle('wapp:getGroupInfo', (_e, chatId: unknown) => whatsapp.getGroupInfo(requireString(chatId, 'Chat')));
  ipcMain.handle('wapp:getGroupInviteLink', (_e, chatId: unknown) =>
    whatsapp.getGroupInviteLink(requireString(chatId, 'Chat')),
  );

  ipcMain.handle('wapp:listScheduled', () => store.listScheduled());
  ipcMain.handle('wapp:createScheduled', async (_e, value: unknown) => {
    const input = parseScheduleInput(value);
    await checkStatusAttachment(input.target, input.attachmentPath ?? undefined);
    const attachment: Attachment | null = input.attachmentPath
      ? await keepAttachment(input.attachmentPath, attachmentsDir)
      : null;
    const sendAt = firstOccurrence(input.sendAt, input.rule);
    store.transaction(() => {
      for (const chatId of input.chatIds) {
        store.createScheduled({ ...input, chatId, attachment, sendAt, anchorAt: input.sendAt });
      }
    });
    scheduledChanged();
  });
  ipcMain.handle('wapp:updateScheduled', async (_e, id: unknown, value: unknown) => {
    const scheduleId = requireId(id);
    const input = parseScheduleInput(value);
    if (input.chatIds.length !== 1) throw new Error('A scheduled message goes to one chat. Create new ones for others.');
    const previous = store.getScheduled(scheduleId);
    if (typeof input.attachmentPath === 'string') await checkStatusAttachment(input.target, input.attachmentPath);
    else if (input.attachmentPath === undefined) await checkStatusAttachment(input.target, undefined, previous?.attachment?.kind);
    let attachment: Attachment | null | undefined;
    if (input.attachmentPath === null) attachment = null;
    else if (typeof input.attachmentPath === 'string' && input.attachmentPath !== previous?.attachment?.path) {
      attachment = await keepAttachment(input.attachmentPath, attachmentsDir);
    }
    store.updateScheduled(scheduleId, {
      ...input,
      chatId: input.chatIds[0]!,
      attachment,
      sendAt: firstOccurrence(input.sendAt, input.rule),
      anchorAt: input.sendAt,
    });
    const oldPath = previous?.attachment?.path;
    if (attachment !== undefined && oldPath && !store.isAttachmentUsed(oldPath)) await rm(oldPath, { force: true });
    scheduledChanged();
  });
  ipcMain.handle('wapp:cancelScheduled', (_e, id: unknown) => {
    store.setScheduledStatus(requireId(id), 'cancelled');
    scheduledChanged();
  });
  ipcMain.handle('wapp:deleteScheduled', async (_e, id: unknown) => {
    const unusedFile = store.deleteScheduled(requireId(id));
    if (unusedFile) await rm(unusedFile, { force: true });
    scheduledChanged();
  });
  ipcMain.handle('wapp:sendScheduledNow', (_e, id: unknown) => {
    store.setScheduledStatus(requireId(id), 'pending', { sendAt: Date.now(), error: null });
    scheduledChanged();
  });

  ipcMain.handle('wapp:openCallsWindow', (_e, chatId: unknown) =>
    openCallsWindow(typeof chatId === 'string' ? chatId : undefined),
  );
}
