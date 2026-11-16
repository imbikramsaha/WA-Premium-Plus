// Voice and video calls: no open-source WhatsApp library can carry call audio or video,
// so this opens the official WhatsApp Web, which can, in its own window.
// It is linked separately (one more entry in the phone's "Linked devices").

import { BrowserWindow, session, shell, systemPreferences } from 'electron';

const PARTITION = 'persist:whatsapp-web';
const HOME = 'https://web.whatsapp.com/';
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'notifications',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'mediaKeySystem',
]);

let callsWindow: BrowserWindow | null = null;

function isWhatsApp(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && (hostname === 'whatsapp.com' || hostname.endsWith('.whatsapp.com'));
  } catch {
    return false;
  }
}

/** A regular Chrome user agent: WhatsApp Web only supports mainstream browsers. */
function chromeUserAgent(): string {
  const platform =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64';
  const major = (process.versions.chrome ?? '140').split('.')[0];
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

let sessionConfigured = false;

function configureSession(): Electron.Session {
  const ses = session.fromPartition(PARTITION);
  if (sessionConfigured) return ses;
  sessionConfigured = true;
  ses.setUserAgent(chromeUserAgent());
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isWhatsApp(details.requestingUrl));
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => ALLOWED_PERMISSIONS.has(permission) && isWhatsApp(origin));
  return ses;
}

/** WhatsApp Web URL, opening a person's chat when a phone-number chat ID is given. */
function urlFor(chatId?: string): string {
  const user = chatId?.endsWith('@s.whatsapp.net') ? chatId.split('@')[0] : undefined;
  return user && /^\d+$/.test(user) ? `${HOME}send?phone=${user}` : HOME;
}

export async function openCallsWindow(icon: string, chatId?: string): Promise<void> {
  if (callsWindow) {
    if (callsWindow.isMinimized()) callsWindow.restore();
    callsWindow.show();
    callsWindow.focus();
    if (chatId) await callsWindow.loadURL(urlFor(chatId));
    return;
  }

  if (process.platform === 'darwin') {
    // macOS asks the user once; calls need both.
    await systemPreferences.askForMediaAccess('microphone').catch(() => false);
    await systemPreferences.askForMediaAccess('camera').catch(() => false);
  }

  const win = new BrowserWindow({
    width: 1150,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    title: 'Calls · WhatsApp Web',
    icon,
    autoHideMenuBar: true,
    webPreferences: {
      session: configureSession(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  callsWindow = win;
  win.on('closed', () => {
    if (callsWindow === win) callsWindow = null;
  });
  win.on('page-title-updated', (e) => e.preventDefault());

  // Keep the window on WhatsApp; open everything else in the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isWhatsApp(url)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });

  await win.loadURL(urlFor(chatId));
}
