import { useEffect, useRef, useState } from 'react';
import { templateVariables } from '../../../shared/template';
import type { Campaign, CampaignInput, CampaignRecipient, ChatSummary, ContactList, CsvPreview, ListMember, OptOut } from '../../../shared/types';
import { errorMessage, formatDateTime, formatRelative, fromLocalInputValue, toLocalInputValue } from '../format';
import { ChatPicker } from './ChatPicker';
import { FileIcon, MegaphoneIcon, PaperclipIcon, PlusIcon, TrashIcon, UsersIcon } from './Icons';
import { Menu, Modal, useMenu } from './Menu';

type Tab = 'campaigns' | 'lists' | 'optouts';

function useLoad<T>(load: () => Promise<T>, initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const reload = () => void load().then(setValue);
    reload();
    const off = window.wapp.onEvent((e) => e.type === 'broadcasts-changed' && reload());
    // Progress and "next message" times change while a broadcast runs.
    const tick = window.setInterval(reload, 15_000);
    return () => {
      off();
      window.clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

async function attempt(action: () => Promise<unknown>, setError?: (e: string | null) => void): Promise<boolean> {
  try {
    setError?.(null);
    await action();
    return true;
  } catch (err) {
    if (setError) setError(errorMessage(err));
    else window.alert(errorMessage(err));
    return false;
  }
}

const STATUS_LABELS: Record<Campaign['status'], string> = {
  draft: 'Draft',
  running: 'Sending',
  paused: 'Paused',
  done: 'Finished',
  cancelled: 'Cancelled',
};

// --- Campaigns ---

const DEFAULTS: CampaignInput = {
  name: '',
  listId: 0,
  body: '{Hi|Hello} {first_name}, ',
  dailyCap: 100,
  minDelay: 30,
  maxDelay: 90,
  optOutFooter: true,
  sendFrom: '09:00',
  sendUntil: '20:00',
};

function CampaignDialog({
  id,
  initial,
  lists,
  existingAttachment,
  onClose,
}: {
  id?: number;
  initial: CampaignInput;
  lists: ContactList[];
  existingAttachment?: string;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<CampaignInput>(initial);
  const [later, setLater] = useState(Boolean(initial.startAt));
  const [startAt, setStartAt] = useState(() => toLocalInputValue(initial.startAt ?? Date.now() + 3_600_000));
  const [attachmentName, setAttachmentName] = useState(existingAttachment);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const list = lists.find((l) => l.id === draft.listId);
  const used = templateVariables(draft.body);
  const known = ['name', 'first_name', 'phone', ...(list?.columns ?? []).map((c) => c.trim().toLowerCase().replace(/\s+/g, '_'))];
  const unknown = used.filter((v) => !known.includes(v));
  const set = (patch: Partial<CampaignInput>) => setDraft({ ...draft, ...patch });
  const days = list ? Math.ceil(list.count / Math.max(1, draft.dailyCap)) : 0;

  async function save(start: boolean) {
    const input = { ...draft, startAt: later ? fromLocalInputValue(startAt) : undefined };
    const ok = await attempt(async () => {
      const saved = await window.wapp.saveCampaign(id, input);
      if (start) await window.wapp.startCampaign(saved);
    }, setError);
    if (ok) onClose();
  }

  return (
    <Modal
      title={id ? 'Edit broadcast' : 'New broadcast'}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button" onClick={() => void save(false)}>
            Save as draft
          </button>
          <button className="button primary" disabled={!list} onClick={() => void save(true)}>
            {later ? 'Schedule' : 'Start sending'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Name</span>
          <input autoFocus value={draft.name} maxLength={200} placeholder="November offer" onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Send to</span>
          <select value={draft.listId} onChange={(e) => set({ listId: Number(e.target.value) })}>
            <option value={0} disabled>
              Choose a contact list…
            </option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.count})
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span className="field-label">Message</span>
        <textarea rows={5} value={draft.body} onChange={(e) => set({ body: e.target.value })} />
        <span className="hint">
          Fill in: {known.map((k) => `{${k}}`).join(' ')}. Write {'{Hi|Hello|Hey}'} to vary the wording, so messages aren't all identical.
          {unknown.length > 0 && <strong className="warn"> Not in this list: {unknown.map((u) => `{${u}}`).join(' ')}</strong>}
        </span>
      </label>
      <div className="field">
        <span className="field-label">Attachment</span>
        {attachmentName && draft.attachmentPath !== null ? (
          <div className="picked-file">
            <FileIcon size={18} />
            <span>{attachmentName}</span>
            <button
              type="button"
              className="button link"
              onClick={() => {
                set({ attachmentPath: null });
                setAttachmentName(undefined);
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <button type="button" className="button attach-button" onClick={() => file.current?.click()}>
            <PaperclipIcon size={16} /> Attach a photo, video or document
          </button>
        )}
        <input
          ref={file}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              set({ attachmentPath: window.wapp.getPathForFile(f) });
              setAttachmentName(f.name);
            }
            e.target.value = '';
          }}
        />
      </div>

      <h4 className="section-label">Safety</h4>
      <div className="form-grid three">
        <label className="field">
          <span className="field-label">Most per day</span>
          <input type="number" min={1} max={1000} value={draft.dailyCap} onChange={(e) => set({ dailyCap: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span className="field-label">Pause between (seconds)</span>
          <span className="when-row">
            <input type="number" min={10} value={draft.minDelay} onChange={(e) => set({ minDelay: Number(e.target.value) })} />
            <span className="muted">to</span>
            <input type="number" min={10} value={draft.maxDelay} onChange={(e) => set({ maxDelay: Number(e.target.value) })} />
          </span>
        </label>
        <label className="field">
          <span className="field-label">Only send between</span>
          <span className="when-row">
            <input type="time" value={draft.sendFrom} onChange={(e) => set({ sendFrom: e.target.value })} />
            <span className="muted">and</span>
            <input type="time" value={draft.sendUntil} onChange={(e) => set({ sendUntil: e.target.value })} />
          </span>
        </label>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={draft.optOutFooter} onChange={(e) => set({ optOutFooter: e.target.checked })} />
        Add “Reply STOP to stop these messages.” (people who reply STOP are skipped from then on)
      </label>
      <label className="check-row">
        <input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} />
        Start later
        {later && <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />}
      </label>
      <p className="notice-box">
        Each number is checked on WhatsApp first, and opted-out people are skipped. Sending many messages to people who haven't
        messaged you can get your number banned by WhatsApp: only message people who expect to hear from you.
        {list ? ` This list takes about ${days} day${days === 1 ? '' : 's'} at ${draft.dailyCap} a day.` : ''}
      </p>
      {error && <p className="error small">{error}</p>}
    </Modal>
  );
}

function RecipientsDialog({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([]);
  useEffect(() => void window.wapp.listCampaignRecipients(campaign.id).then(setRecipients), [campaign.id]);
  const LABEL = { pending: 'Waiting', sent: 'Sent', failed: 'Failed', skipped: 'Skipped' };
  return (
    <Modal title={campaign.name} wide onClose={onClose}>
      {recipients.length === 0 ? (
        <p className="muted">The recipients are listed once the broadcast starts.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Number</th>
                <th>Status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.jid}>
                  <td>{r.name ?? ''}</td>
                  <td className="mono">+{r.jid.split('@')[0]}</td>
                  <td>
                    <span className={`status status-${r.status === 'sent' ? 'sent' : r.status === 'pending' ? 'pending' : 'missed'}`}>{LABEL[r.status]}</span>
                  </td>
                  <td className="muted small">{r.sentAt ? formatDateTime(r.sentAt) : (r.error ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function CampaignsTab({ lists, connected }: { lists: ContactList[]; connected: boolean }) {
  const campaigns = useLoad(() => window.wapp.listCampaigns(), [] as Campaign[]);
  const sentToday = useLoad(() => window.wapp.broadcastsSentToday(), 0);
  const [editing, setEditing] = useState<{ id?: number; input: CampaignInput; attachment?: string } | null>(null);
  const [viewing, setViewing] = useState<Campaign | null>(null);

  return (
    <>
      <div className="section-head">
        <p className="muted">
          Personalised messages to a contact list, sent one at a time from this computer. Sent today: <strong>{sentToday}</strong>.
          {!connected && ' Broadcasts continue once WhatsApp is connected.'}
        </p>
        <button
          className="button primary"
          disabled={lists.length === 0}
          title={lists.length === 0 ? 'Make a contact list first' : undefined}
          onClick={() => setEditing({ input: { ...DEFAULTS, listId: lists[0]?.id ?? 0 } })}
        >
          <PlusIcon size={16} /> New broadcast
        </button>
      </div>
      {campaigns.length === 0 ? (
        <div className="empty-inline">
          <MegaphoneIcon size={28} />
          <p>{lists.length === 0 ? 'Start by making a contact list (import a CSV, or pick chats).' : 'No broadcasts yet.'}</p>
        </div>
      ) : (
        <ul className="card-list">
          {campaigns.map((c) => {
            const done = c.counts.sent + c.counts.failed + c.counts.skipped;
            const progress = c.counts.total ? (done / c.counts.total) * 100 : 0;
            return (
              <li key={c.id} className="card-row campaign">
                <div className="card-main">
                  <div className="scheduled-top">
                    <strong>{c.name}</strong>
                    <span className={`status status-${c.status === 'running' ? 'pending' : c.status === 'done' ? 'sent' : c.status === 'cancelled' ? 'cancelled' : 'missed'}`}>
                      {STATUS_LABELS[c.status]}
                    </span>
                  </div>
                  <span className="muted small">
                    To {c.listName} · {c.counts.total} people · {c.dailyCap}/day · {c.minDelay}–{c.maxDelay}s apart · {c.sendFrom}–{c.sendUntil}
                  </span>
                  <span className="clamp small">{c.body}</span>
                  {c.status !== 'draft' && (
                    <>
                      <div className="progress">
                        <span style={{ width: `${progress}%` }} />
                      </div>
                      <span className="muted small">
                        {c.counts.sent} sent · {c.counts.failed} failed · {c.counts.skipped} skipped · {c.counts.pending} waiting
                        {c.status === 'running' && c.nextAt ? ` · next ${formatRelative(c.nextAt)}` : ''}
                        {c.lastError && c.status === 'running' ? ` · ${c.lastError}` : ''}
                      </span>
                    </>
                  )}
                </div>
                <div className="row-buttons">
                  {(c.status === 'draft' || c.status === 'paused') && (
                    <button className="button primary small" onClick={() => void attempt(() => window.wapp.startCampaign(c.id))}>
                      {c.status === 'draft' ? 'Start' : 'Resume'}
                    </button>
                  )}
                  {c.status === 'running' && (
                    <button className="button small" onClick={() => void attempt(() => window.wapp.pauseCampaign(c.id))}>
                      Pause
                    </button>
                  )}
                  {(c.status === 'draft' || c.status === 'paused') && (
                    <button
                      className="button small"
                      onClick={() =>
                        setEditing({
                          id: c.id,
                          attachment: c.attachment?.name,
                          input: {
                            name: c.name,
                            listId: c.listId,
                            body: c.body,
                            startAt: c.startAt,
                            dailyCap: c.dailyCap,
                            minDelay: c.minDelay,
                            maxDelay: c.maxDelay,
                            optOutFooter: c.optOutFooter,
                            sendFrom: c.sendFrom,
                            sendUntil: c.sendUntil,
                          },
                        })
                      }
                    >
                      Edit
                    </button>
                  )}
                  {c.status !== 'draft' && (
                    <button className="button small" onClick={() => setViewing(c)}>
                      Details
                    </button>
                  )}
                  {(c.status === 'running' || c.status === 'paused') && (
                    <button
                      className="button small"
                      onClick={() => window.confirm(`Stop "${c.name}" for good?`) && void attempt(() => window.wapp.cancelCampaign(c.id))}
                    >
                      Stop
                    </button>
                  )}
                  {c.status !== 'running' && (
                    <button
                      className="icon-button tiny"
                      title="Delete"
                      onClick={() => window.confirm(`Delete "${c.name}"?`) && void attempt(() => window.wapp.deleteCampaign(c.id))}
                    >
                      <TrashIcon size={15} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <CampaignDialog id={editing.id} initial={editing.input} lists={lists} existingAttachment={editing.attachment} onClose={() => setEditing(null)} />
      )}
      {viewing && <RecipientsDialog campaign={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

// --- Contact lists ---

function ImportDialog({ preview, fileName, onClose }: { preview: CsvPreview; fileName: string; onClose: () => void }) {
  const [name, setName] = useState(fileName.replace(/\.[^.]+$/, ''));
  const [phoneColumn, setPhoneColumn] = useState(preview.phoneColumn);
  const [nameColumn, setNameColumn] = useState(preview.nameColumn);
  const [countryCode, setCountryCode] = useState('91');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const ok = await attempt(async () => {
      const result = await window.wapp.createContactList({
        name,
        csv: { columns: preview.columns, phoneColumn, nameColumn, rows: preview.rows, defaultCountryCode: countryCode },
      });
      window.alert(`Added ${result.added} contacts${result.skipped ? `. Skipped ${result.skipped} (invalid or repeated numbers)` : ''}.`);
    }, setError);
    if (ok) onClose();
  }

  return (
    <Modal
      title="Import contacts"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="muted small footer-note">{preview.rows.length} rows</span>
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={!name.trim()} onClick={() => void save()}>
            Import
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span className="field-label">List name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Country code for numbers without one</span>
          <span className="when-row">
            <span className="muted">+</span>
            <input value={countryCode} maxLength={4} inputMode="numeric" onChange={(e) => setCountryCode(e.target.value.replace(/\D/g, ''))} />
          </span>
        </label>
        <label className="field">
          <span className="field-label">Phone number column</span>
          <select value={phoneColumn} onChange={(e) => setPhoneColumn(Number(e.target.value))}>
            {preview.columns.map((c, i) => (
              <option key={i} value={i}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Name column</span>
          <select value={nameColumn} onChange={(e) => setNameColumn(Number(e.target.value))}>
            <option value={-1}>(none)</option>
            {preview.columns.map((c, i) => (
              <option key={i} value={i}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="hint">Other columns can be used in messages, like {preview.columns.filter((_, i) => i !== phoneColumn && i !== nameColumn).slice(0, 3).map((c) => `{${c.toLowerCase().replace(/\s+/g, '_')}}`).join(' ') || '{city}'}.</p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {preview.columns.map((c, i) => (
                <th key={i} className={i === phoneColumn ? 'picked' : i === nameColumn ? 'picked-soft' : ''}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.slice(0, 8).map((row, r) => (
              <tr key={r}>
                {preview.columns.map((_, i) => (
                  <td key={i}>{row[i] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="error small">{error}</p>}
    </Modal>
  );
}

function MembersDialog({ list, onClose }: { list: ContactList; onClose: () => void }) {
  const [members, setMembers] = useState<ListMember[]>([]);
  const load = () => void window.wapp.listListMembers(list.id).then(setMembers);
  useEffect(load, [list.id]);
  return (
    <Modal title={`${list.name} · ${members.length}`} wide onClose={onClose}>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Number</th>
              {list.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.jid} className={m.optedOut ? 'muted' : ''}>
                <td>
                  {m.name ?? ''}
                  {m.optedOut && <span className="pill">opted out</span>}
                </td>
                <td className="mono">+{m.jid.split('@')[0]}</td>
                {list.columns.map((c) => (
                  <td key={c}>{m.fields[c] ?? ''}</td>
                ))}
                <td>
                  <button className="icon-button tiny" title="Remove from list" onClick={() => void attempt(() => window.wapp.removeListMember(list.id, m.jid)).then(load)}>
                    <TrashIcon size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function ListsTab({ lists, chats }: { lists: ContactList[]; chats: ChatSummary[] }) {
  const [preview, setPreview] = useState<{ data: CsvPreview; fileName: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [pickName, setPickName] = useState('');
  const [viewing, setViewing] = useState<ContactList | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const { menu, close, openUnder } = useMenu();

  return (
    <>
      <div className="section-head">
        <p className="muted">
          Import people from a CSV file (from Excel, Google Sheets or your CRM), pick them from your chats, or make one from a
          group's members (group info → ⋯).
        </p>
        <button
          className="button primary"
          onClick={(e) =>
            openUnder(e.currentTarget, [
              { label: 'Import a CSV file…', onClick: () => file.current?.click() },
              { label: 'Pick from chats…', onClick: () => setPicking(true) },
            ])
          }
        >
          <PlusIcon size={16} /> New list
        </button>
        <input
          ref={file}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            void window.wapp
              .readCsv(window.wapp.getPathForFile(f))
              .then((data) => setPreview({ data, fileName: f.name }))
              .catch((err) => window.alert(errorMessage(err)));
          }}
        />
      </div>
      {lists.length === 0 ? (
        <div className="empty-inline">
          <UsersIcon size={28} />
          <p>No contact lists yet.</p>
        </div>
      ) : (
        <ul className="card-list">
          {lists.map((l) => (
            <li key={l.id} className="card-row">
              <UsersIcon size={18} />
              <div className="card-main">
                <strong>{l.name}</strong>
                <span className="muted small">
                  {l.count} people{l.columns.length ? ` · columns: ${l.columns.join(', ')}` : ''} · made {formatDateTime(l.createdAt)}
                </span>
              </div>
              <button className="button small" onClick={() => setViewing(l)}>
                View
              </button>
              <button
                className="icon-button tiny"
                title="Delete list"
                onClick={() => window.confirm(`Delete the list "${l.name}"?`) && void attempt(() => window.wapp.deleteContactList(l.id))}
              >
                <TrashIcon size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {menu && <Menu {...menu} onClose={close} />}
      {preview && <ImportDialog preview={preview.data} fileName={preview.fileName} onClose={() => setPreview(null)} />}
      {viewing && <MembersDialog list={viewing} onClose={() => setViewing(null)} />}
      {picking && (
        <Modal
          title="New list from chats"
          onClose={() => setPicking(false)}
          footer={
            <>
              <span className="muted small footer-note">{picked.length} people</span>
              <button className="button" onClick={() => setPicking(false)}>
                Cancel
              </button>
              <button
                className="button primary"
                disabled={!pickName.trim() || picked.length === 0}
                onClick={() =>
                  void attempt(() =>
                    window.wapp.createContactList({
                      name: pickName,
                      members: picked.map((jid) => ({ jid, name: chats.find((c) => c.id === jid)?.name })),
                    }),
                  ).then((ok) => {
                    if (!ok) return;
                    setPicking(false);
                    setPicked([]);
                    setPickName('');
                  })
                }
              >
                Make list
              </button>
            </>
          }
        >
          <input value={pickName} placeholder="List name" onChange={(e) => setPickName(e.target.value)} />
          <ChatPicker
            entries={chats.filter((c) => c.id.endsWith('@s.whatsapp.net')).map((c) => ({ id: c.id, name: c.name }))}
            selected={picked}
            placeholder="Search people"
            onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
          />
        </Modal>
      )}
    </>
  );
}

// --- Opt-outs ---

function OptOutsTab() {
  const optOuts = useLoad(() => window.wapp.listOptOuts(), [] as OptOut[]);
  const [phone, setPhone] = useState('');
  return (
    <>
      <div className="section-head">
        <p className="muted">People here never get broadcasts. They're added when they reply with an opt-out word (see Automation → Rules).</p>
      </div>
      <form
        className="inline-form narrow-form"
        onSubmit={(e) => {
          e.preventDefault();
          const digits = phone.replace(/\D/g, '');
          if (digits.length < 8) return;
          void attempt(() => window.wapp.addOptOut(`${digits}@s.whatsapp.net`)).then((ok) => ok && setPhone(''));
        }}
      >
        <input value={phone} inputMode="tel" placeholder="Add a number, e.g. +91 98765 43210" onChange={(e) => setPhone(e.target.value)} />
        <button className="button">Add</button>
      </form>
      {optOuts.length === 0 ? (
        <div className="empty-inline">
          <p>Nobody has opted out.</p>
        </div>
      ) : (
        <ul className="card-list">
          {optOuts.map((o) => (
            <li key={o.jid} className="card-row">
              <div className="card-main">
                <strong>{o.name}</strong>
                <span className="muted small">
                  {formatDateTime(o.at)} · {o.source}
                </span>
              </div>
              <button className="button small" onClick={() => void attempt(() => window.wapp.removeOptOut(o.jid))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function BroadcastsView({ chats, connected }: { chats: ChatSummary[]; connected: boolean }) {
  const [tab, setTab] = useState<Tab>('campaigns');
  const lists = useLoad(() => window.wapp.listContactLists(), [] as ContactList[]);
  return (
    <div className="scheduled">
      <header className="content-header">
        <div>
          <h2>Broadcasts</h2>
          <p className="muted">Personalised messages to many people, with safety limits.</p>
        </div>
      </header>
      <div className="tabs">
        <button className={tab === 'campaigns' ? 'active' : ''} onClick={() => setTab('campaigns')}>
          Broadcasts
        </button>
        <button className={tab === 'lists' ? 'active' : ''} onClick={() => setTab('lists')}>
          Contact lists
        </button>
        <button className={tab === 'optouts' ? 'active' : ''} onClick={() => setTab('optouts')}>
          Opt-outs
        </button>
      </div>
      <div className="scheduled-body">
        {tab === 'campaigns' && <CampaignsTab lists={lists} connected={connected} />}
        {tab === 'lists' && <ListsTab lists={lists} chats={chats} />}
        {tab === 'optouts' && <OptOutsTab />}
      </div>
    </div>
  );
}
