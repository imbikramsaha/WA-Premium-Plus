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

export function Avatar({ id, name, size = 44 }: { id: string; name: string; size?: number }) {
  return (
    <div
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.36, background: gradientFor(id) }}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}
