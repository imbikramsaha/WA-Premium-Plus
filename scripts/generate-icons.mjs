// Draws the app and tray icons as PNGs from the logo geometry in assets/logo.svg.
// No image tools needed: shapes are rasterized with supersampling and encoded with zlib.
// Usage: node scripts/generate-icons.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- Logo geometry (512 x 512 design space, same as assets/logo.svg) ---
const GRADIENT_FROM = [0xea, 0xe9, 0xac];
const GRADIENT_TO = [0xcb, 0xc9, 0x6d];
const PLUS = [0x23, 0x23, 0x1a];
const BLACK = [0, 0, 0];

function inRoundedRect(x, y, left, top, width, height, radius) {
  const cx = Math.max(left + radius, Math.min(x, left + width - radius));
  const cy = Math.max(top + radius, Math.min(y, top + height - radius));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

const inPlus = (x, y) =>
  inRoundedRect(x, y, 216, 112, 80, 288, 40) || inRoundedRect(x, y, 112, 216, 288, 80, 40);
const inSquare = (x, y) => inRoundedRect(x, y, 0, 0, 512, 512, 112);

function logoColor(x, y) {
  if (!inSquare(x, y)) return null;
  if (inPlus(x, y)) return PLUS;
  const t = Math.min(1, Math.max(0, (x + y) / 1024));
  return GRADIENT_FROM.map((from, i) => from + (GRADIENT_TO[i] - from) * t);
}

const plusOnly = (color) => (x, y) => (inPlus(x, y) ? color : null);

/**
 * @param size output size in pixels
 * @param colorAt (x, y) in design space -> [r, g, b] or null for transparent
 * @param view the design-space square to draw: [left, top, span]
 */
function render(size, colorAt, view = [0, 0, 512]) {
  const [left, top, span] = view;
  const samples = size <= 64 ? 8 : 4;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = left + ((px + (sx + 0.5) / samples) / size) * span;
          const y = top + ((py + (sy + 0.5) / samples) / size) * span;
          const c = colorAt(x, y);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          covered++;
        }
      }
      if (covered === 0) continue;
      const i = (py * size + px) * 4;
      rgba[i] = Math.round(r / covered);
      rgba[i + 1] = Math.round(g / covered);
      rgba[i + 2] = Math.round(b / covered);
      rgba[i + 3] = Math.round((255 * covered) / samples ** 2);
    }
  }
  return encodePng(size, rgba);
}

// --- Minimal PNG encoder ---
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function write(relativePath, png) {
  const file = join(root, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png);
  console.log(`wrote ${relativePath}`);
}

// App icon for Windows and Linux installers: full bleed.
write('build/icon.png', render(1024, logoColor));
// macOS app icon: the system expects about 10% transparent margin around the shape.
write('build/icon-mac.png', render(1024, logoColor, [-56, -56, 624]));
// Window icon (Linux).
write('resources/icon.png', render(512, logoColor));
// Tray icons. macOS uses a black "template" image that the system tints for light and dark menus.
write('resources/trayTemplate.png', render(16, plusOnly(BLACK), [96, 96, 320]));
write('resources/trayTemplate@2x.png', render(32, plusOnly(BLACK), [96, 96, 320]));
write('resources/tray.png', render(32, logoColor));
write('resources/tray@2x.png', render(64, logoColor));
