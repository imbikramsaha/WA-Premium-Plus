// Converts an Opus recording from WebM (what Chromium's MediaRecorder produces) to Ogg
// (what WhatsApp expects for voice notes). The audio packets are copied as they are:
// only the container changes, so there is no re-encoding and no quality loss.

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Audio: 0xe1,
  Channels: 0x9f,
  Cluster: 0x1f43b675,
  BlockGroup: 0xa0,
  Block: 0xa1,
  SimpleBlock: 0xa3,
};

/** Elements we step into rather than skip over. */
const CONTAINERS = new Set([ID.Segment, ID.Tracks, ID.TrackEntry, ID.Audio, ID.Cluster, ID.BlockGroup]);

function readVint(buf: Uint8Array, pos: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } {
  const first = buf[pos];
  if (first === undefined || first === 0) throw new Error('Invalid WebM data.');
  let length = 1;
  while (!(first & (0x80 >> (length - 1)))) length++;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = (first & (0xff >> length)) === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const byte = buf[pos + i] ?? 0;
    value = value * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  return { value, length, unknown: allOnes };
}

interface WebmOpus {
  opusHead?: Uint8Array;
  channels: number;
  packets: Uint8Array[];
}

function parseWebm(buf: Uint8Array): WebmOpus {
  const result: WebmOpus = { channels: 1, packets: [] };
  let codecId = '';
  let pos = 0;
  while (pos < buf.length) {
    const id = readVint(buf, pos, true);
    pos += id.length;
    if (pos >= buf.length) break;
    const size = readVint(buf, pos, false);
    pos += size.length;
    if (CONTAINERS.has(id.value)) continue; // step inside (works for unknown sizes too)
    if (size.unknown) throw new Error('Unsupported WebM layout.');
    const end = Math.min(pos + size.value, buf.length);
    const data = buf.subarray(pos, end);
    switch (id.value) {
      case ID.CodecID:
        codecId = new TextDecoder().decode(data);
        break;
      case ID.CodecPrivate:
        result.opusHead = data.slice();
        break;
      case ID.Channels:
        result.channels = data.reduce((n, b) => n * 256 + b, 0) || 1;
        break;
      case ID.SimpleBlock:
      case ID.Block: {
        const track = readVint(data, 0, false);
        const header = track.length + 3; // track number, 16-bit timecode, flags
        const flags = data[track.length + 2] ?? 0;
        if (flags & 0x06) throw new Error('Laced WebM blocks are not supported.');
        result.packets.push(data.slice(header));
        break;
      }
    }
    pos = end;
  }
  if (codecId && codecId !== 'A_OPUS') throw new Error(`Expected Opus audio, got ${codecId}.`);
  if (result.packets.length === 0) throw new Error('The recording is empty.');
  return result;
}

/** Number of 48 kHz samples in an Opus packet (RFC 6716, section 3.1). */
export function opusPacketSamples(packet: Uint8Array): number {
  const toc = packet[0] ?? 0;
  const config = toc >> 3;
  let frameMs: number;
  if (config < 12) frameMs = [10, 20, 40, 60][config % 4]!;
  else if (config < 16) frameMs = [10, 20][config % 2]!;
  else frameMs = [2.5, 5, 10, 20][config % 4]!;
  const code = toc & 0x03;
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 0) & 0x3f : 2;
  return Math.round(frames * frameMs * 48);
}

// --- Ogg ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

function oggCrc(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  return crc;
}

function oggPage(packets: Uint8Array[], granule: bigint, serial: number, sequence: number, flags: number): Uint8Array {
  const lacing: number[] = [];
  for (const p of packets) {
    let remaining = p.length;
    while (remaining >= 255) {
      lacing.push(255);
      remaining -= 255;
    }
    lacing.push(remaining);
  }
  const bodyLength = packets.reduce((n, p) => n + p.length, 0);
  const page = new Uint8Array(27 + lacing.length + bodyLength);
  const view = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53]); // "OggS"
  page[4] = 0; // version
  page[5] = flags;
  view.setBigUint64(6, granule, true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  view.setUint32(22, 0, true); // CRC, filled in below
  page[26] = lacing.length;
  page.set(lacing, 27);
  let offset = 27 + lacing.length;
  for (const p of packets) {
    page.set(p, offset);
    offset += p.length;
  }
  view.setUint32(22, oggCrc(page), true);
  return page;
}

function defaultOpusHead(channels: number): Uint8Array {
  const head = new Uint8Array(19);
  const view = new DataView(head.buffer);
  head.set(new TextEncoder().encode('OpusHead'));
  head[8] = 1; // version
  head[9] = channels;
  view.setUint16(10, 312, true); // pre-skip
  view.setUint32(12, 48000, true); // original sample rate
  view.setInt16(16, 0, true); // output gain
  head[18] = 0; // channel mapping family
  return head;
}

function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode('WA Premium Plus');
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  const view = new DataView(tags.buffer);
  tags.set(new TextEncoder().encode('OpusTags'));
  view.setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  view.setUint32(12 + vendor.length, 0, true); // no user comments
  return tags;
}

export interface OggResult {
  ogg: Uint8Array;
  /** Playable duration in seconds. */
  seconds: number;
}

export function webmOpusToOgg(webm: Uint8Array): OggResult {
  const { opusHead, channels, packets } = parseWebm(webm);
  const head = opusHead && opusHead.length >= 19 ? opusHead : defaultOpusHead(channels);
  const preSkip = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint16(10, true);
  const serial = (Math.random() * 0xffffffff) >>> 0;

  const pages: Uint8Array[] = [oggPage([head], 0n, serial, 0, 0x02), oggPage([opusTags()], 0n, serial, 1, 0)];
  let sequence = 2;
  let granule = 0n;
  const PACKETS_PER_PAGE = 50;
  for (let i = 0; i < packets.length; i += PACKETS_PER_PAGE) {
    const chunk = packets.slice(i, i + PACKETS_PER_PAGE);
    for (const p of chunk) granule += BigInt(opusPacketSamples(p));
    const last = i + PACKETS_PER_PAGE >= packets.length;
    pages.push(oggPage(chunk, granule, serial, sequence++, last ? 0x04 : 0));
  }

  const total = pages.reduce((n, p) => n + p.length, 0);
  const ogg = new Uint8Array(total);
  let offset = 0;
  for (const p of pages) {
    ogg.set(p, offset);
    offset += p.length;
  }
  const samples = Number(granule) - preSkip;
  return { ogg, seconds: Math.max(0, samples / 48000) };
}
