import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseBuffer } from 'music-metadata';
import { opusPacketSamples, webmOpusToOgg } from '../src/main/opus-ogg.ts';

// 2.5 seconds recorded by Chromium's MediaRecorder (audio/webm;codecs=opus), as in the app.
const webm = new Uint8Array(readFileSync(new URL('./fixtures/voice.webm', import.meta.url)));

describe('webmOpusToOgg', () => {
  it('produces an Ogg Opus file with the right duration', async () => {
    const { ogg, seconds } = webmOpusToOgg(webm);
    assert.equal(new TextDecoder().decode(ogg.subarray(0, 4)), 'OggS');
    assert.ok(seconds > 2 && seconds < 3, `duration ${seconds}`);

    const meta = await parseBuffer(ogg, { mimeType: 'audio/ogg' });
    assert.equal(meta.format.container, 'Ogg');
    assert.equal(meta.format.codec, 'Opus');
    assert.ok(Math.abs((meta.format.duration ?? 0) - seconds) < 0.1);
  });

  it('marks the first page as start and the last as end of stream', () => {
    const { ogg } = webmOpusToOgg(webm);
    const pages: number[] = [];
    for (let i = 0; i + 4 < ogg.length; i++) {
      if (ogg[i] === 0x4f && ogg[i + 1] === 0x67 && ogg[i + 2] === 0x67 && ogg[i + 3] === 0x53) pages.push(ogg[i + 5]!);
    }
    assert.equal(pages[0], 0x02);
    assert.equal(pages.at(-1), 0x04);
  });

  it('rejects data that is not WebM Opus', () => {
    assert.throws(() => webmOpusToOgg(new Uint8Array([1, 2, 3, 4])));
  });
});

describe('opusPacketSamples', () => {
  it('reads frame sizes from the TOC byte', () => {
    assert.equal(opusPacketSamples(new Uint8Array([0xf8])), 960); // CELT 20 ms, one frame
    assert.equal(opusPacketSamples(new Uint8Array([0xf9])), 1920); // two frames
    assert.equal(opusPacketSamples(new Uint8Array([0x18])), 2880); // SILK 60 ms, one frame
    assert.equal(opusPacketSamples(new Uint8Array([0x0b, 0x03])), 2880); // SILK 20 ms, three frames
  });
});
