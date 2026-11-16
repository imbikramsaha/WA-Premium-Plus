// Views and actions beyond chatting: automation, broadcasts, insights and settings.
// MainScreen shows these in its rail; the conversation adds their actions to its menus.

import { useMemo, useState } from 'react';
import { AutomationView } from './components/AutomationView';
import { BroadcastsView } from './components/BroadcastsView';
import { BellRingIcon, BoltIcon, MegaphoneIcon, UsersIcon } from './components/Icons';
import type { MainScreenExtras } from './components/MainScreen';
import { ReminderDialog } from './components/ReminderDialog';
import { errorMessage } from './format';

export function useExtras(): MainScreenExtras {
  const [reminder, setReminder] = useState<{ chatId: string; chatName: string; messageId?: string } | null>(null);

  return useMemo<MainScreenExtras>(
    () => ({
      railItems: [
        { view: 'broadcasts', title: 'Broadcasts', icon: <MegaphoneIcon /> },
        { view: 'automation', title: 'Automation', icon: <BoltIcon /> },
      ],
      renderView: (view, api) => {
        if (view === 'broadcasts') return <BroadcastsView chats={api.chats} connected={api.connected} />;
        if (view === 'automation') return <AutomationView chats={api.chats} labels={api.labels} onOpenChat={api.openChat} />;
        return null;
      },
      conversation: {
        menuItems: (chat) =>
          chat.id.endsWith('@newsletter')
            ? []
            : [
                {
                  label: 'Follow-up reminder…',
                  icon: <BellRingIcon size={15} />,
                  onClick: () => setReminder({ chatId: chat.id, chatName: chat.name }),
                },
              ],
        messageMenuItems: (message, chat) =>
          chat.id.endsWith('@newsletter')
            ? []
            : [
                {
                  label: 'Remind me…',
                  icon: <BellRingIcon size={15} />,
                  onClick: () => setReminder({ chatId: chat.id, chatName: chat.name, messageId: message.id }),
                },
              ],
        groupMemberActions: (info) => [
          {
            label: 'Make a contact list from members',
            icon: <UsersIcon size={15} />,
            onClick: () => {
              const members = info.participants.filter((p) => !p.isMe && p.id.endsWith('@s.whatsapp.net'));
              void window.wapp
                .createContactList({ name: `${info.subject} members`, members: members.map((p) => ({ jid: p.id, name: p.name })) })
                .then((r) => window.alert(`Made the list "${info.subject} members" with ${r.added} people. Find it under Broadcasts → Contact lists.`))
                .catch((err) => window.alert(errorMessage(err)));
            },
          },
        ],
      },
      overlay: reminder ? <ReminderDialog {...reminder} onClose={() => setReminder(null)} /> : null,
    }),
    [reminder],
  );
}
