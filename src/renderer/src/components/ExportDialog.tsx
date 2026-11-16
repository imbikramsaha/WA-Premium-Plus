import { useState } from 'react';
import type { ExportFormat } from '../../../shared/types';
import { errorMessage } from '../format';
import { Modal } from './Menu';

const FORMATS: Array<[ExportFormat, string, string]> = [
  ['txt', 'Text', 'Like WhatsApp’s own export. Opens anywhere.'],
  ['html', 'Web page', 'Looks like the chat, with photos when media is included.'],
  ['csv', 'CSV', 'One row per message, for Excel or Google Sheets.'],
  ['json', 'JSON', 'Everything, for developers and other apps.'],
];

/** Export one chat (chatId set) or every chat. */
export function ExportDialog({ chatId, chatName, onClose }: { chatId?: string; chatName?: string; onClose: () => void }) {
  const [format, setFormat] = useState<ExportFormat>('txt');
  const [includeMedia, setIncludeMedia] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const path = chatId ? await window.wapp.exportChat(chatId, format, includeMedia) : await window.wapp.exportAllChats(format, includeMedia);
      if (path) onClose();
      else setBusy(false);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={chatName ? `Export ${chatName}` : 'Export all chats'}
      narrow
      onClose={onClose}
      footer={
        <>
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy} onClick={() => void run()}>
            {busy ? 'Exporting…' : 'Export…'}
          </button>
        </>
      }
    >
      <div className="choice-list">
        {FORMATS.map(([value, label, hint]) => (
          <label key={value} className={`choice${format === value ? ' active' : ''}`}>
            <input type="radio" name="format" checked={format === value} onChange={() => setFormat(value)} />
            <span>
              <strong>{label}</strong>
              <small>{hint}</small>
            </span>
          </label>
        ))}
      </div>
      <label className="check-row">
        <input type="checkbox" checked={includeMedia} onChange={(e) => setIncludeMedia(e.target.checked)} />
        Include photos, videos and files (those already downloaded to this computer)
      </label>
      {!chatId && <p className="hint">Each chat is saved as its own file, in a new folder.</p>}
      {error && <p className="error small">{error}</p>}
    </Modal>
  );
}
