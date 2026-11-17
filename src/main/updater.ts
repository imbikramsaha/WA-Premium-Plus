// Auto-update from GitHub Releases, without a code-signing certificate or an update server:
// check the latest release, download this computer's installer, verify it against the
// release's SHA256SUMS, and install it on restart.
//
// macOS: the new app bundle replaces the running one (when its folder is writable).
// Windows: the installer runs silently and starts the app again.
// Linux: an AppImage replaces itself; .deb installs show the install command instead,
// because they need administrator rights.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, chmod, constants, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { AppSettings, UpdateState } from '../shared/types.ts';
import { compareVersions } from '../shared/version.ts';

export const REPO = 'imbikramsaha/WA-Premium-Plus';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_AFTER_MS = 20_000;
const INSTALL_COMMAND = `curl -fsSL https://github.com/${REPO}/releases/latest/download/install.sh | sh`;

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface Release {
  tag_name: string;
  html_url: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets: ReleaseAsset[];
}

export type InstallKind = 'mac' | 'windows' | 'appimage' | 'deb' | 'unpackaged';

/** The release file this computer installs from, by platform and processor. */
export function assetNameFor(kind: InstallKind, arch: string): string | undefined {
  switch (kind) {
    case 'mac':
      return arch === 'arm64' ? 'WA-Premium-Plus-mac-arm64.dmg' : 'WA-Premium-Plus-mac-x64.dmg';
    case 'windows':
      return 'WA-Premium-Plus-windows-setup.exe';
    case 'appimage':
      return arch === 'arm64' ? 'WA-Premium-Plus-linux-arm64.AppImage' : 'WA-Premium-Plus-linux-x64.AppImage';
    default:
      return undefined;
  }
}

/** Reads a SHA256SUMS file ("<hash>  <name>" per line). */
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m) sums.set(m[2]!.trim(), m[1]!.toLowerCase());
  }
  return sums;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/** Shell-quotes a string for /bin/sh. */
export function shQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

export interface UpdaterOptions {
  currentVersion: string;
  kind: InstallKind;
  arch: string;
  /** Where downloads go. */
  cacheDir: string;
  /** The installed app: the .app bundle (macOS), or the AppImage file (Linux). */
  installedPath?: string;
  settings: () => AppSettings;
  emit: (state: UpdateState) => void;
  /** Quits the app (after the installer has been started). */
  quit: () => void;
  /** Opens a file with the system (fallback: show the downloaded .dmg). */
  openPath: (path: string) => Promise<unknown>;
  apiUrl?: string;
  fetch?: typeof fetch;
}

export class Updater {
  private state: UpdateState;
  private readonly opts: UpdaterOptions;
  private timer: NodeJS.Timeout | undefined;
  private release: Release | undefined;
  private downloaded: string | undefined;
  private busy: Promise<unknown> | undefined;

  constructor(opts: UpdaterOptions) {
    this.opts = opts;
    this.state = { status: 'idle', current: opts.currentVersion };
  }

  get current(): UpdateState {
    return this.state;
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.opts.emit(this.state);
  }

  start(): void {
    const tick = () => {
      if (this.opts.settings().autoCheckUpdates) void this.check().catch(() => undefined);
    };
    setTimeout(tick, FIRST_CHECK_AFTER_MS);
    this.timer = setInterval(tick, CHECK_EVERY_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private get fetch(): typeof fetch {
    return this.opts.fetch ?? fetch;
  }

  async latestRelease(): Promise<Release> {
    const url = this.opts.apiUrl ?? `https://api.github.com/repos/${REPO}/releases/latest`;
    const res = await this.fetch(url, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'WA-Premium-Plus-Updater' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
    return (await res.json()) as Release;
  }

  /** Looks for a newer version; downloads it when automatic downloads are on. */
  async check(): Promise<UpdateState> {
    if (this.state.status === 'downloading') return this.state;
    // A downloaded update stays ready unless an even newer version has come out since.
    const readyVersion = this.state.status === 'ready' ? this.state.latest : undefined;
    if (!readyVersion) this.set({ status: 'checking', error: undefined });
    try {
      const release = await this.latestRelease();
      const latest = release.tag_name.replace(/^v/i, '');
      if (readyVersion && compareVersions(latest, readyVersion) <= 0) return this.state;
      const base = { latest, notes: release.body ?? '', url: release.html_url, checkedAt: Date.now() };
      if (release.draft || release.prerelease || compareVersions(latest, this.opts.currentVersion) <= 0) {
        this.set({ status: 'up-to-date', ...base });
        return this.state;
      }
      this.release = release;
      const assetName = assetNameFor(this.opts.kind, this.opts.arch);
      if (!assetName) {
        this.set({
          status: 'manual',
          ...base,
          instructions:
            this.opts.kind === 'deb'
              ? `Version ${latest} is out. Update by running this in a terminal:\n${INSTALL_COMMAND}`
              : `Version ${latest} is out. Download it from the releases page.`,
        });
        return this.state;
      }
      this.set({ status: 'available', ...base });
      if (this.opts.settings().autoDownloadUpdates) void this.download().catch(() => undefined);
      return this.state;
    } catch (err) {
      if (readyVersion) return this.state; // keep the update that's already downloaded
      this.set({ status: 'error', error: `Couldn't check for updates: ${err instanceof Error ? err.message : String(err)}`, checkedAt: Date.now() });
      return this.state;
    }
  }

  /** Downloads and verifies the installer for the available version. */
  download(): Promise<unknown> {
    this.busy ??= this.doDownload().finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }

  private async doDownload(): Promise<void> {
    const release = this.release;
    const assetName = assetNameFor(this.opts.kind, this.opts.arch);
    if (!release || !assetName) throw new Error('No update to download.');
    const asset = release.assets.find((a) => a.name === assetName);
    const sums = release.assets.find((a) => a.name === 'SHA256SUMS');
    if (!asset || !sums) {
      this.set({ status: 'error', error: `The ${release.tag_name} release has no installer for this computer.` });
      return;
    }
    const version = release.tag_name.replace(/^v/i, '');
    const dir = join(this.opts.cacheDir, version);
    const target = join(dir, assetName);
    this.set({ status: 'downloading', progress: 0, error: undefined });
    try {
      // Old downloads are no longer needed.
      await mkdir(this.opts.cacheDir, { recursive: true });
      for (const entry of await readdir(this.opts.cacheDir)) {
        if (entry !== version) await rm(join(this.opts.cacheDir, entry), { recursive: true, force: true });
      }
      await mkdir(dir, { recursive: true });
      const sumsRes = await this.fetch(sums.browser_download_url, { signal: AbortSignal.timeout(30_000) });
      if (!sumsRes.ok) throw new Error(`checksums download failed (${sumsRes.status})`);
      const expected = parseChecksums(await sumsRes.text()).get(assetName);
      if (!expected) throw new Error('the checksums file has no entry for the installer');

      const already = await sha256File(target).catch(() => undefined);
      if (already !== expected) {
        const res = await this.fetch(asset.browser_download_url, { signal: AbortSignal.timeout(30 * 60_000) });
        if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
        const total = Number(res.headers.get('content-length')) || asset.size || 0;
        let received = 0;
        let lastEmit = 0;
        const body = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
        body.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (total && Date.now() - lastEmit > 400) {
            lastEmit = Date.now();
            this.set({ progress: Math.min(1, received / total) });
          }
        });
        await pipeline(body, createWriteStream(`${target}.part`));
        if ((await sha256File(`${target}.part`)) !== expected) {
          await rm(`${target}.part`, { force: true });
          throw new Error("the download didn't match its checksum");
        }
        await rename(`${target}.part`, target);
      }
      this.downloaded = target;
      this.set({ status: 'ready', progress: 1 });
    } catch (err) {
      this.set({ status: 'error', error: `Couldn't download the update: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  /** Installs the downloaded version and restarts. */
  async install(): Promise<void> {
    const file = this.downloaded;
    if (this.state.status !== 'ready' || !file) throw new Error('No update is ready to install yet.');
    switch (this.opts.kind) {
      case 'windows':
        // The installer closes the app if it's still open, installs, then starts it (--force-run).
        spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
        this.opts.quit();
        return;
      case 'mac':
        return this.installMac(file);
      case 'appimage':
        return this.installAppImage(file);
      default:
        throw new Error('This installation updates through its package manager.');
    }
  }

  /** Runs a shell script after the app has quit, so files can be replaced and the app restarted. */
  private async runAfterQuit(script: string): Promise<void> {
    const path = join(this.opts.cacheDir, 'install.sh');
    await writeFile(path, `#!/bin/sh\nwhile kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done\n${script}\n`, { mode: 0o755 });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    spawn('/bin/sh', [path], { detached: true, stdio: 'ignore', env }).unref();
    this.opts.quit();
  }

  /** The command that starts the app again, keeping a custom data folder (used in development). */
  private relaunchCommand(executable: string, appBundle?: string): string {
    if (appBundle && !process.env.WAPP_DATA_DIR) return `open ${shQuote(appBundle)}`;
    return `${shQuote(executable)} >/dev/null 2>&1 &`;
  }

  private async installMac(dmg: string): Promise<void> {
    const bundle = this.opts.installedPath;
    const canReplace =
      bundle &&
      bundle.endsWith('.app') &&
      !bundle.includes('/AppTranslocation/') &&
      (await access(dirname(bundle), constants.W_OK).then(
        () => true,
        () => false,
      ));
    if (!canReplace) {
      // Can't replace the app in place (for example a read-only folder): open the disk image.
      await this.opts.openPath(dmg);
      return;
    }
    const work = join(this.opts.cacheDir, 'stage');
    const mount = join(work, 'mount');
    await rm(work, { recursive: true, force: true });
    await mkdir(mount, { recursive: true });
    const run = (cmd: string, args: string[]) =>
      new Promise<void>((resolve, reject) => {
        const p = spawn(cmd, args, { stdio: 'ignore' });
        p.on('error', reject);
        p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} failed (${code})`))));
      });
    const name = bundle.split('/').pop()!;
    const staged = join(work, name);
    await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, dmg]);
    try {
      const inside = (await readdir(mount)).find((f) => f.endsWith('.app'));
      if (!inside) throw new Error('The disk image has no app in it.');
      await run('ditto', [join(mount, inside), staged]);
    } finally {
      await run('hdiutil', ['detach', mount, '-force']).catch(() => undefined);
    }
    const backup = join(work, `${name}.previous`);
    const executable = join(bundle, 'Contents', 'MacOS', name.replace(/\.app$/, ''));
    await this.runAfterQuit(
      [
        `mv ${shQuote(bundle)} ${shQuote(backup)} || exit 1`,
        `if mv ${shQuote(staged)} ${shQuote(bundle)}; then`,
        `  xattr -dr com.apple.quarantine ${shQuote(bundle)} 2>/dev/null`,
        `  rm -rf ${shQuote(backup)}`,
        'else',
        `  mv ${shQuote(backup)} ${shQuote(bundle)}`,
        'fi',
        this.relaunchCommand(executable, bundle),
      ].join('\n'),
    );
  }

  private async installAppImage(file: string): Promise<void> {
    const current = this.opts.installedPath;
    if (!current) throw new Error("Couldn't find the running AppImage.");
    const next = `${current}.new`;
    await rm(next, { force: true });
    await pipeline(createReadStream(file), createWriteStream(next));
    await chmod(next, 0o755);
    await rename(next, current);
    // Start the new AppImage on its own, not inside this one's environment.
    await this.runAfterQuit(`unset APPDIR APPIMAGE ARGV0 OWD\n${shQuote(current)} >/dev/null 2>&1 &`);
  }
}
