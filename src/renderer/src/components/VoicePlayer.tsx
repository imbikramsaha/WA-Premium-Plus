import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { formatDuration } from '../format';
import { PauseIcon, PlayIcon } from './Icons';

const BARS = 36;

/** Bar heights that look like speech, stable for a given message. */
function barsFor(seed: string): number[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Array.from({ length: BARS }, (_, i) => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ i;
    const noise = ((h >>> 0) % 1000) / 1000;
    const envelope = Math.sin((Math.PI * (i + 1)) / (BARS + 1));
    return 0.22 + 0.78 * Math.max(0.1, envelope * (0.45 + 0.55 * noise));
  });
}

/** A compact player for voice notes and audio files. */
export function VoicePlayer({ url, seconds, seed }: { url: string; seconds?: number; seed: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(seconds ?? 0);
  const bars = useMemo(() => barsFor(seed), [seed]);
  const progress = duration > 0 ? current / duration : 0;

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  function seek(e: MouseEvent<HTMLDivElement>) {
    const el = audio.current;
    if (!el || !duration) return;
    const box = e.currentTarget.getBoundingClientRect();
    el.currentTime = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * duration;
    setCurrent(el.currentTime);
  }

  return (
    <div className="voice">
      <button className="voice-play" onClick={toggle} title={playing ? 'Pause' : 'Play'}>
        {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
      </button>
      <div className="voice-wave" onClick={seek} role="slider" aria-label="Position" aria-valuenow={Math.round(current)}>
        {bars.map((height, i) => (
          <span key={i} className={i / BARS < progress ? 'played' : ''} style={{ height: `${height * 100}%` }} />
        ))}
      </div>
      <span className="voice-time">{formatDuration(playing || current > 0 ? current : duration)}</span>
      <audio
        ref={audio}
        src={url}
        preload="metadata"
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={(e) => {
          setPlaying(false);
          setCurrent(0);
          e.currentTarget.currentTime = 0;
        }}
      />
    </div>
  );
}
