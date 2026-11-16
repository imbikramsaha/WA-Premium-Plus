// Dialogs for forwarding messages and sending polls, locations and contact cards.

import { useEffect, useState, type FormEvent } from 'react';
import type { ChatSummary, ContactInfo } from '../../../shared/types';
import { errorMessage } from '../format';
import { ChatPicker } from './ChatPicker';
import { Modal } from './Menu';
import { CloseIcon, PlusIcon } from './Icons';

function useSubmit(action: () => Promise<void>, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    busy,
    error,
    setError,
    submit: async (e?: FormEvent) => {
      e?.preventDefault();
      setBusy(true);
      setError(null);
      try {
        await action();
        onDone();
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
  };
}

export function ForwardDialog({
  chats,
  chatId,
  messageId,
  onClose,
}: {
  chats: ChatSummary[];
  chatId: string;
  messageId: string;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const { busy, error, submit } = useSubmit(() => window.wapp.forward(chatId, messageId, selected), onClose);
  const entries = chats.filter((c) => !c.id.endsWith('@newsletter')).map((c) => ({ id: c.id, name: c.name }));
  return (
    <Modal
      title="Forward to…"
      onClose={onClose}
      footer={
        <>
          <span className="muted small footer-note">{selected.length}/5 chats</span>
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || selected.length === 0} onClick={() => void submit()}>
            {busy ? 'Forwarding…' : 'Forward'}
          </button>
        </>
      }
    >
      <ChatPicker
        entries={entries}
        selected={selected}
        max={5}
        placeholder="Search chats"
        emptyText="No chats found."
        onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
      />
      {error && <p className="error small">{error}</p>}
    </Modal>
  );
}

export function PollDialog({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const { busy, error, submit } = useSubmit(
    () =>
      window.wapp.sendRich(chatId, {
        type: 'poll',
        question,
        options: options.map((o) => o.trim()).filter(Boolean),
        multiple,
      }),
    onClose,
  );
  const filled = options.filter((o) => o.trim()).length;
  return (
    <Modal
      title="Create a poll"
      narrow
      onClose={onClose}
      footer={
        <>
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || !question.trim() || filled < 2} onClick={() => void submit()}>
            {busy ? 'Sending…' : 'Send poll'}
          </button>
        </>
      }
    >
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span className="field-label">Question</span>
          <input autoFocus value={question} maxLength={255} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question" />
        </label>
        <div className="field">
          <span className="field-label">Options</span>
          {options.map((option, i) => (
            <div key={i} className="option-row">
              <input
                value={option}
                maxLength={100}
                placeholder={`Option ${i + 1}`}
                onChange={(e) => setOptions((list) => list.map((o, j) => (j === i ? e.target.value : o)))}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  className="icon-button tiny"
                  title="Remove option"
                  onClick={() => setOptions((list) => list.filter((_, j) => j !== i))}
                >
                  <CloseIcon size={14} />
                </button>
              )}
            </div>
          ))}
          {options.length < 12 && (
            <button type="button" className="button link" onClick={() => setOptions((list) => [...list, ''])}>
              <PlusIcon size={14} /> Add option
            </button>
          )}
        </div>
        <label className="check-row">
          <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />
          Allow more than one answer
        </label>
      </form>
      {error && <p className="error small">{error}</p>}
    </Modal>
  );
}

/** Reads coordinates from "22.57, 88.36" or a Google Maps / OpenStreetMap link. */
export function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const patterns = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, // google.com/maps/@22.5,88.3,15z
    /[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, // ?q=22.5,88.3
    /mlat=(-?\d+(?:\.\d+)?)&mlon=(-?\d+(?:\.\d+)?)/, // openstreetmap
    /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/, // plain "lat, lng"
  ];
  for (const pattern of patterns) {
    const m = pattern.exec(text);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}

export function LocationDialog({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const [where, setWhere] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const coords = parseCoordinates(where);
  const { busy, error, submit } = useSubmit(async () => {
    if (!coords) throw new Error('Paste a map link or type coordinates like 22.5726, 88.3639.');
    await window.wapp.sendRich(chatId, { type: 'location', ...coords, name, address });
  }, onClose);
  return (
    <Modal
      title="Share a location"
      narrow
      onClose={onClose}
      footer={
        <>
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || !coords} onClick={() => void submit()}>
            {busy ? 'Sending…' : 'Send location'}
          </button>
        </>
      }
    >
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span className="field-label">Map link or coordinates</span>
          <input
            autoFocus
            value={where}
            onChange={(e) => setWhere(e.target.value)}
            placeholder="https://maps.google.com/… or 22.5726, 88.3639"
          />
          <span className="hint">
            {coords
              ? `Latitude ${coords.lat}, longitude ${coords.lng}`
              : 'In Google Maps, right-click a place to copy its coordinates, or copy the link.'}
          </span>
        </label>
        <label className="field">
          <span className="field-label">Place name (optional)</span>
          <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder="Victoria Memorial" />
        </label>
        <label className="field">
          <span className="field-label">Address (optional)</span>
          <input value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} placeholder="Queen's Way, Kolkata" />
        </label>
      </form>
      {error && <p className="error small">{error}</p>}
    </Modal>
  );
}

export function ContactCardDialog({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const [contacts, setContacts] = useState<ContactInfo[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    void window.wapp.listContacts().then(setContacts);
  }, []);
  const { busy, error, submit } = useSubmit(
    () =>
      window.wapp.sendRich(chatId, {
        type: 'contacts',
        contacts: selected.map((id) => {
          const c = contacts.find((x) => x.id === id)!;
          return { name: c.name, phones: [{ number: c.phone ?? `+${id.split('@')[0]}`, jid: id }] };
        }),
      }),
    onClose,
  );
  return (
    <Modal
      title="Share contacts"
      onClose={onClose}
      footer={
        <>
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || selected.length === 0} onClick={() => void submit()}>
            {busy ? 'Sending…' : selected.length > 1 ? `Send ${selected.length} contacts` : 'Send contact'}
          </button>
        </>
      }
    >
      <ChatPicker
        entries={contacts.map((c) => ({ id: c.id, name: c.name, detail: c.phone }))}
        selected={selected}
        max={20}
        placeholder="Search contacts"
        emptyText="No contacts found."
        onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
      />
      {error && <p className="error small">{error}</p>}
    </Modal>
  );
}

export function NewChatDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (chatId: string) => void }) {
  const [contacts, setContacts] = useState<ContactInfo[]>([]);
  const [phone, setPhone] = useState('');
  useEffect(() => {
    void window.wapp.listContacts().then(setContacts);
  }, []);
  const { busy, error, submit } = useSubmit(async () => {
    onOpen(await window.wapp.startChat(phone));
  }, onClose);
  return (
    <Modal title="New chat" onClose={onClose}>
      <form className="inline-form" onSubmit={(e) => void submit(e)}>
        <input
          autoFocus
          value={phone}
          inputMode="tel"
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone number with country code, e.g. +91 98765 43210"
        />
        <button className="button primary" disabled={busy || phone.replace(/\D/g, '').length < 7}>
          {busy ? 'Checking…' : 'Chat'}
        </button>
      </form>
      {error && <p className="error small">{error}</p>}
      <h4 className="section-label">Or pick a contact</h4>
      <ChatPicker
        single
        entries={contacts.map((c) => ({ id: c.id, name: c.name, detail: c.phone }))}
        selected={[]}
        placeholder="Search contacts"
        emptyText="No contacts found."
        onToggle={(id) => {
          onOpen(id);
          onClose();
        }}
      />
    </Modal>
  );
}

export function NewGroupDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (chatId: string) => void }) {
  const [contacts, setContacts] = useState<ContactInfo[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('');
  useEffect(() => {
    void window.wapp.listContacts().then(setContacts);
  }, []);
  const { busy, error, submit } = useSubmit(async () => {
    onOpen(await window.wapp.createGroup(name, selected));
  }, onClose);
  return (
    <Modal
      title="New group"
      onClose={onClose}
      footer={
        <>
          <span className="muted small footer-note">{selected.length} members</span>
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || !name.trim() || selected.length === 0} onClick={() => void submit()}>
            {busy ? 'Creating…' : 'Create group'}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Group name</span>
        <input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Family, Team, Book club…" />
      </label>
      <span className="field-label">Members</span>
      <ChatPicker
        entries={contacts.map((c) => ({ id: c.id, name: c.name, detail: c.phone }))}
        selected={selected}
        max={256}
        placeholder="Search contacts"
        emptyText="No contacts found."
        onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
      />
      {error && <p className="error small">{error}</p>}
    </Modal>
  );
}

export function FollowChannelDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (chatId: string) => void }) {
  const [link, setLink] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    onOpen(await window.wapp.followChannel(link));
  }, onClose);
  return (
    <Modal title="Follow a channel" narrow onClose={onClose}>
      <p className="muted">Paste the channel's link. You'll find it under the channel's name → Share on your phone.</p>
      <form className="inline-form" onSubmit={(e) => void submit(e)}>
        <input autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://whatsapp.com/channel/…" />
        <button className="button primary" disabled={busy || !link.trim()}>
          {busy ? 'Following…' : 'Follow'}
        </button>
      </form>
      {error && <p className="error small">{error}</p>}
    </Modal>
  );
}
