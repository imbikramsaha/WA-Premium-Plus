import { useState } from 'react';
import { errorMessage, formatDateTime, fromLocalInputValue, toLocalInputValue } from '../format';
import { Modal } from './Menu';

const HOUR = 3_600_000;

function at(daysFromToday: number, hour: number): number {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

export function ReminderDialog({
  chatId,
  chatName,
  messageId,
  onClose,
}: {
  chatId: string;
  chatName: string;
  messageId?: string;
  onClose: () => void;
}) {
  const presets = [
    { label: 'In 1 hour', at: () => Date.now() + HOUR },
    { label: 'Tomorrow, 9:00', at: () => at(1, 9) },
    { label: 'In 2 days', at: () => at(2, 9) },
    { label: 'In a week', at: () => at(7, 9) },
  ];
  const [when, setWhen] = useState(() => toLocalInputValue(at(1, 9)));
  const [note, setNote] = useState('');
  const [onlyIfNoReply, setOnlyIfNoReply] = useState(true);
  const [sendFollowUp, setSendFollowUp] = useState(false);
  const [followUp, setFollowUp] = useState('Hi {first_name}, just following up on my last message.');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dueAt = fromLocalInputValue(when);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await window.wapp.createReminder({
        chatId,
        messageId,
        note,
        dueAt,
        onlyIfNoReply,
        followUp: sendFollowUp ? followUp : undefined,
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Follow up with ${chatName}`}
      narrow
      onClose={onClose}
      footer={
        <>
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || Number.isNaN(dueAt)} onClick={() => void save()}>
            Set reminder
          </button>
        </>
      }
    >
      <div className="field">
        <span className="field-label">When</span>
        <div className="presets">
          {presets.map((p) => (
            <button key={p.label} type="button" className="chip" onClick={() => setWhen(toLocalInputValue(p.at()))}>
              {p.label}
            </button>
          ))}
        </div>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        {!Number.isNaN(dueAt) && <span className="hint">{formatDateTime(dueAt)}</span>}
      </div>
      <label className="field">
        <span className="field-label">Note for yourself (optional)</span>
        <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Send the invoice, ask about the order…" />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={onlyIfNoReply} onChange={(e) => setOnlyIfNoReply(e.target.checked)} />
        Only if they haven't replied by then
      </label>
      <label className="check-row">
        <input type="checkbox" checked={sendFollowUp} onChange={(e) => setSendFollowUp(e.target.checked)} />
        Send them a follow-up message automatically
      </label>
      {sendFollowUp && (
        <>
          <textarea rows={3} value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          <span className="hint">Use {'{first_name}'} or {'{name}'} for their name.</span>
        </>
      )}
      {!sendFollowUp && <p className="hint">You'll get a notification on this computer.</p>}
      {error && <p className="error small">{error}</p>}
    </Modal>
  );
}
