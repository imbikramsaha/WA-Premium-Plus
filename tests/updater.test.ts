import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { assetNameFor, parseChecksums, shQuote, Updater, type InstallKind } from '../src/main/updater.ts';
import type { UpdateState } from '../src/shared/types.ts';
import { compareVersions } from '../src/shared/version.ts';

describe('versions', () => {
  it('compares versions', () => {
    assert.ok(compareVersions('0.5.0', '0.4.2') > 0);
    assert.ok(compareVersions('v0.4.10', '0.4.9') > 0);
    assert.equal(compareVersions('v1.0.0', '1.0'), 0);
    assert.ok(compareVersions('1.0.0-beta.2', '1.0.0') < 0);
    assert.ok(compareVersions('1.0.0-beta.10', '1.0.0-beta.2') > 0);
  });

  it('picks the installer for this computer', () => {
    assert.equal(assetNameFor('mac', 'arm64'), 'WA-Premium-Plus-mac-arm64.dmg');
    assert.equal(assetNameFor('mac', 'x64'), 'WA-Premium-Plus-mac-x64.dmg');
    assert.equal(assetNameFor('windows', 'x64'), 'WA-Premium-Plus-windows-setup.exe');
    assert.equal(assetNameFor('appimage', 'arm64'), 'WA-Premium-Plus-linux-arm64.AppImage');
    assert.equal(assetNameFor('deb', 'x64'), undefined);
    assert.deepEqual([...parseChecksums('abc\n' + 'a'.repeat(64) + '  file one.dmg\n' + 'B'.repeat(64) + ' *x.exe').entries()], [
      ['file one.dmg', 'a'.repeat(64)],
      ['x.exe', 'b'.repeat(64)],
    ]);
    assert.equal(shQuote("it's"), `'it'\\''s'`);
  });
});

function fakeGitHub(version: string, installer: Buffer, sums?: string) {
  const name = 'WA-Premium-Plus-mac-arm64.dmg';
  const hash = createHash('sha256').update(installer).digest('hex');
  const files: Record<string, Buffer | string> = {
    'https://x/latest': JSON.stringify({
      tag_name: `v${version}`,
      html_url: 'https://github.com/releases/v' + version,
      body: 'Notes',
      assets: [
        { name, browser_download_url: `https://x/${name}`, size: installer.length },
        { name: 'SHA256SUMS', browser_download_url: 'https://x/SHA256SUMS', size: 100 },
      ],
    }),
    [`https://x/${name}`]: installer,
    'https://x/SHA256SUMS': sums ?? `${hash}  ${name}\n`,
  };
  return (async (url: string) => {
    const body = files[String(url)];
    if (body === undefined) return new Response('missing', { status: 404 });
    return new Response(body, { headers: { 'content-length': String(Buffer.byteLength(body)) } });
  }) as typeof fetch;
}

function updater(kind: InstallKind, fetchImpl: typeof fetch, autoDownload = true) {
  const states: UpdateState[] = [];
  const cacheDir = mkdtempSync(join(tmpdir(), 'wapp-update-'));
  const u = new Updater({
    currentVersion: '0.5.0',
    kind,
    arch: 'arm64',
    cacheDir,
    settings: () => ({ autoCheckUpdates: true, autoDownloadUpdates: autoDownload }),
    emit: (s) => states.push(s),
    quit: () => undefined,
    openPath: async () => undefined,
    apiUrl: 'https://x/latest',
    fetch: fetchImpl,
  });
  return { u, states, cacheDir };
}

describe('Updater', () => {
  it('finds, downloads and verifies a newer version', async () => {
    const installer = Buffer.from('pretend dmg contents');
    const { u, cacheDir } = updater('mac', fakeGitHub('0.5.1', installer));
    const state = await u.check();
    assert.equal(state.latest, '0.5.1');
    await u.download();
    assert.equal(u.current.status, 'ready');
    assert.deepEqual(readFileSync(join(cacheDir, '0.5.1', 'WA-Premium-Plus-mac-arm64.dmg')), installer);
  });

  it('says when it is up to date', async () => {
    const { u } = updater('mac', fakeGitHub('0.5.0', Buffer.from('x')));
    assert.equal((await u.check()).status, 'up-to-date');
  });

  it("refuses a download that doesn't match its checksum", async () => {
    const { u } = updater('mac', fakeGitHub('0.6.0', Buffer.from('tampered'), `${'0'.repeat(64)}  WA-Premium-Plus-mac-arm64.dmg\n`), false);
    await u.check();
    await u.download();
    assert.equal(u.current.status, 'error');
    assert.match(u.current.error!, /checksum/);
    await assert.rejects(() => u.install(), /No update is ready/);
  });

  it('gives .deb installs the install command instead', async () => {
    const { u } = updater('deb', fakeGitHub('0.6.0', Buffer.from('x')));
    const state = await u.check();
    assert.equal(state.status, 'manual');
    assert.match(state.instructions!, /install\.sh \| sh/);
  });

  it('reports network errors', async () => {
    const { u } = updater('mac', (async () => new Response('rate limited', { status: 403 })) as typeof fetch);
    const state = await u.check();
    assert.equal(state.status, 'error');
    assert.match(state.error!, /403/);
  });
});
