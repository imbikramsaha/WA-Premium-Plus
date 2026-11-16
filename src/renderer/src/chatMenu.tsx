// The actions for a chat: used by the chat list's right-click menu and the conversation's menu.

import type { ChatSummary, Label } from '../../shared/types';
import { errorMessage } from './format';
import { ArchiveIcon, BellIcon, BellOffIcon, ChatsIcon, PinIcon, TagIcon, TrashIcon } from './components/Icons';
import type { MenuItem } from './components/Menu';

export const LABEL_COLORS = ['#c9b458', '#6fa86f', '#5b8fd1', '#c7785b', '#a77bc9', '#4fa3a5', '#d0648a', '#8a8f98'];

export function isMuted(chat: Pick<ChatSummary, 'mutedUntil'>, now = Date.now()): boolean {
  return chat.mutedUntil === -1 || chat.mutedUntil > now;
}

const HOUR = 3_600_000;

async function run(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (err) {
    window.alert(errorMessage(err));
  }
}

export function chatMenuItems(
  chat: ChatSummary,
  labels: Label[],
  { onNewLabel }: { onNewLabel: () => void },
): MenuItem[] {
  const muted = isMuted(chat);
  const isChannel = chat.id.endsWith('@newsletter');
  return [
    {
      label: chat.pinned ? 'Unpin chat' : 'Pin chat',
      icon: <PinIcon size={15} />,
      onClick: () => void run(() => window.wapp.chatAction(chat.id, { type: 'pin', value: !chat.pinned })),
    },
    {
      label: chat.archived ? 'Unarchive chat' : 'Archive chat',
      icon: <ArchiveIcon size={15} />,
      onClick: () => void run(() => window.wapp.chatAction(chat.id, { type: 'archive', value: !chat.archived })),
    },
    muted
      ? {
          label: 'Unmute notifications',
          icon: <BellIcon size={15} />,
          onClick: () =>
            void run(() =>
              isChannel ? window.wapp.muteChannel(chat.id, false) : window.wapp.chatAction(chat.id, { type: 'mute', until: 0 }),
            ),
        }
      : isChannel
        ? { label: 'Mute notifications', icon: <BellOffIcon size={15} />, onClick: () => void run(() => window.wapp.muteChannel(chat.id, true)) }
        : {
            label: 'Mute notifications',
            icon: <BellOffIcon size={15} />,
            submenu: [
              { label: 'For 8 hours', until: Date.now() + 8 * HOUR },
              { label: 'For 1 week', until: Date.now() + 7 * 24 * HOUR },
              { label: 'Always', until: -1 },
            ].map(({ label, until }) => ({
              label,
              onClick: () => void run(() => window.wapp.chatAction(chat.id, { type: 'mute', until })),
            })),
          },
    {
      label: 'Mark as unread',
      icon: <ChatsIcon size={15} />,
      disabled: chat.unreadCount > 0,
      onClick: () => void run(() => window.wapp.chatAction(chat.id, { type: 'markUnread' })),
    },
    {
      label: 'Labels',
      icon: <TagIcon size={15} />,
      submenu: [
        ...labels.map((label) => ({
          label: label.name,
          checked: chat.labels.includes(label.id),
          icon: <span className="label-dot" style={{ background: LABEL_COLORS[label.color % LABEL_COLORS.length] }} />,
          onClick: () => void run(() => window.wapp.setChatLabel(chat.id, label.id, !chat.labels.includes(label.id))),
        })),
        { label: 'New label…', separator: labels.length > 0, onClick: onNewLabel },
      ],
    },
    {
      label: 'Delete chat',
      icon: <TrashIcon size={15} />,
      danger: true,
      separator: true,
      onClick: () => {
        if (!window.confirm(`Delete the chat with ${chat.name}?\n\nIt's deleted on your phone too.`)) return;
        void run(() => window.wapp.chatAction(chat.id, { type: 'delete' }));
      },
    },
  ];
}
