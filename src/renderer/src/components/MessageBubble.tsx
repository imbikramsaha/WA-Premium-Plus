import { Fragment, memo, useState, type ReactNode } from 'react';
import type { ChatMessage, MessageAck } from '../../../shared/types';
import { errorMessage, formatId, formatTime, kindLabel, messagePreview } from '../format';
import { ClockIcon, ContactIcon, ForwardIcon, MapPinIcon, MoreIcon, ReplyIcon, SmileIcon } from './Icons';
import { MediaView } from './MediaView';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const MORE_REACTIONS = [
  '🔥', '🎉', '👏', '😍', '🥰', '😘', '😊', '😁', '🤣', '😅', '😉', '😎', '🤔', '🙄', '😴', '😡',
  '😭', '🥺', '😱', '🤯', '🤗', '🤝', '👌', '✌️', '💪', '🙌', '👀', '💯', '✅', '❌', '⭐', '💔',
];

function Ack({ ack }: { ack?: MessageAck }) {
  if (!ack || ack === 'pending')
    return (
      <span className="ack" title="Sending">
        <ClockIcon size={12} />
      </span>
    );
  if (ack === 'error')
    return (
      <span className="ack error" title="Not sent">
        !
      </span>
    );
  if (ack === 'sent')
    return (
      <span className="ack" title="Sent">
        ✓
      </span>
    );
  const read = ack === 'read' || ack === 'played';
  return (
    <span className={`ack${read ? ' read' : ''}`} title={read ? 'Read' : 'Delivered'}>
      ✓✓
    </span>
  );
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

/** Message text with links and WhatsApp formatting (*bold*, _italic_, ~strike~, ```code```). */
export function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  const format = (chunk: string) => {
    const tokens = chunk.split(/(```[\s\S]+?```|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g);
    return tokens.map((t) => {
      if (t.length > 6 && t.startsWith('```') && t.endsWith('```')) return <code key={key++}>{t.slice(3, -3)}</code>;
      if (t.length > 2 && t.startsWith('*') && t.endsWith('*')) return <strong key={key++}>{t.slice(1, -1)}</strong>;
      if (t.length > 2 && t.startsWith('_') && t.endsWith('_')) return <em key={key++}>{t.slice(1, -1)}</em>;
      if (t.length > 2 && t.startsWith('~') && t.endsWith('~')) return <s key={key++}>{t.slice(1, -1)}</s>;
      return <Fragment key={key++}>{t}</Fragment>;
    });
  };
  for (const match of text.matchAll(URL_RE)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(...format(text.slice(last, index)));
    parts.push(
      <a key={key++} href={match[0]} target="_blank" rel="noreferrer">
        {match[0]}
      </a>,
    );
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(...format(text.slice(last)));
  return <>{parts}</>;
}

function PollView({ message, canVote }: { message: ChatMessage; canVote: boolean }) {
  const poll = message.poll!;
  const [error, setError] = useState<string | null>(null);
  const max = Math.max(1, ...poll.options.map((o) => o.count));
  const multiple = poll.selectableCount !== 1;

  async function vote(name: string) {
    const mine = poll.options.filter((o) => o.mine).map((o) => o.name);
    const next = multiple
      ? mine.includes(name)
        ? mine.filter((n) => n !== name)
        : [...mine, name]
      : mine.includes(name)
        ? []
        : [name];
    setError(null);
    try {
      await window.wapp.votePoll(message.chatId, message.id, next);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="poll">
      <div className="poll-question">{message.body}</div>
      <div className="poll-hint">{multiple ? 'Select one or more' : 'Select one'}</div>
      {poll.options.map((o) => (
        <button
          key={o.name}
          className={`poll-option${o.mine ? ' mine' : ''}`}
          disabled={!canVote}
          title={o.voters.length ? o.voters.join(', ') : undefined}
          onClick={() => void vote(o.name)}
        >
          <span className={`poll-check${multiple ? ' square' : ''}`}>{o.mine ? '✓' : ''}</span>
          <span className="poll-main">
            <span className="poll-name">
              <span>{o.name}</span>
              <span className="poll-count">{o.count}</span>
            </span>
            <span className="poll-bar">
              <span style={{ width: `${(o.count / max) * 100}%` }} />
            </span>
          </span>
        </button>
      ))}
      <div className="poll-footer">
        {poll.totalVoters === 1 ? '1 vote' : `${poll.totalVoters} votes`}
      </div>
      {error && <div className="media-error">{error}</div>}
    </div>
  );
}

function LocationView({ message }: { message: ChatMessage }) {
  const loc = message.location!;
  const url = `https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lng}#map=16/${loc.lat}/${loc.lng}`;
  return (
    <a className="location" href={url} target="_blank" rel="noreferrer" title="Open in OpenStreetMap">
      {loc.thumb ? (
        <img src={loc.thumb} alt="" />
      ) : (
        <div className="location-placeholder">
          <MapPinIcon size={28} />
        </div>
      )}
      <div className="location-text">
        <strong>{loc.name || (loc.live ? 'Live location' : 'Location')}</strong>
        <span>{loc.address || `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`}</span>
      </div>
    </a>
  );
}

function ContactsView({ message, onOpenChat }: { message: ChatMessage; onOpenChat: (chatId: string) => void }) {
  return (
    <div className="contact-cards">
      {message.contacts!.map((card, i) => {
        const jid = card.phones.find((p) => p.jid)?.jid;
        return (
          <div key={i} className="contact-card">
            <div className="contact-card-top">
              <span className="contact-card-icon">
                <ContactIcon size={18} />
              </span>
              <div>
                <strong>{card.name}</strong>
                {card.phones.map((p) => (
                  <div key={p.number} className="muted small">
                    {p.number}
                  </div>
                ))}
              </div>
            </div>
            {jid && (
              <button className="button small" onClick={() => onOpenChat(jid)}>
                Message
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

const MEDIA_KINDS = new Set(['image', 'video', 'audio', 'document', 'sticker']);

export interface BubbleActions {
  onReply: (m: ChatMessage) => void;
  onReact: (m: ChatMessage, emoji: string) => void;
  onMore: (m: ChatMessage, anchor: HTMLElement) => void;
  onJump: (messageId: string) => void;
  onOpenImage: (url: string) => void;
  onOpenChat: (chatId: string) => void;
}

export const MessageBubble = memo(function MessageBubble({
  message: m,
  isGroup,
  connected,
  highlighted,
  actions,
  canReact,
}: {
  message: ChatMessage;
  isGroup: boolean;
  connected: boolean;
  highlighted: boolean;
  actions: BubbleActions;
  canReact: boolean;
}) {
  const [picker, setPicker] = useState<'quick' | 'more' | null>(null);
  const isMedia = MEDIA_KINDS.has(m.kind) && m.media;
  const deleted = m.kind === 'deleted';
  const special = m.poll || m.location || m.contacts;
  const showBody = m.body && m.kind !== 'document' && !m.poll && !m.contacts && !(m.location && !m.location.live);

  return (
    <div className={`bubble-row ${m.fromMe ? 'out' : 'in'}${highlighted ? ' highlighted' : ''}`} data-id={m.id}>
      <div
        className={`bubble${m.kind === 'sticker' ? ' sticker' : ''}${deleted ? ' deleted' : ''}${special ? ' wide' : ''}`}
        onMouseLeave={() => setPicker(null)}
      >
        {isGroup && !m.fromMe && (m.authorName || m.author) && (
          <div className="bubble-author">{m.authorName || formatId(m.author)}</div>
        )}
        {m.forwarded && (
          <div className="bubble-forwarded">
            <ForwardIcon size={12} /> Forwarded
          </div>
        )}
        {m.quoted && (
          <button className="quote" onClick={() => actions.onJump(m.quoted!.id)} title="Go to the original message">
            <strong>{m.quoted.fromMe ? 'You' : m.quoted.authorName || formatId(m.quoted.author) || 'Them'}</strong>
            <span>{messagePreview(m.quoted)}</span>
          </button>
        )}
        {isMedia ? (
          <MediaView message={m} onOpenImage={actions.onOpenImage} />
        ) : m.poll ? (
          <PollView message={m} canVote={connected} />
        ) : m.location ? (
          <LocationView message={m} />
        ) : m.contacts ? (
          <ContactsView message={m} onOpenChat={actions.onOpenChat} />
        ) : (
          m.kind !== 'text' && m.kind !== 'other' && <div className="bubble-kind">{kindLabel(m.kind)}</div>
        )}
        {showBody && (
          <div className="bubble-text">
            <RichText text={m.body} />
          </div>
        )}
        {m.kind === 'other' && !m.body && <div className="bubble-kind">Message type not supported yet</div>}
        <div className="bubble-meta">
          {m.edited && <span>Edited</span>}
          {formatTime(m.timestamp)}
          {m.fromMe && !deleted && <Ack ack={m.ack} />}
        </div>
        {m.reactions && m.reactions.length > 0 && (
          <div className="reactions">
            {m.reactions.map((r) => (
              <button
                key={r.emoji}
                className={`reaction${r.mine ? ' mine' : ''}`}
                disabled={!connected || !canReact}
                title={r.mine ? 'Remove your reaction' : 'React with this'}
                onClick={() => actions.onReact(m, r.mine ? '' : r.emoji)}
              >
                {r.emoji}
                {r.count > 1 && <span>{r.count}</span>}
              </button>
            ))}
          </div>
        )}
        {!deleted && (
          <div className="bubble-tools">
            {canReact && (
              <button className="tool" title="React" disabled={!connected} onClick={() => setPicker(picker ? null : 'quick')}>
                <SmileIcon size={16} />
              </button>
            )}
            {canReact && (
              <button className="tool" title="Reply" onClick={() => actions.onReply(m)}>
                <ReplyIcon size={16} />
              </button>
            )}
            <button className="tool" title="More" onClick={(e) => actions.onMore(m, e.currentTarget)}>
              <MoreIcon size={16} />
            </button>
            {picker && (
              <div className={`reaction-picker${picker === 'more' ? ' expanded' : ''}`}>
                {(picker === 'quick' ? QUICK_REACTIONS : [...QUICK_REACTIONS, ...MORE_REACTIONS]).map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      setPicker(null);
                      actions.onReact(m, emoji);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
                {picker === 'quick' && (
                  <button className="reaction-more" title="More reactions" onClick={() => setPicker('more')}>
                    +
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
