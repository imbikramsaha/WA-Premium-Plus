import { useEffect, useState } from 'react';
import { ephemeralLabel } from '../../../shared/group-actions';
import type { GroupInfo } from '../../../shared/types';
import { errorMessage } from '../format';
import { Avatar } from './Avatar';
import { ClockIcon, CloseIcon } from './Icons';

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

export function GroupInfoPanel({
  chatId,
  onClose,
  onScheduleChange,
}: {
  chatId: string;
  onClose: () => void;
  /** Opens the schedule dialog for a settings change in this group. */
  onScheduleChange: () => void;
}) {
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
          <h4>Settings</h4>
          <dl className="group-settings">
            <div>
              <dt>Send messages</dt>
              <dd>{info.announce ? 'Only admins' : 'Everyone'}</dd>
            </div>
            <div>
              <dt>Edit group info</dt>
              <dd>{info.restrict ? 'Only admins' : 'Everyone'}</dd>
            </div>
            <div>
              <dt>Add members</dt>
              <dd>{info.adminsAddMembers ? 'Only admins' : 'Everyone'}</dd>
            </div>
            <div>
              <dt>Approve new members</dt>
              <dd>{info.joinApproval ? 'On' : 'Off'}</dd>
            </div>
            <div>
              <dt>Disappearing messages</dt>
              <dd>{ephemeralLabel(info.ephemeralSeconds)}</dd>
            </div>
          </dl>
          {info.amAdmin ? (
            <div className="group-actions">
              <button className="button primary" onClick={onScheduleChange}>
                <ClockIcon size={16} />
                Schedule a change
              </button>
              <button className="button" onClick={() => void copyInvite()}>
                {copied ? 'Invite link copied' : 'Copy invite link'}
              </button>
            </div>
          ) : (
            <p className="muted small">Only group admins can change or schedule changes to these settings.</p>
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
