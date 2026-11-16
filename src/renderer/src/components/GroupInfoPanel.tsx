import { useEffect, useState } from 'react';
import type { GroupInfo } from '../../../shared/types';
import { errorMessage } from '../format';
import { Avatar } from './Avatar';
import { CloseIcon } from './Icons';

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

export function GroupInfoPanel({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const [info, setInfo] = useState<GroupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setInfo(null);
    setError(null);
    window.wapp
      .getGroupInfo(chatId)
      .then((result) => active && setInfo(result))
      .catch((err) => active && setError(errorMessage(err)));
    return () => {
      active = false;
    };
  }, [chatId]);

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(await window.wapp.getGroupInviteLink(chatId));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const q = query.trim().toLowerCase();
  const members = info?.participants.filter((p) => !q || p.name.toLowerCase().includes(q) || p.phone?.includes(q)) ?? [];

  return (
    <aside className="side-panel">
      <header className="side-panel-header">
        <h3>Group info</h3>
        <button className="icon-button" onClick={onClose} title="Close">
          <CloseIcon />
        </button>
      </header>
      {error && <p className="error side-panel-pad">{error}</p>}
      {!info && !error && (
        <div className="side-panel-pad">
          <div className="spinner" />
        </div>
      )}
      {info && (
        <div className="side-panel-body">
          <div className="group-hero">
            <Avatar id={info.id} name={info.subject} size={72} />
            <h2>{info.subject}</h2>
            <span className="muted">
              Group · {info.participants.length} members
              {info.createdAt ? ` · created ${dateFormat.format(new Date(info.createdAt * 1000))}` : ''}
            </span>
          </div>
          {info.description && <p className="group-description">{info.description}</p>}
          <div className="group-flags">
            {info.announce && <span className="pill">Only admins can send messages</span>}
            {info.restrict && <span className="pill">Only admins can edit info</span>}
          </div>
          {info.amAdmin && (
            <button className="button" onClick={() => void copyInvite()}>
              {copied ? 'Invite link copied' : 'Copy invite link'}
            </button>
          )}
          <h4>{info.participants.length} members</h4>
          {info.participants.length > 8 && (
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search members" />
          )}
          <ul className="member-list">
            {members.map((p) => (
              <li key={p.id}>
                <Avatar id={p.id} name={p.name} size={36} />
                <div className="member-main">
                  <span className="member-name">{p.name}</span>
                  {p.phone && p.phone !== p.name && <span className="muted small">{p.phone}</span>}
                </div>
                {p.isAdmin && <span className="pill">{p.isSuperAdmin ? 'Owner' : 'Admin'}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
