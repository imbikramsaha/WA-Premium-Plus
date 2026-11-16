import { ipcMain } from 'electron';
import type { Repeat, ScheduleInput } from '../shared/types';
import type { Scheduler } from './scheduler';
import type { Store } from './store';
import type { WhatsApp } from './whatsapp';

const REPEATS: readonly Repeat[] = ['none', 'daily', 'weekly', 'monthly'];
const MAX_TEXT_LENGTH = 65_536;

function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${what} is required.`);
  if (value.length > MAX_TEXT_LENGTH) throw new Error(`${what} is too long.`);
  return value;
}

function requireId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error('Invalid ID.');
  return value;
}

function parseScheduleInput(value: unknown): ScheduleInput {
  const input = (value ?? {}) as Partial<Record<keyof ScheduleInput, unknown>>;
  const sendAt = input.sendAt;
  if (typeof sendAt !== 'number' || !Number.isFinite(sendAt)) throw new Error('Pick a date and time.');
  if (sendAt < Date.now() - 60_000) throw new Error('Pick a time in the future.');
  if (!REPEATS.includes(input.repeat as Repeat)) throw new Error('Invalid repeat option.');
  return {
    chatId: requireString(input.chatId, 'Chat'),
    body: requireString(input.body, 'Message').trim(),
    sendAt,
    repeat: input.repeat as Repeat,
  };
}

export function registerIpc({
  store,
  whatsapp,
  scheduler,
  onScheduledChanged,
}: {
  store: Store;
  whatsapp: WhatsApp;
  scheduler: Scheduler;
  onScheduledChanged: () => void;
}): void {
  const scheduledChanged = () => {
    onScheduledChanged();
    scheduler.poke();
  };

  ipcMain.handle('wapp:getConnection', () => whatsapp.connection);
  ipcMain.handle('wapp:logout', () => whatsapp.logout());

  ipcMain.handle('wapp:listChats', () => store.listChats());
  ipcMain.handle('wapp:listMessages', (_e, chatId: unknown) =>
    store.listMessages(requireString(chatId, 'Chat')),
  );
  ipcMain.handle('wapp:markRead', (_e, chatId: unknown) => whatsapp.markRead(requireString(chatId, 'Chat')));
  ipcMain.handle('wapp:sendText', (_e, chatId: unknown, text: unknown) =>
    whatsapp.sendText(requireString(chatId, 'Chat'), requireString(text, 'Message').trim()),
  );

  ipcMain.handle('wapp:listScheduled', () => store.listScheduled());
  ipcMain.handle('wapp:createScheduled', (_e, input: unknown) => {
    store.createScheduled(parseScheduleInput(input));
    scheduledChanged();
  });
  ipcMain.handle('wapp:updateScheduled', (_e, id: unknown, input: unknown) => {
    store.updateScheduled(requireId(id), parseScheduleInput(input));
    scheduledChanged();
  });
  ipcMain.handle('wapp:cancelScheduled', (_e, id: unknown) => {
    store.setScheduledStatus(requireId(id), 'cancelled');
    scheduledChanged();
  });
  ipcMain.handle('wapp:deleteScheduled', (_e, id: unknown) => {
    store.deleteScheduled(requireId(id));
    scheduledChanged();
  });
  ipcMain.handle('wapp:sendScheduledNow', (_e, id: unknown) => {
    store.setScheduledStatus(requireId(id), 'pending', { sendAt: Date.now(), error: null });
    scheduledChanged();
  });
}
