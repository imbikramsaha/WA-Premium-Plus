import { useEffect, useState } from 'react';
import type { ChatMessage } from '../../../shared/types';
import { errorMessage, formatBytes, formatDuration, kindLabel } from '../format';
import { DownloadIcon, FileIcon, PlayIcon } from './Icons';

// One download per message, shared by every component that shows it.
const downloads = new Map<string, Promise<string>>();

function download(chatId: string, messageId: string): Promise<string> {
  const key = `${chatId}/${messageId}`;
  let pending = downloads.get(key);
  if (!pending) {
    pending = window.wapp.downloadMedia(chatId, messageId);
    pending.catch(() => downloads.delete(key)); // allow retrying after a failure
    downloads.set(key, pending);
  }
  return pending;
}

/** Images, stickers and voice notes load straight away; videos and documents on request. */
const AUTO_DOWNLOAD_LIMIT = 16 * 1024 * 1024;

export function MediaView({ message, onOpenImage }: { message: ChatMessage; onOpenImage: (url: string) => void }) {
  const media = message.media!;
  const { kind } = message;
  const [url, setUrl] = useState(media.url);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<string | undefined> {
    if (url) return url;
    setLoading(true);
    setError(null);
    try {
      const result = await download(message.chatId, message.id);
      setUrl(result);
      return result;
    } catch (err) {
      setError(errorMessage(err));
      return undefined;
    } finally {
      setLoading(false);
    }
  }

  const auto =
    media.downloadable &&
    (kind === 'image' || kind === 'sticker' || kind === 'audio') &&
    (media.size ?? 0) < AUTO_DOWNLOAD_LIMIT;

  // Our own sent media arrives with a local copy a moment after the message itself.
  useEffect(() => {
    if (media.url) setUrl(media.url);
  }, [media.url]);

  // Runs again when keys arrive for older media (see refreshChatMedia).
  useEffect(() => {
    if (!url && auto) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id, media.downloadable]);

  const aspect = media.width && media.height ? `${media.width} / ${media.height}` : undefined;
  const unavailable = !media.downloadable && !url;
  const status = loading ? <div className="spinner small" /> : null;

  // Older media without download keys and without a preview: a compact note rather than an
  // empty frame. The keys may still arrive from the phone, which re-renders this.
  if (unavailable && !media.thumb && kind !== 'document') {
    return (
      <div className="media-unavailable">
        <span>{kindLabel(kind)}</span>
        <small>Loading from your phone… if it doesn't appear, open it there</small>
      </div>
    );
  }

  if (kind === 'image' || kind === 'video') {
    if (url && kind === 'image') {
      return (
        <button className="media-frame" style={{ aspectRatio: aspect }} onClick={() => onOpenImage(url)}>
          <img src={url} alt={message.body || 'Photo'} />
        </button>
      );
    }
    if (url && kind === 'video') {
      return <video className="media-video" src={url} controls autoPlay style={{ aspectRatio: aspect }} />;
    }
    return (
      <div className="media-frame placeholder" style={{ aspectRatio: aspect ?? '4 / 3' }}>
        {media.thumb && <img className="blurred" src={media.thumb} alt="" />}
        <div className="media-overlay">
          {status ??
            (unavailable ? (
              <span className="media-note">{kindLabel(kind)} not available — open it on your phone</span>
            ) : (
              <button className="media-action" onClick={() => void load()} title={`Load ${kindLabel(kind).toLowerCase()}`}>
                {kind === 'video' ? <PlayIcon /> : <DownloadIcon />}
                <span>
                  {kind === 'video' && media.seconds ? formatDuration(media.seconds) : formatBytes(media.size)}
                </span>
              </button>
            ))}
        </div>
        {error && <span className="media-error">{error}</span>}
      </div>
    );
  }

  if (kind === 'sticker') {
    return url ? (
      <img className="media-sticker" src={url} alt="Sticker" />
    ) : (
      <div className="media-sticker placeholder">{status ?? 'Sticker'}</div>
    );
  }

  if (kind === 'audio') {
    if (url) {
      return (
        <div className="media-audio">
          <audio src={url} controls preload="metadata" />
          {media.ptt === false && <span className="media-note">Audio file</span>}
        </div>
      );
    }
    return (
      <div className="media-audio pending">
        {status ??
          (unavailable ? (
            <span className="media-note">Voice message not available — play it on your phone</span>
          ) : (
            <button className="button small" onClick={() => void load()}>
              <PlayIcon size={16} /> {media.ptt ? 'Voice message' : 'Audio'} {formatDuration(media.seconds)}
            </button>
          ))}
        {error && <span className="media-error">{error}</span>}
      </div>
    );
  }

  // Documents
  const name = media.fileName || message.body || 'Document';
  const ext = name.includes('.') ? name.split('.').pop()!.toUpperCase().slice(0, 4) : 'FILE';
  return (
    <div className="media-document">
      <div className="doc-icon">
        <FileIcon size={22} />
        <span>{ext}</span>
      </div>
      <div className="doc-main">
        <span className="doc-name" title={name}>
          {name}
        </span>
        <span className="doc-meta">{[formatBytes(media.size), media.mimetype?.split('/')[1]].filter(Boolean).join(' · ')}</span>
        {error && <span className="media-error">{error}</span>}
      </div>
      {unavailable ? (
        <span className="media-note">Open on phone</span>
      ) : (
        <div className="doc-actions">
          {status}
          <button
            className="button small"
            disabled={loading}
            onClick={async () => {
              if (await load()) await window.wapp.openMedia(message.chatId, message.id).catch((e) => setError(errorMessage(e)));
            }}
          >
            Open
          </button>
          <button
            className="button small"
            disabled={loading}
            onClick={async () => {
              if (await load()) await window.wapp.saveMedia(message.chatId, message.id).catch((e) => setError(errorMessage(e)));
            }}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
