import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { AppEvent, WappApi } from '../shared/types';

const invoke = <T>(channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(`wapp:${channel}`, ...args) as Promise<T>;

const api: WappApi = {
  platform: process.platform,
  getConnection: () => invoke('getConnection'),
  logout: () => invoke('logout'),
  requestPairingCode: (phone) => invoke('requestPairingCode', phone),
  listAccounts: () => invoke('listAccounts'),
  switchAccount: (id) => invoke('switchAccount', id),
  addAccount: () => invoke('addAccount'),
  removeAccount: (id) => invoke('removeAccount', id),

  listChats: () => invoke('listChats'),
  listContacts: () => invoke('listContacts'),
  startChat: (phone) => invoke('startChat', phone),
  checkNumbers: (phones) => invoke('checkNumbers', phones),
  listMessages: (chatId, before) => invoke('listMessages', chatId, before),
  listMessagesAround: (chatId, messageId) => invoke('listMessagesAround', chatId, messageId),
  searchMessages: (query, chatId) => invoke('searchMessages', query, chatId),
  markRead: (chatId) => invoke('markRead', chatId),
  sendText: (chatId, text, quotedId) => invoke('sendText', chatId, text, quotedId),
  sendRich: (chatId, content, quotedId) => invoke('sendRich', chatId, content, quotedId),
  sendFile: (chatId, file, caption) => invoke('sendFile', chatId, file, caption),
  sendVoiceNote: (chatId, webm, seconds, waveform) => invoke('sendVoiceNote', chatId, webm, seconds, waveform),
  requestMicrophone: () => invoke('requestMicrophone'),
  react: (chatId, messageId, emoji) => invoke('react', chatId, messageId, emoji),
  forward: (chatId, messageId, toChatIds) => invoke('forward', chatId, messageId, toChatIds),
  editMessage: (chatId, messageId, text) => invoke('editMessage', chatId, messageId, text),
  deleteMessage: (chatId, messageId, forEveryone) => invoke('deleteMessage', chatId, messageId, forEveryone),
  votePoll: (chatId, messageId, options) => invoke('votePoll', chatId, messageId, options),

  chatAction: (chatId, action) => invoke('chatAction', chatId, action),
  listLabels: () => invoke('listLabels'),
  saveLabel: (label) => invoke('saveLabel', label),
  deleteLabel: (id) => invoke('deleteLabel', id),
  setChatLabel: (chatId, labelId, on) => invoke('setChatLabel', chatId, labelId, on),
  getAvatar: (id) => invoke('getAvatar', id),
  listCalls: () => invoke('listCalls'),

  refreshChatMedia: (chatId) => invoke('refreshChatMedia', chatId),
  downloadMedia: (chatId, messageId) => invoke('downloadMedia', chatId, messageId),
  openMedia: (chatId, messageId) => invoke('openMedia', chatId, messageId),
  saveMedia: (chatId, messageId) => invoke('saveMedia', chatId, messageId),

  listStatuses: () => invoke('listStatuses'),
  postStatus: (text, file, backgroundColor) => invoke('postStatus', text, file, backgroundColor),
  markStatusViewed: (messageId, author) => invoke('markStatusViewed', messageId, author),
  followChannel: (link) => invoke('followChannel', link),
  unfollowChannel: (id) => invoke('unfollowChannel', id),
  getChannelInfo: (id) => invoke('getChannelInfo', id),
  muteChannel: (id, muted) => invoke('muteChannel', id, muted),

  getGroupInfo: (chatId) => invoke('getGroupInfo', chatId),
  getGroupInviteLink: (chatId) => invoke('getGroupInviteLink', chatId),
  applyGroupAction: (chatId, action) => invoke('applyGroupAction', chatId, action),
  updateMembers: (groupId, ids, action) => invoke('updateMembers', groupId, ids, action),
  createGroup: (subject, members) => invoke('createGroup', subject, members),
  leaveGroup: (groupId) => invoke('leaveGroup', groupId),

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
