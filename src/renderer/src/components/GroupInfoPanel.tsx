import { useEffect, useState } from 'react';
import { EPHEMERAL_OPTIONS, ephemeralLabel } from '../../../shared/group-actions';
import type { ContactInfo, GroupAction, GroupInfo, GroupParticipantInfo } from '../../../shared/types';
import { errorMessage } from '../format';
import { Avatar } from './Avatar';
import { ChatPicker } from './ChatPicker';
import { ClockIcon, CloseIcon, EditIcon, MoreIcon, UserPlusIcon } from './Icons';
import { Menu, Modal, useMenu, type MenuItem } from './Menu';

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

function SettingRow({
  label,
  value,
  options,
  editable,
  onChange,
}: {
  label: string;
  value: string;
  options?: Array<{ label: string; action: GroupAction }>;
  editable: boolean;
  onChange: (action: GroupAction) => void;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {editable && options ? (
          <select
            value={value}
            onChange={(e) => {
              const picked = options.find((o) => o.label === e.target.value);
              if (picked) onChange(picked.action);
            }}
          >
            {options.map((o) => (
              <option key={o.label}>{o.label}</option>
            ))}
          </select>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

export function GroupInfoPanel({
  chatId,
  onClose,
  onScheduleChange,
  onOpenChat,
  memberActions,
}: {
  chatId: string;
  onClose: () => void;
  /** Opens the schedule dialog for a settings change in this group. */
  onScheduleChange: () => void;
  onOpenChat: (chatId: string) => void;
  /** More actions for the member list (export as CSV, make a contact list). */
  memberActions?: (info: GroupInfo) => MenuItem[];
}) {
  const [info, setInfo] = useState<GroupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<'subject' | 'description' | null>(null);
  const [adding, setAdding] = useState(false);
  const { menu, close, openUnder } = useMenu();

  const load = () =>
    window.wapp
      .getGroupInfo(chatId)
      .then(setInfo)
      .catch((err) => setError(errorMessage(err)));

  useEffect(() => {
    setInfo(null);
    setError(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  async function run(action: () => Promise<unknown>, done?: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(await window.wapp.getGroupInviteLink(chatId));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function memberMenu(p: GroupParticipantInfo, anchor: HTMLElement) {
    const items: MenuItem[] = [];
    if (!p.isMe && p.id.endsWith('@s.whatsapp.net')) items.push({ label: `Message ${p.name}`, onClick: () => onOpenChat(p.id) });
    if (info?.amAdmin && !p.isMe && !p.isSuperAdmin) {
      items.push(
        p.isAdmin
          ? { label: 'Dismiss as admin', onClick: () => void run(() => window.wapp.updateMembers(chatId, [p.id], 'demote')) }
          : { label: 'Make group admin', onClick: () => void run(() => window.wapp.updateMembers(chatId, [p.id], 'promote')) },
        {
          label: 'Remove from group',
          danger: true,
          separator: true,
          onClick: () => {
            if (window.confirm(`Remove ${p.name} from the group?`)) void run(() => window.wapp.updateMembers(chatId, [p.id], 'remove'));
          },
        },
      );
    }
    if (items.length) openUnder(anchor, items);
  }

  const q = query.trim().toLowerCase();
  const members = info?.participants.filter((p) => !q || p.name.toLowerCase().includes(q) || p.phone?.includes(q)) ?? [];
  const canEditInfo = Boolean(info && (info.amAdmin || !info.restrict));
  const admin = Boolean(info?.amAdmin);
  const apply = (action: GroupAction) => void run(() => window.wapp.applyGroupAction(chatId, action));

  return (
    <aside className="side-panel">
      <header className="side-panel-header">
        <h3>Group info</h3>
        <button className="icon-button" onClick={onClose} title="Close">
          <CloseIcon />
        </button>
      </header>
      {error && <p className="error side-panel-pad">{error}</p>}
      {notice && <p className="notice side-panel-pad">{notice}</p>}
      {!info && !error && (
        <div className="side-panel-pad">
          <div className="spinner" />
        </div>
      )}
      {info && (
        <div className="side-panel-body">
          <div className="group-hero">
            <Avatar id={info.id} name={info.subject} size={72} />
            <h2>
              {info.subject}
              {canEditInfo && (
                <button className="icon-button tiny" title="Rename group" onClick={() => setEditing('subject')}>
                  <EditIcon size={14} />
                </button>
              )}
            </h2>
            <span className="muted">
              Group · {info.participants.length} members
              {info.createdAt ? ` · created ${dateFormat.format(new Date(info.createdAt * 1000))}` : ''}
            </span>
          </div>
          {(info.description || canEditInfo) && (
            <div className="group-description">
              {info.description || <span className="muted">No description</span>}
              {canEditInfo && (
                <button className="button link small" onClick={() => setEditing('description')}>
                  Edit
                </button>
              )}
            </div>
          )}
          <h4>Settings</h4>
          <dl className="group-settings">
            <SettingRow
              label="Send messages"
              value={info.announce ? 'Only admins' : 'Everyone'}
              editable={admin}
              options={[
                { label: 'Everyone', action: { type: 'announce', enabled: false } },
                { label: 'Only admins', action: { type: 'announce', enabled: true } },
              ]}
              onChange={apply}
            />
            <SettingRow
              label="Edit group info"
              value={info.restrict ? 'Only admins' : 'Everyone'}
              editable={admin}
              options={[
                { label: 'Everyone', action: { type: 'restrict', enabled: false } },
                { label: 'Only admins', action: { type: 'restrict', enabled: true } },
              ]}
              onChange={apply}
            />
            <SettingRow
              label="Add members"
              value={info.adminsAddMembers ? 'Only admins' : 'Everyone'}
              editable={admin}
              options={[
                { label: 'Everyone', action: { type: 'memberAdd', adminsOnly: false } },
                { label: 'Only admins', action: { type: 'memberAdd', adminsOnly: true } },
              ]}
              onChange={apply}
            />
            <SettingRow
              label="Approve new members"
              value={info.joinApproval ? 'On' : 'Off'}
              editable={admin}
              options={[
                { label: 'Off', action: { type: 'joinApproval', enabled: false } },
                { label: 'On', action: { type: 'joinApproval', enabled: true } },
              ]}
              onChange={apply}
            />
            <SettingRow
              label="Disappearing messages"
              value={ephemeralLabel(info.ephemeralSeconds)}
              editable={admin || !info.restrict}
              options={EPHEMERAL_OPTIONS.map((o) => ({ label: o.label, action: { type: 'ephemeral', seconds: o.seconds } }))}
              onChange={apply}
            />
          </dl>
          <div className="group-actions">
            {admin && (
              <button className="button primary" onClick={onScheduleChange}>
                <ClockIcon size={16} />
                Schedule a change
              </button>
            )}
            {admin && (
              <button className="button" onClick={() => void copyInvite()}>
                {copied ? 'Invite link copied' : 'Copy invite link'}
              </button>
            )}
            {admin && (
              <button
                className="button"
                onClick={() => {
                  if (window.confirm('Reset the invite link? The current link stops working.')) {
                    void run(() => window.wapp.applyGroupAction(chatId, { type: 'revokeInvite' }), 'The invite link was reset.');
                  }
                }}
              >
                Reset invite link
              </button>
            )}
          </div>
          {!admin && <p className="muted small">Only group admins can change most settings.</p>}

          <div className="members-header">
            <h4>{info.participants.length} members</h4>
            {(admin || !info.adminsAddMembers) && (
              <button className="button small" onClick={() => setAdding(true)}>
                <UserPlusIcon size={14} />
                Add
              </button>
            )}
            {memberActions && (
              <button className="icon-button tiny" title="More" onClick={(e) => openUnder(e.currentTarget, memberActions(info))}>
                <MoreIcon size={16} />
              </button>
            )}
          </div>
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
                {!p.isMe && (
                  <button className="icon-button tiny member-more" title="Member options" onClick={(e) => memberMenu(p, e.currentTarget)}>
                    <MoreIcon size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            className="button danger leave-group"
            onClick={() => {
              if (!window.confirm(`Leave ${info.subject}?`)) return;
              void window.wapp
                .leaveGroup(chatId)
                .then(onClose)
                .catch((err) => setError(errorMessage(err)));
            }}
          >
            Leave group
          </button>
        </div>
      )}
      {menu && <Menu {...menu} onClose={close} />}
      {editing && info && (
        <EditInfoDialog
          what={editing}
          initial={editing === 'subject' ? info.subject : (info.description ?? '')}
          onClose={() => setEditing(null)}
          onSave={(text) =>
            run(() => window.wapp.applyGroupAction(chatId, editing === 'subject' ? { type: 'subject', text } : { type: 'description', text }))
          }
        />
      )}
      {adding && info && (
        <AddMembersDialog
          existing={info.participants.map((p) => p.id)}
          onClose={() => setAdding(false)}
          onAdd={async (ids) => {
            const problems = await window.wapp.updateMembers(chatId, ids, 'add');
            await load();
            if (problems.length) {
              const names = (id: string) => info.participants.find((p) => p.id === id)?.name ?? `+${id.split('@')[0]}`;
              setError(problems.map((p) => `${names(p.id)}: ${p.problem}`).join('\n'));
            } else {
              setNotice(ids.length === 1 ? 'Added 1 member.' : `Added ${ids.length} members.`);
            }
          }}
        />
      )}
    </aside>
  );
}

function EditInfoDialog({
  what,
  initial,
  onClose,
  onSave,
}: {
  what: 'subject' | 'description';
  initial: string;
  onClose: () => void;
  onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(initial);
  const subject = what === 'subject';
  return (
    <Modal
      title={subject ? 'Group name' : 'Group description'}
      narrow
      onClose={onClose}
      footer={
        <>
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={(subject && !text.trim()) || text === initial}
            onClick={() => {
              onClose();
              void onSave(text.trim());
            }}
          >
            Save
          </button>
        </>
      }
    >
      {subject ? (
        <input autoFocus value={text} maxLength={100} onChange={(e) => setText(e.target.value)} />
      ) : (
        <textarea className="edit-text" autoFocus rows={5} maxLength={2048} value={text} onChange={(e) => setText(e.target.value)} />
      )}
      <p className="hint">Everyone in the group will see the change.</p>
    </Modal>
  );
}

function AddMembersDialog({
  existing,
  onClose,
  onAdd,
}: {
  existing: string[];
  onClose: () => void;
  onAdd: (ids: string[]) => Promise<void>;
}) {
  const [contacts, setContacts] = useState<ContactInfo[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void window.wapp.listContacts().then((list) => setContacts(list.filter((c) => !existing.includes(c.id))));
  }, [existing]);
  return (
    <Modal
      title="Add members"
      onClose={onClose}
      footer={
        <>
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || selected.length === 0}
            onClick={() => {
              setBusy(true);
              void onAdd(selected).finally(onClose);
            }}
          >
            {busy ? 'Adding…' : selected.length > 1 ? `Add ${selected.length} people` : 'Add'}
          </button>
        </>
      }
    >
      <ChatPicker
        entries={contacts.map((c) => ({ id: c.id, name: c.name, detail: c.phone }))}
        selected={selected}
        max={50}
        placeholder="Search contacts"
        emptyText="No contacts to add."
        onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
      />
    </Modal>
  );
}
