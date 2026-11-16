import { initials } from '../format';

const COLORS = ['#0f766e', '#7c3aed', '#c2410c', '#1d4ed8', '#be185d', '#4d7c0f', '#0369a1', '#a16207'];

function colorFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length]!;
}

export function Avatar({ id, name, size = 44 }: { id: string; name: string; size?: number }) {
  return (
    <div
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.36, background: colorFor(id) }}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}
