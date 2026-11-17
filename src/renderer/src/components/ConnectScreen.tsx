import { useEffect, useState, type FormEvent } from 'react';
import type { AccountSummary, ConnectionState } from '../../../shared/types';
import { errorMessage } from '../format';
import { Logo } from './Logo';

export function ConnectScreen({ state }: { state: ConnectionState }) {
  const [mode, setMode] = useState<'qr' | 'phone'>('qr');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);

  useEffect(() => {
    void window.wapp.listAccounts().then(setAccounts);
    return window.wapp.onEvent((e) => {
      if (e.type !== 'pairing-code') return;
      if (e.code) {
        setCode(e.code);
        setError(null);
      } else {
        // The connection that issued the code closed before the code was used.
        setCode(null);
        setError('That code expired before it was used. Get a new code and type it on your phone within a few minutes.');
      }
    });
  }, []);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCode(await window.wapp.requestPairingCode(phone));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const ready = state.status === 'qr';
  const others = accounts.filter((a) => !a.active);

  return (
    <main className="center-screen">
      <div className="card connect-card">
        <div className="connect-text">
          <Logo size={48} />
          <h1>Link WA Premium Plus to WhatsApp</h1>
          {mode === 'qr' ? (
            <ol className="steps">
              <li>Open WhatsApp on your phone.</li>
              <li>
                Tap <strong>Linked devices</strong>, then <strong>Link a device</strong>.
              </li>
              <li>Point your phone at the QR code.</li>
            </ol>
          ) : (
            <ol className="steps">
              <li>Enter your WhatsApp number here and get a code.</li>
              <li>
                On your phone, open <strong>Linked devices</strong> → <strong>Link a device</strong> →{' '}
                <strong>Link with phone number instead</strong>.
              </li>
              <li>Type the code shown here.</li>
            </ol>
          )}
          <button className="button link" onClick={() => setMode(mode === 'qr' ? 'phone' : 'qr')}>
            {mode === 'qr' ? 'Link with phone number instead' : 'Scan a QR code instead'}
          </button>
          <p className="fine-print">
            WA Premium Plus is a free, open-source app and is not affiliated with WhatsApp. Your chats are stored only on
            this computer.
          </p>
          {others.length > 0 && (
            <p className="fine-print">
              <button className="button link" onClick={() => void window.wapp.switchAccount(others[0]!.id)}>
                Back to {others[0]!.name}
              </button>
              {' · '}
              <button
                className="button link"
                onClick={() => {
                  const me = accounts.find((a) => a.active);
                  if (me) void window.wapp.removeAccount(me.id).catch((err) => setError(errorMessage(err)));
                }}
              >
                Cancel adding this account
              </button>
            </p>
          )}
        </div>
        <div className="qr">
          {mode === 'phone' ? (
            code ? (
              <div className="pairing">
                <span className="muted">Your code</span>
                <strong className="pairing-code">{code}</strong>
                <span className="muted small">
                  On your phone, tap the WhatsApp notification (or Linked devices → Link a device → Link with phone number
                  instead) and type this code. It works for a few minutes.
                </span>
                <button className="button small" onClick={() => setCode(null)}>
                  Use another number
                </button>
              </div>
            ) : (
              <form className="pairing" onSubmit={(e) => void requestCode(e)}>
                <label className="field">
                  <span className="field-label">Your WhatsApp number</span>
                  <input
                    autoFocus
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                  />
                  <span className="hint">Include the country code.</span>
                </label>
                <button className="button primary" disabled={busy || !ready || phone.replace(/\D/g, '').length < 7}>
                  {busy ? 'Getting a code…' : ready ? 'Get code' : 'Connecting…'}
                </button>
                <span className="hint">Use the number of the phone you'll type the code on.</span>
                {error && <p className="error small">{error}</p>}
              </form>
            )
          ) : ready && state.qr ? (
            <img src={state.qr} alt="QR code to link WhatsApp" />
          ) : (
            <div className="qr-loading">
              <div className="spinner" />
              <span>Connecting…</span>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
