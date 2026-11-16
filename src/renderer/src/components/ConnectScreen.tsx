import type { ConnectionState } from '../../../shared/types';
import { Logo } from './Logo';

export function ConnectScreen({ state }: { state: ConnectionState }) {
  return (
    <main className="center-screen">
      <div className="card connect-card">
        <div className="connect-text">
          <Logo size={48} />
          <h1>Link WA Premium Plus to WhatsApp</h1>
          <ol className="steps">
            <li>Open WhatsApp on your phone.</li>
            <li>
              Tap <strong>Linked devices</strong>, then <strong>Link a device</strong>.
            </li>
            <li>Point your phone at the QR code.</li>
          </ol>
          <p className="fine-print">
            WA Premium Plus is a free, open-source app and is not affiliated with WhatsApp. Your
            chats are stored only on this computer.
          </p>
        </div>
        <div className="qr">
          {state.status === 'qr' && state.qr ? (
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
