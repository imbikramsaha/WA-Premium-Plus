import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { AppEvent, WappApi } from '../shared/types';

const invoke = <T>(channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(`wapp:${channel}`, ...args) as Promise<T>;

const api: WappApi = {
  platform: process.platform,
  getConnection: () => invoke('getConnection'),
  logout: () => invoke('logout'),

  listChats: () => invoke('listChats'),
  listMessages: (chatId, before) => invoke('listMessages', chatId, before),
  markRead: (chatId) => invoke('markRead', chatId),
  sendText: (chatId, text) => invoke('sendText', chatId, text),
  sendFile: (chatId, file, caption) => invoke('sendFile', chatId, file, caption),
  sendVoiceNote: (chatId, webm, seconds, waveform) => invoke('sendVoiceNote', chatId, webm, seconds, waveform),
  requestMicrophone: () => invoke('requestMicrophone'),

  refreshChatMedia: (chatId) => invoke('refreshChatMedia', chatId),
  downloadMedia: (chatId, messageId) => invoke('downloadMedia', chatId, messageId),
  openMedia: (chatId, messageId) => invoke('openMedia', chatId, messageId),
  saveMedia: (chatId, messageId) => invoke('saveMedia', chatId, messageId),

  getGroupInfo: (chatId) => invoke('getGroupInfo', chatId),
  getGroupInviteLink: (chatId) => invoke('getGroupInviteLink', chatId),

  listScheduled: () => invoke('listScheduled'),
  createScheduled: (input) => invoke('createScheduled', input),
  updateScheduled: (id, input) => invoke('updateScheduled', id, input),
  cancelScheduled: (id) => invoke('cancelScheduled', id),
  deleteScheduled: (id) => invoke('deleteScheduled', id),
  sendScheduledNow: (id) => invoke('sendScheduledNow', id),

  openCallsWindow: (chatId) => invoke('openCallsWindow', chatId),

  getPathForFile: (file) => webUtils.getPathForFile(file),
  onEvent(listener) {
    const handler = (_e: IpcRendererEvent, event: AppEvent) => listener(event);
    ipcRenderer.on('wapp:event', handler);
    return () => {
      ipcRenderer.removeListener('wapp:event', handler);
    };
  },
};

contextBridge.exposeInMainWorld('wapp', api);
