import { useEffect, useState } from 'react';
import type { AccountSummary, AppSettings, UpdateState } from '../../../shared/types';
import { errorMessage, formatRelative } from '../format';
import { Avatar } from './Avatar';
import { ExportIcon, LogoutIcon, PlusIcon } from './Icons';
import { Logo } from './Logo';

const REPO_URL = 'https://github.com/imbikramsaha/WA-Premium-Plus';

/** The update state, kept current from the main process. */
export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    void window.wapp.getUpdateState().then(setState);
    return window.wapp.onEvent((e) => e.type === 'update' && setState(e.state));
  }, []);
  return state;
}

async function attempt(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (err) {
    window.alert(errorMessage(err));
  }
}

export function updateSummary(state: UpdateState): string {
  switch (state.status) {
    case 'checking':
      return 'Checking for updates…';
    case 'up-to-date':
      return `You have the latest version.${state.checkedAt ? ` Checked ${formatRelative(state.checkedAt)}.` : ''}`;
    case 'available':
      return `Version ${state.latest} is available.`;
    case 'downloading':
      return `Downloading version ${state.latest}… ${Math.round((state.progress ?? 0) * 100)}%`;
    case 'ready':
      return `Version ${state.latest} is downloaded and checked. Restart to update.`;
    case 'manual':
      return state.instructions ?? `Version ${state.latest} is available.`;
    case 'error':
      return state.error ?? 'Something went wrong.';
    default:
      return 'Updates are checked automatically.';
  }
}

function UpdatesSection() {
  const state = useUpdateState();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => void window.wapp.getAppSettings().then(setSettings), []);
  const save = (next: AppSettings) => {
    setSettings(next);
    void attempt(() => window.wapp.saveAppSettings(next));
  };
  if (!state || !settings) return null;
  const command = state.status === 'manual' && state.instructions?.split('\n')[1];
  return (
    <section className="settings-block">
      <h3>Updates</h3>
      <div className="update-line">
        <Logo size={40} />
        <div>
          <strong>WA Premium Plus {state.current}</strong>
          <p className={state.status === 'error' ? 'error small' : 'muted small'}>{command ? `Version ${state.latest} is out. Update by running:` : updateSummary(state)}</p>
          {command && <code className="command">{command}</code>}
          {state.status === 'downloading' && (
            <div className="progress">
              <span style={{ width: `${(state.progress ?? 0) * 100}%` }} />
            </div>
          )}
        </div>
      </div>
      <div className="row-buttons left">
        {state.status === 'ready' ? (
          <button className="button primary" onClick={() => void attempt(() => window.wapp.installUpdate())}>
            Restart and update
          </button>
        ) : state.status === 'available' ? (
          <button className="button primary" onClick={() => void attempt(() => window.wapp.downloadUpdate())}>
            Download version {state.latest}
          </button>
        ) : (
          <button className="button" disabled={state.status === 'checking' || state.status === 'downloading'} onClick={() => void attempt(() => window.wapp.checkForUpdates())}>
            Check for updates
          </button>
        )}
        {command && (
          <button className="button" onClick={() => void navigator.clipboard.writeText(command)}>
            Copy command
          </button>
        )}
        {state.url && state.latest && state.status !== 'up-to-date' && (
          <a className="button ghost" href={state.url} target="_blank" rel="noreferrer">
            What's new
          </a>
        )}
      </div>
      <label className="check-row">
        <input type="checkbox" checked={settings.autoCheckUpdates} onChange={(e) => save({ ...settings, autoCheckUpdates: e.target.checked })} />
        Check for new versions automatically (asks GitHub a few times a day; nothing about you is sent)
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.autoDownloadUpdates}
          disabled={!settings.autoCheckUpdates}
          onChange={(e) => save({ ...settings, autoDownloadUpdates: e.target.checked })}
        />
        Download new versions in the background, ready to install when you restart
      </label>
      <p className="hint">Every download is checked against the release's published SHA-256 checksums before it's installed.</p>
    </section>
  );
}

function AccountsSection() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  useEffect(() => {
    const load = () => void window.wapp.listAccounts().then(setAccounts);
    load();
    return window.wapp.onEvent((e) => (e.type === 'accounts-changed' || e.type === 'account-switched') && load());
  }, []);
  return (
    <section className="settings-block">
      <h3>WhatsApp accounts</h3>
      <ul className="card-list">
        {accounts.map((a) => (
          <li key={a.id} className="card-row flat">
            <Avatar id={a.phone ? `${a.phone.slice(1)}@s.whatsapp.net` : a.id} name={a.name} size={36} />
            <div className="card-main">
              <strong>
                {a.name}
                {a.active && <span className="pill">Shown now</span>}
              </strong>
              <span className="muted small">
                {a.phone ?? 'Not linked yet'} · {a.status === 'open' ? 'connected' : a.linked ? 'connecting…' : 'waiting to be linked'}
                {a.unreadChats ? ` · ${a.unreadChats} unread chats` : ''}
              </span>
            </div>
            {!a.active && (
              <button className="button small" onClick={() => void attempt(() => window.wapp.switchAccount(a.id))}>
                Switch
              </button>
            )}
            {accounts.length > 1 ? (
              <button
                className="button small danger"
                onClick={() =>
                  window.confirm(`Remove ${a.name} from WA Premium Plus?\n\nThis unlinks it and deletes its chats and schedules from this computer.`) &&
                  void attempt(() => window.wapp.removeAccount(a.id))
                }
              >
                Remove
              </button>
            ) : (
              <button
                className="button small danger"
                onClick={() =>
                  window.confirm('Log out of WhatsApp on this computer?\n\nThis removes your chats and scheduled messages from WA Premium Plus.') &&
                  void attempt(() => window.wapp.logout())
                }
              >
                <LogoutIcon size={14} /> Log out
              </button>
            )}
          </li>
        ))}
      </ul>
      <div>
        <button className="button" onClick={() => void attempt(() => window.wapp.addAccount())}>
          <PlusIcon size={15} /> Add another WhatsApp account
        </button>
      </div>
      <p className="hint">
        Each account stays connected in the background with its own chats, schedules and automation. Up to 5 accounts.
      </p>
    </section>
  );
}

export function SettingsView({ onExportAll }: { onExportAll?: () => void }) {
  return (
    <div className="scheduled">
      <header className="content-header">
        <div>
          <h2>Settings</h2>
          <p className="muted">Everything here stays on this computer.</p>
        </div>
      </header>
      <div className="scheduled-body settings">
        <UpdatesSection />
        <AccountsSection />
        <section className="settings-block">
          <h3>Your data</h3>
          <p className="muted small">
            Your chats, media, schedules and automation are stored only on this computer, in a local database. There are no
            WA Premium Plus servers or accounts.
          </p>
          <div>
            <button className="button" onClick={onExportAll}>
              <ExportIcon size={15} /> Export all chats…
            </button>
          </div>
        </section>
        <section className="settings-block">
          <h3>About</h3>
          <p className="muted small">
            WA Premium Plus is free, open-source software (MIT License). It's an independent project, not affiliated with
            WhatsApp or Meta.
          </p>
          <div className="row-buttons left">
            <a className="button ghost" href={REPO_URL} target="_blank" rel="noreferrer">
              Source code on GitHub
            </a>
            <a className="button ghost" href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">
              Report a problem
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
