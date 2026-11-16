import { useEffect, useRef, useState } from 'react';
import { initials } from '../format';

// Muted, warm two-tone gradients that sit well next to the Citrus accent.
const GRADIENTS: Array<[string, string]> = [
  ['#b0aa5c', '#86813a'], // olive
  ['#7fa68b', '#577e63'], // sage
  ['#c58f6c', '#9b6849'], // terracotta
  ['#7f96bb', '#586f95'], // slate blue
  ['#b585a6', '#8b5e7f'], // mauve
  ['#6fa3a5', '#4b7c7e'], // teal
  ['#c48a8a', '#9a6262'], // dusty rose
  ['#9a90c4', '#72699e'], // lavender
  ['#8f9a72', '#6a7550'], // moss
  ['#a39486', '#7b6c5f'], // stone
];

function gradientFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const [from, to] = GRADIENTS[Math.abs(hash) % GRADIENTS.length]!;
  return `linear-gradient(145deg, ${from}, ${to})`;
}

// Profile pictures, shared by every avatar on screen. The main process caches them on disk
// and fetches missing ones in the background, then sends an 'avatar' event.
const photos = new Map<string, string | null>();
const requested = new Set<string>();
const listeners = new Map<string, Set<(url: string | null) => void>>();
let subscribed = false;

function subscribe() {
  if (subscribed) return;
  subscribed = true;
  window.wapp.onEvent((event) => {
    if (event.type === 'avatar') {
      photos.set(event.id, event.url);
      listeners.get(event.id)?.forEach((fn) => fn(event.url));
    }
    if (event.type === 'account-switched') {
      photos.clear();
      requested.clear();
    }
  });
}

function usePhoto(id: string, visible: boolean): string | null {
  const [url, setUrl] = useState<string | null>(() => photos.get(id) ?? null);
  useEffect(() => {
    subscribe();
    setUrl(photos.get(id) ?? null);
    const set = listeners.get(id) ?? new Set();
    set.add(setUrl);
    listeners.set(id, set);
    return () => {
      set.delete(setUrl);
    };
  }, [id]);
  useEffect(() => {
    if (!visible || requested.has(id)) return;
    requested.add(id);
    void window.wapp
      .getAvatar(id)
      .then((result) => {
        if (result === null && photos.get(id)) return; // a fresher event already arrived
        photos.set(id, result);
        listeners.get(id)?.forEach((fn) => fn(result));
      })
      .catch(() => undefined);
  }, [id, visible]);
  return url;
}

export function Avatar({ id, name, size = 44 }: { id: string; name: string; size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [broken, setBroken] = useState(false);

  // Only ask for pictures of avatars that are on screen (the chat list can be very long).
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  const photo = usePhoto(id, visible);
  useEffect(() => setBroken(false), [photo]);

  return (
    <div
      ref={ref}
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.36, background: gradientFor(id) }}
      aria-hidden="true"
    >
      {initials(name)}
      {photo && !broken && <img src={photo} alt="" draggable={false} onError={() => setBroken(true)} />}
    </div>
  );
}
