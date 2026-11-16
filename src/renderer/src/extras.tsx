// Views and actions beyond chatting: automation, broadcasts, insights and settings.
// MainScreen shows these in its rail; the conversation adds their actions to its menus.

import { useMemo, useState } from 'react';
import { AutomationView } from './components/AutomationView';
import { BroadcastsView } from './components/BroadcastsView';
import { BellRingIcon, BoltIcon, ChartIcon, ExportIcon, MegaphoneIcon, UsersIcon } from './components/Icons';
import { InsightsView } from './components/InsightsView';
import { ExportDialog } from './components/ExportDialog';
import { toCsv } from '../../shared/csv';
import type { MainScreenExtras } from './components/MainScreen';
import { ReminderDialog } from './components/ReminderDialog';
import { errorMessage } from './format';

export function useExtras(): MainScreenExtras {
  const [reminder, setReminder] = useState<{ chatId: string; chatName: string; messageId?: string } | null>(null);
  const [exporting, setExporting] = useState<{ chatId?: string; chatName?: string } | null>(null);

  return useMemo<MainScreenExtras>(
    () => ({
      railItems: [
        { view: 'broadcasts', title: 'Broadcasts', icon: <MegaphoneIcon /> },
        { view: 'automation', title: 'Automation', icon: <BoltIcon /> },
        { view: 'insights', title: 'Insights', icon: <ChartIcon /> },
      ],
      renderView: (view, api) => {
        if (view === 'broadcasts') return <BroadcastsView chats={api.chats} connected={api.connected} />;
        if (view === 'automation') return <AutomationView chats={api.chats} labels={api.labels} onOpenChat={api.openChat} />;
        if (view === 'insights') return <InsightsView onOpenChat={api.openChat} />;
        return null;
      },
      conversation: {
        menuItems: (chat) => [
          ...(chat.id.endsWith('@newsletter')
            ? []
            : [
                {
                  label: 'Follow-up reminder…',
                  icon: <BellRingIcon size={15} />,
                  onClick: () => setReminder({ chatId: chat.id, chatName: chat.name }),
                },
              ]),
          { label: 'Export chat…', icon: <ExportIcon size={15} />, onClick: () => setExporting({ chatId: chat.id, chatName: chat.name }) },
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
            label: 'Export members as CSV',
            icon: <ExportIcon size={15} />,
            onClick: () => {
              const csv = toCsv([
                ['Name', 'Phone', 'Admin', 'WhatsApp ID'],
                ...info.participants.map((p) => [p.isMe ? 'You' : p.name, p.phone ?? '', p.isSuperAdmin ? 'Owner' : p.isAdmin ? 'Admin' : '', p.id]),
              ]);
              void window.wapp.saveTextFile(`${info.subject.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Group'} members.csv`, csv).catch((err) => window.alert(errorMessage(err)));
            },
          },
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
      overlay: (
        <>
          {reminder && <ReminderDialog {...reminder} onClose={() => setReminder(null)} />}
          {exporting && <ExportDialog {...exporting} onClose={() => setExporting(null)} />}
        </>
      ),
      openExport: () => setExporting({}),
    }),
    [reminder, exporting],
  );
}
