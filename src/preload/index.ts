import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AppEvent, WappApi } from '../shared/types';

const invoke = <T>(channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(`wapp:${channel}`, ...args) as Promise<T>;

const api: WappApi = {
  platform: process.platform,
  getConnection: () => invoke('getConnection'),
  logout: () => invoke('logout'),
  listChats: () => invoke('listChats'),
  listMessages: (chatId) => invoke('listMessages', chatId),
  markRead: (chatId) => invoke('markRead', chatId),
  sendText: (chatId, text) => invoke('sendText', chatId, text),
  listScheduled: () => invoke('listScheduled'),
  createScheduled: (input) => invoke('createScheduled', input),
  updateScheduled: (id, input) => invoke('updateScheduled', id, input),
  cancelScheduled: (id) => invoke('cancelScheduled', id),
  deleteScheduled: (id) => invoke('deleteScheduled', id),
  sendScheduledNow: (id) => invoke('sendScheduledNow', id),
  onEvent(listener) {
    const handler = (_e: IpcRendererEvent, event: AppEvent) => listener(event);
    ipcRenderer.on('wapp:event', handler);
    return () => {
      ipcRenderer.removeListener('wapp:event', handler);
    };
  },
};

contextBridge.exposeInMainWorld('wapp', api);
