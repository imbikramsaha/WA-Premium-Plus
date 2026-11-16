import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChatMessage, OutgoingFile } from '../../../shared/types';
import { errorMessage, formatBytes, formatDuration, formatId, messagePreview } from '../format';
import { useVoiceRecorder } from '../useVoiceRecorder';
import {
  ClockIcon,
  CloseIcon,
  ContactIcon,
  FileIcon,
  MapPinIcon,
  MicIcon,
  PaperclipIcon,
  PollIcon,
  ReplyIcon,
  SendIcon,
  TrashIcon,
} from './Icons';
import { Menu, useMenu } from './Menu';

export interface PendingFile {
  key: string;
  file: OutgoingFile;
  name: string;
  size: number;
  /** Object URL for image previews. */
  preview?: string;
}

export interface ComposerHandle {
  addFiles(files: File[]): void;
  focus(): void;
}

let nextKey = 0;

async function toPending(file: File): Promise<PendingFile> {
  const path = window.wapp.getPathForFile(file);
  const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
  const outgoing: OutgoingFile = path
    ? { path }
    : // Pasted images have no file on disk: send the bytes.
      { data: new Uint8Array(await file.arrayBuffer()), name: file.name || 'image.png', mimetype: file.type || 'image/png' };
  return { key: String(nextKey++), file: outgoing, name: file.name || 'Pasted image', size: file.size, preview };
}

export const Composer = forwardRef<
  ComposerHandle,
  {
    chatId: string;
    connected: boolean;
    /** Channels you follow: no composer, just a note. */
    readOnly?: boolean;
    /** The message being replied to. */
    replyTo?: ChatMessage | null;
    onCancelReply?: () => void;
    /** Opens the schedule dialog with the current text and first attached file. */
    onSchedule: (body: string, attachmentPath: string | undefined, clear: () => void) => void;
    /** Opens the dialog for sending a poll, location or contact card. */
    onShare?: (kind: 'poll' | 'location' | 'contact') => void;
  }
>(function Composer({ chatId, connected, readOnly, replyTo, onCancelReply, onSchedule, onShare }, ref) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const voice = useVoiceRecorder();
  const { menu, close: closeMenu, openUnder } = useMenu();

  function addFiles(list: File[]) {
    if (list.length === 0) return;
    void Promise.all(list.map(toPending)).then((pending) => setFiles((prev) => [...prev, ...pending].slice(0, 30)));
  }

  useImperativeHandle(ref, () => ({ addFiles, focus: () => inputRef.current?.focus() }));

  function clear() {
    setText('');
    setFiles((prev) => {
      prev.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      return [];
    });
  }

  // Start fresh when switching chats.
  useEffect(() => {
    clear();
    setError(null);
    voice.cancel();
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  async function send() {
    const body = text.trim();
    if ((!body && files.length === 0) || sending) return;
    setSending(true);
    setError(null);
    try {
      if (files.length === 0) {
        await window.wapp.sendText(chatId, body, replyTo?.id);
      } else {
        for (const [i, f] of files.entries()) {
          await window.wapp.sendFile(chatId, f.file, i === 0 ? body : undefined);
        }
      }
      clear();
      onCancelReply?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  if (readOnly) {
    return <footer className="composer readonly">You follow this channel. Only its admins can post here.</footer>;
  }

  async function finishVoice() {
    setSending(true);
    setError(null);
    try {
      const recording = await voice.stop();
      if (recording) {
        await window.wapp.sendVoiceNote(chatId, recording.webm, recording.seconds, recording.waveform);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  const firstPath = files.find((f) => 'path' in f.file)?.file;
  const canSend = connected && !sending && (text.trim() !== '' || files.length > 0);

  return (
    <>
      {error && <div className="composer-error">{error}</div>}
      {replyTo && (
        <div className="reply-bar">
          <ReplyIcon size={16} />
          <div className="reply-bar-text">
            <strong>{replyTo.fromMe ? 'Replying to yourself' : `Replying to ${replyTo.authorName || formatId(replyTo.author || replyTo.chatId)}`}</strong>
            <span>{messagePreview(replyTo)}</span>
          </div>
          <button className="icon-button tiny" title="Cancel reply" onClick={onCancelReply}>
            <CloseIcon size={14} />
          </button>
        </div>
      )}
      {files.length > 0 && (
        <div className="attachment-tray">
          {files.map((f) => (
            <div key={f.key} className="attachment-chip" title={f.name}>
              {f.preview ? <img src={f.preview} alt="" /> : <FileIcon size={18} />}
              <div className="attachment-text">
                <span>{f.name}</span>
                <small>{formatBytes(f.size)}</small>
              </div>
              <button
                className="icon-button tiny"
                title="Remove"
                onClick={() => setFiles((prev) => prev.filter((p) => p.key !== f.key))}
              >
                <CloseIcon size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <footer className="composer">
        {voice.recording ? (
          <>
            <button className="icon-button" title="Discard recording" onClick={voice.cancel}>
              <TrashIcon />
            </button>
            <div className="recording">
              <span className="rec-dot" /> Recording {formatDuration(voice.elapsed)}
            </div>
            <button className="icon-button send" title="Send voice message" onClick={() => void finishVoice()} disabled={!connected || sending}>
              <SendIcon />
            </button>
          </>
        ) : (
          <>
            <button
              className="icon-button"
              title="Attach"
              onClick={(e) =>
                openUnder(
                  e.currentTarget,
                  [
                    { label: 'Photos, videos & files', icon: <PaperclipIcon size={15} />, onClick: () => fileInput.current?.click() },
                    { label: 'Poll', icon: <PollIcon size={15} />, onClick: () => onShare?.('poll'), disabled: !connected },
                    { label: 'Location', icon: <MapPinIcon size={15} />, onClick: () => onShare?.('location'), disabled: !connected },
                    { label: 'Contact', icon: <ContactIcon size={15} />, onClick: () => onShare?.('contact'), disabled: !connected },
                  ],
                  'left',
                )
              }
            >
              <PaperclipIcon />
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <textarea
              ref={inputRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={(e) => {
                const pasted = Array.from(e.clipboardData.files);
                if (pasted.length > 0) {
                  e.preventDefault();
                  addFiles(pasted);
                }
              }}
              placeholder={
                files.length > 0 ? 'Add a caption' : connected ? 'Type a message' : 'Offline — you can still schedule'
              }
            />
            <button
              className="icon-button"
              title="Schedule this message"
              onClick={() => onSchedule(text, firstPath && 'path' in firstPath ? firstPath.path : undefined, clear)}
            >
              <ClockIcon />
            </button>
            {canSend || text.trim() || files.length > 0 ? (
              <button className="icon-button send" title="Send" onClick={() => void send()} disabled={!canSend}>
                <SendIcon />
              </button>
            ) : (
              <button
                className="icon-button send"
                title="Record a voice message"
                disabled={!connected || sending}
                onClick={() => voice.start().catch((err) => setError(errorMessage(err)))}
              >
                <MicIcon />
              </button>
            )}
          </>
        )}
      </footer>
      {menu && <Menu {...menu} y={menu.y - 190} onClose={closeMenu} />}
    </>
  );
});
