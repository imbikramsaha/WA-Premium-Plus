import { useEffect, useState } from 'react';
import type { AccountSummary } from '../../../shared/types';
import { errorMessage } from '../format';
import { Avatar } from './Avatar';
import { LogoutIcon, PlusIcon, TrashIcon } from './Icons';
import { Menu, useMenu, type MenuItem } from './Menu';

/** The account button at the bottom of the rail: switch, add or remove WhatsApp accounts. */
export function AccountSwitcher() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const { menu, close, openAt } = useMenu();

  useEffect(() => {
    const load = () => void window.wapp.listAccounts().then(setAccounts);
    load();
    return window.wapp.onEvent((e) => (e.type === 'accounts-changed' || e.type === 'account-switched') && load());
  }, []);

  const active = accounts.find((a) => a.active);
  const othersUnread = accounts.filter((a) => !a.active).reduce((n, a) => n + a.unreadChats, 0);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (err) {
      window.alert(errorMessage(err));
    }
  }

  function open(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const items: MenuItem[] = accounts.map((a) => ({
      label: `${a.name}${a.phone && a.phone !== a.name ? ` · ${a.phone}` : ''}${a.unreadChats ? ` (${a.unreadChats})` : ''}${
        a.linked ? (a.status === 'open' ? '' : ' · connecting') : ' · not linked'
      }`,
      checked: a.active,
      onClick: () => !a.active && void run(() => window.wapp.switchAccount(a.id)),
    }));
    items.push({ label: 'Add WhatsApp account', icon: <PlusIcon size={15} />, separator: true, onClick: () => void run(() => window.wapp.addAccount()) });
    if (accounts.length > 1 && active) {
      items.push({
        label: 'Remove this account…',
        icon: <TrashIcon size={15} />,
        danger: true,
        onClick: () => {
          if (!window.confirm(`Remove ${active.name} from WA Premium Plus?\n\nThis unlinks it and deletes its chats and schedules from this computer.`)) return;
          void run(() => window.wapp.removeAccount(active.id));
        },
      });
    } else {
      items.push({
        label: 'Log out…',
        icon: <LogoutIcon size={15} />,
        danger: true,
        onClick: () => {
          if (!window.confirm('Log out of WhatsApp on this computer?\n\nThis removes your chats and scheduled messages from WA Premium Plus.')) return;
          void run(() => window.wapp.logout());
        },
      });
    }
    openAt({ clientX: r.right + 8, clientY: r.top - 40 * items.length + r.height }, items);
  }

  return (
    <>
      <button className="rail-button account-button" onClick={open} title={active ? `${active.name} — switch or add accounts` : 'Accounts'}>
        <Avatar id={active?.phone ? `${active.phone.slice(1)}@s.whatsapp.net` : 'me'} name={active?.name ?? 'Me'} size={30} />
        {othersUnread > 0 && <span className="rail-badge">{othersUnread}</span>}
      </button>
      {menu && <Menu {...menu} onClose={close} />}
    </>
  );
}
