import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ConnectionState } from '../../../shared/types';
import { errorMessage, formatChatTime, formatId } from '../format';
import { Avatar } from './Avatar';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, ImageIcon, PlusIcon } from './Icons';
import { Modal } from './Menu';
import { RichText } from './MessageBubble';

const SEEN_KEY = 'wapp.seenStatuses';
const SHOW_MS = 6000;
const BACKGROUNDS = ['#4f6b3a', '#7a5c2e', '#2f5d73', '#6b3f63', '#7c3b3b', '#3f3f8a'];

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-800)));
  } catch {
    // not remembered; statuses show as new again
  }
}

interface Person {
  id: string;
  name: string;
  updates: ChatMessage[];
  allSeen: boolean;
  latest: number;
}

function StatusMedia({ message, onReady }: { message: ChatMessage; onReady: (seconds?: number) => void }) {
  const [url, setUrl] = useState<string | null>(message.media?.url ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setError(null);
    if (message.media?.url) {
      setUrl(message.media.url);
      return;
    }
    setUrl(null);
    window.wapp
      .downloadMedia(message.chatId, message.id)
      .then((u) => active && setUrl(u))
      .catch((err) => {
        if (!active) return;
        setError(errorMessage(err));
        onReady();
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);
  if (error) return <div className="status-error">{error}</div>;
  if (!url)
    return message.media?.thumb ? <img className="status-image blurred" src={message.media.thumb} alt="" /> : <div className="spinner" />;
  if (message.kind === 'video')
    return <video className="status-image" src={url} autoPlay controls onLoadedMetadata={(e) => onReady(e.currentTarget.duration)} />;
  return <img className="status-image" src={url} alt="" onLoad={() => onReady()} />;
}

function Viewer({
  person,
  startAt,
  onClose,
  onDone,
  onSeen,
}: {
  person: Person;
  startAt: number;
  onClose: () => void;
  onDone: () => void;
  onSeen: (m: ChatMessage) => void;
}) {
  const [index, setIndex] = useState(startAt);
  const [duration, setDuration] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const message = person.updates[index]!;
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setIndex(startAt);
  }, [person.id, startAt]);

  useEffect(() => {
    onSeen(message);
    setDuration(message.kind === 'image' || message.kind === 'video' ? null : SHOW_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);

  const next = useCallback(() => {
    if (index < person.updates.length - 1) setIndex(index + 1);
    else onDone();
  }, [index, person.updates.length, onDone]);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (duration === null || paused) return;
    timer.current = window.setTimeout(next, duration);
    return () => window.clearTimeout(timer.current);
  }, [duration, paused, next]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, onClose]);

  const isMedia = message.kind === 'image' || message.kind === 'video';
  const background = BACKGROUNDS[Math.abs([...message.id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % BACKGROUNDS.length];

  return (
    <div className="status-viewer" onMouseDown={() => setPaused(true)} onMouseUp={() => setPaused(false)}>
      <div className="status-progress">
        {person.updates.map((u, i) => (
          <span key={u.id} className={i < index ? 'done' : i === index ? 'current' : ''}>
            {i === index && duration !== null && (
              <i style={{ animationDuration: `${duration}ms`, animationPlayState: paused ? 'paused' : 'running' }} />
            )}
          </span>
        ))}
      </div>
      <header className="status-header">
        <Avatar id={person.id} name={person.name} size={36} />
        <div className="status-who">
          <strong>{person.name}</strong>
          <span>{formatChatTime(message.timestamp)}</span>
        </div>
        <button className="icon-button" title="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className="status-stage" style={isMedia ? undefined : { background }}>
        {isMedia ? (
          <StatusMedia message={message} onReady={(seconds) => setDuration(seconds ? Math.min(30_000, seconds * 1000 + 500) : SHOW_MS)} />
        ) : message.kind === 'text' ? (
          <div className="status-text">
            <RichText text={message.body} />
          </div>
        ) : (
          <div className="status-text small">This kind of status can only be viewed on your phone.</div>
        )}
        {isMedia && message.body && (
          <div className="status-caption">
            <RichText text={message.body} />
          </div>
        )}
        <button className="status-nav prev" title="Previous" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
          <ChevronLeftIcon size={28} />
        </button>
        <button className="status-nav next" title="Next" onClick={next}>
          <ChevronRightIcon size={28} />
        </button>
      </div>
    </div>
  );
}

export function StatusView({ connection }: { connection: ConnectionState }) {
  const [updates, setUpdates] = useState<ChatMessage[]>([]);
  const [seen, setSeen] = useState(loadSeen);
  const [open, setOpen] = useState<{ id: string; start: number } | null>(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    const load = () => void window.wapp.listStatuses().then(setUpdates);
    load();
    const off = window.wapp.onEvent((e) => e.type === 'statuses-changed' && load());
    const tick = window.setInterval(load, 60_000);
    return () => {
      off();
      window.clearInterval(tick);
    };
  }, []);

  const meName = connection.me?.name ?? 'My status';
  const { mine, people } = useMemo(() => {
    const byAuthor = new Map<string, ChatMessage[]>();
    const mine: ChatMessage[] = [];
    for (const u of updates) {
      if (u.fromMe) mine.push(u);
      else if (u.author) byAuthor.set(u.author, [...(byAuthor.get(u.author) ?? []), u]);
    }
    const people: Person[] = [...byAuthor.entries()].map(([id, list]) => ({
      id,
      name: list.at(-1)!.authorName || formatId(id),
      updates: list,
      allSeen: list.every((u) => seen.has(u.id)),
      latest: list.at(-1)!.timestamp,
    }));
    people.sort((a, b) => Number(a.allSeen) - Number(b.allSeen) || b.latest - a.latest);
    return { mine, people };
  }, [updates, seen]);

  const myPerson: Person = { id: connection.me?.id ?? 'me', name: 'My status', updates: mine, allSeen: true, latest: mine.at(-1)?.timestamp ?? 0 };
  const current = open ? (open.id === myPerson.id ? myPerson : people.find((p) => p.id === open.id)) : undefined;

  const markSeen = useCallback((m: ChatMessage) => {
    setSeen((prev) => {
      if (prev.has(m.id)) return prev;
      const next = new Set(prev).add(m.id);
      saveSeen(next);
      return next;
    });
    if (!m.fromMe && m.author) void window.wapp.markStatusViewed(m.id, m.author);
  }, []);

  function openPerson(p: Person) {
    if (p.updates.length === 0) return;
    const firstUnseen = p.updates.findIndex((u) => !seen.has(u.id));
    setOpen({ id: p.id, start: firstUnseen >= 0 && !p.allSeen ? firstUnseen : 0 });
  }

  function openNextPerson() {
    if (!current || current.id === myPerson.id) {
      setOpen(null);
      return;
    }
    const i = people.findIndex((p) => p.id === current.id);
    const nextPerson = people.slice(i + 1).find((p) => !p.allSeen);
    if (nextPerson) openPerson(nextPerson);
    else setOpen(null);
  }

  const recent = people.filter((p) => !p.allSeen);
  const viewed = people.filter((p) => p.allSeen);

  return (
    <div className="status-layout">
      <aside className="sidebar">
        <header className="sidebar-header">
          <h1>Status</h1>
          <button className="button ghost small" onClick={() => setPosting(true)} disabled={connection.status !== 'open'}>
            <PlusIcon size={16} />
            Post
          </button>
        </header>
        <ul className="chat-list">
          <li>
            <button className="chat-row" onClick={() => (mine.length ? openPerson(myPerson) : setPosting(true))}>
              <div className={`status-ring${mine.length ? ' mine' : ' empty'}`}>
                <Avatar id={myPerson.id} name={meName} size={40} />
              </div>
              <div className="chat-row-main">
                <span className="chat-name">My status</span>
                <span className="chat-preview">
                  {mine.length ? `${mine.length} update${mine.length > 1 ? 's' : ''} · ${formatChatTime(myPerson.latest)}` : 'Tap to add a status update'}
                </span>
              </div>
            </button>
          </li>
          {recent.length > 0 && <li className="list-heading">Recent updates</li>}
          {recent.map((p) => (
            <li key={p.id}>
              <button className={`chat-row${open?.id === p.id ? ' selected' : ''}`} onClick={() => openPerson(p)}>
                <div className="status-ring">
                  <Avatar id={p.id} name={p.name} size={40} />
                </div>
                <div className="chat-row-main">
                  <span className="chat-name">{p.name}</span>
                  <span className="chat-preview">{formatChatTime(p.latest)}</span>
                </div>
              </button>
            </li>
          ))}
          {viewed.length > 0 && <li className="list-heading">Viewed updates</li>}
          {viewed.map((p) => (
            <li key={p.id}>
              <button className={`chat-row${open?.id === p.id ? ' selected' : ''}`} onClick={() => openPerson(p)}>
                <div className="status-ring seen">
                  <Avatar id={p.id} name={p.name} size={40} />
                </div>
                <div className="chat-row-main">
                  <span className="chat-name">{p.name}</span>
                  <span className="chat-preview">{formatChatTime(p.latest)}</span>
                </div>
              </button>
            </li>
          ))}
          {people.length === 0 && <li className="list-empty">Your contacts' status updates from the last 24 hours appear here.</li>}
        </ul>
      </aside>
      <main className="content">
        {current && current.updates.length > 0 ? (
          <Viewer person={current} startAt={open!.start} onClose={() => setOpen(null)} onDone={openNextPerson} onSeen={markSeen} />
        ) : (
          <div className="empty-state">
            <div className="empty-logo">
              <ImageIcon size={40} />
            </div>
            <h2>Status updates</h2>
            <p>Pick a contact to see their updates. Viewing one lets them know you saw it, like on your phone.</p>
          </div>
        )}
      </main>
      {posting && <PostStatusDialog onClose={() => setPosting(false)} />}
    </div>
  );
}

function PostStatusDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'text' | 'media'>('text');
  const [text, setText] = useState('');
  const [color, setColor] = useState(BACKGROUNDS[0]!);
  const [file, setFile] = useState<{ path: string; name: string; preview?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function post() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'media') {
        if (!file) throw new Error('Choose a photo or video.');
        await window.wapp.postStatus(text, { path: file.path });
      } else {
        await window.wapp.postStatus(text, undefined, color);
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Post a status"
      narrow
      onClose={onClose}
      footer={
        <>
          <span className="muted small footer-note">Shared with your saved contacts for 24 hours</span>
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || (mode === 'text' ? !text.trim() : !file)} onClick={() => void post()}>
            {busy ? 'Posting…' : 'Post'}
          </button>
        </>
      }
    >
      <div className="segmented">
        <button className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}>
          Text
        </button>
        <button className={mode === 'media' ? 'active' : ''} onClick={() => setMode('media')}>
          Photo or video
        </button>
      </div>
      {mode === 'text' ? (
        <>
          <textarea
            className="status-compose"
            style={{ background: color }}
            autoFocus
            rows={5}
            maxLength={700}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a status"
          />
          <div className="swatches">
            {BACKGROUNDS.map((c) => (
              <button key={c} className={c === color ? 'active' : ''} style={{ background: c }} title="Background colour" onClick={() => setColor(c)} />
            ))}
          </div>
        </>
      ) : (
        <>
          <input
            ref={input}
            type="file"
            accept="image/*,video/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFile({
                  path: window.wapp.getPathForFile(f),
                  name: f.name,
                  preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined,
                });
              }
              e.target.value = '';
            }}
          />
          <button className="button status-pick" onClick={() => input.current?.click()}>
            {file?.preview ? <img src={file.preview} alt="" /> : <ImageIcon />}
            {file ? file.name : 'Choose a photo or video'}
          </button>
          <input value={text} maxLength={700} onChange={(e) => setText(e.target.value)} placeholder="Add a caption (optional)" />
        </>
      )}
      {error && <p className="error small">{error}</p>}
    </Modal>
  );
}
