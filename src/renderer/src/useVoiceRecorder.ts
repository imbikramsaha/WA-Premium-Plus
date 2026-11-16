import { useEffect, useRef, useState } from 'react';

export interface Recording {
  webm: Uint8Array;
  seconds: number;
  /** 64 bars from 0 to 100, drawn by WhatsApp on the voice note. */
  waveform: number[];
}

const MIME = 'audio/webm;codecs=opus';
const BARS = 64;

function toBars(levels: number[]): number[] {
  if (levels.length === 0) return new Array(BARS).fill(0);
  const bars: number[] = [];
  for (let i = 0; i < BARS; i++) {
    const start = Math.floor((i * levels.length) / BARS);
    const end = Math.max(start + 1, Math.floor(((i + 1) * levels.length) / BARS));
    bars.push(Math.max(...levels.slice(start, end)));
  }
  const peak = Math.max(...bars) || 1;
  return bars.map((v) => Math.round((v / peak) * 100));
}

/** Records a voice note with the microphone as WebM/Opus, tracking loudness for the waveform. */
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const session = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    audio: AudioContext;
    chunks: Blob[];
    levels: number[];
    started: number;
    timer: number;
  } | null>(null);

  function cleanup() {
    const s = session.current;
    if (!s) return;
    window.clearInterval(s.timer);
    s.stream.getTracks().forEach((t) => t.stop());
    void s.audio.close();
    session.current = null;
    setRecording(false);
    setElapsed(0);
  }

  useEffect(() => cleanup, []);

  async function start(): Promise<void> {
    if (session.current) return;
    const allowed = await window.wapp.requestMicrophone();
    if (!allowed) throw new Error('Microphone access is off. Allow it in your system settings.');
    if (!MediaRecorder.isTypeSupported(MIME)) throw new Error('Voice recording is not supported here.');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    const recorder = new MediaRecorder(stream, { mimeType: MIME, audioBitsPerSecond: 32_000 });
    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 512;
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const chunks: Blob[] = [];
    const levels: number[] = [];
    const started = Date.now();
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    recorder.start(250);
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      levels.push(Math.sqrt(sum / samples.length));
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 100);
    session.current = { recorder, stream, audio, chunks, levels, started, timer };
    setRecording(true);
  }

  /** Stops and returns the recording. */
  async function stop(): Promise<Recording | null> {
    const s = session.current;
    if (!s) return null;
    const done = new Promise<void>((resolve) => {
      s.recorder.onstop = () => resolve();
    });
    s.recorder.stop();
    await done;
    const seconds = (Date.now() - s.started) / 1000;
    const webm = new Uint8Array(await new Blob(s.chunks, { type: MIME }).arrayBuffer());
    const waveform = toBars(s.levels);
    cleanup();
    return seconds < 0.5 ? null : { webm, seconds, waveform };
  }

  function cancel(): void {
    const s = session.current;
    if (!s) return;
    s.recorder.onstop = null;
    if (s.recorder.state !== 'inactive') s.recorder.stop();
    cleanup();
  }

  return { recording, elapsed, start, stop, cancel };
}
