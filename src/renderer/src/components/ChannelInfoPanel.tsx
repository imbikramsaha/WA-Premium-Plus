import { useEffect, useState } from 'react';
import type { ChannelInfo } from '../../../shared/types';
import { errorMessage } from '../format';
import { Avatar } from './Avatar';
import { CloseIcon } from './Icons';

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const countFormat = new Intl.NumberFormat(undefined, { notation: 'compact' });

export function ChannelInfoPanel({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const [info, setInfo] = useState<ChannelInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () =>
    window.wapp
      .getChannelInfo(chatId)
      .then(setInfo)
      .catch((err) => setError(errorMessage(err)));

  useEffect(() => {
    setInfo(null);
    setError(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <aside className="side-panel">
      <header className="side-panel-header">
        <h3>Channel info</h3>
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
            <Avatar id={info.id} name={info.name} size={72} />
            <h2>
              {info.name}
              {info.verified && (
                <span className="verified" title="Verified">
                  ✓
                </span>
              )}
            </h2>
            <span className="muted">
              Channel
              {info.subscribers !== undefined ? ` · ${countFormat.format(info.subscribers)} followers` : ''}
              {info.createdAt ? ` · since ${dateFormat.format(new Date(info.createdAt * 1000))}` : ''}
            </span>
          </div>
          {info.description && <p className="group-description">{info.description}</p>}
          <div className="group-actions">
            {info.link && (
              <button
                className="button"
                onClick={() =>
                  void navigator.clipboard.writeText(info.link!).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 2000);
                  })
                }
              >
                {copied ? 'Link copied' : 'Copy channel link'}
              </button>
            )}
            <button className="button" onClick={() => void run(() => window.wapp.muteChannel(chatId, !info.muted))}>
              {info.muted ? 'Unmute' : 'Mute'}
            </button>
            <button
              className="button danger"
              onClick={() => {
                if (!window.confirm(`Unfollow ${info.name}?`)) return;
                void window.wapp
                  .unfollowChannel(chatId)
                  .then(onClose)
                  .catch((err) => setError(errorMessage(err)));
              }}
            >
              Unfollow
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
