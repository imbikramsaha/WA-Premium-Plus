import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, Menu, nativeTheme, net, Notification, protocol, shell, Tray } from 'electron';
import type { AppEvent, ChatMessage } from '../shared/types';
import type { AccountHost } from './account';
import { Accounts } from './accounts';
import { openCallsWindow } from './calls';
import { registerIpc } from './ipc';

const APP_NAME = 'WA Premium Plus';
const resourcesDir = app.isPackaged
  ? join(process.resourcesPath, 'resources')
  : join(import.meta.dirname, '../../resources');

// Downloaded media is served to the window as wapp-media://media/<file>, which supports
// streaming and seeking for audio and video.
protocol.registerSchemesAsPrivileged([
  { scheme: 'wapp-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let toldAboutTray = false;

function send(event: AppEvent): void {
  mainWindow?.webContents.send('wapp:event', event);
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(showOnReady = true): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    title: APP_NAME,
    show: false,
    autoHideMenuBar: true,
    icon: join(resourcesDir, 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0d0b' : '#f3f3ee',
    // macOS: content runs under an inset title bar, like native Mac apps.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 20, y: 18 } }
      : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;

  if (showOnReady) win.once('ready-to-show', () => win.show());

  // Closing the window keeps the app running in the tray so scheduled messages still go out.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!toldAboutTray && Notification.isSupported()) {
      toldAboutTray = true;
      new Notification({
        title: `${APP_NAME} is still running`,
        body: 'It keeps running in the background so your scheduled messages are sent. Quit from the tray icon.',
      }).show();
    }
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Open links in the user's browser instead of a new app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    // In development, show renderer console output in the terminal.
    win.webContents.on('console-message', (event) => console.log(`[renderer] ${event.message}`));
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }
}

function createTray(): void {
  const icon = join(resourcesDir, process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png');
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  const canOpenAtLogin = process.platform === 'darwin' || process.platform === 'win32';
  const buildMenu = () =>
    Menu.buildFromTemplate([
      { label: `Open ${APP_NAME}`, click: showWindow },
      ...(canOpenAtLogin
        ? [
            { type: 'separator' as const },
            {
              label: 'Open at login',
              type: 'checkbox' as const,
              checked: app.getLoginItemSettings().openAtLogin,
              click: (item: Electron.MenuItem) => {
                app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
              },
            },
          ]
        : []),
      { type: 'separator' },
      { label: `Quit ${APP_NAME}`, click: () => app.quit() },
    ]);
  tray.setContextMenu(buildMenu());
  if (process.platform !== 'darwin') tray.on('click', showWindow);
}

function startedHidden(): boolean {
  if (process.argv.includes('--hidden')) return true;
  return process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin;
}

function messageText(message: ChatMessage): string {
  if (message.body) return message.body;
  switch (message.kind) {
    case 'text':
      return 'New message';
    case 'audio':
      return 'Sent a voice message';
    case 'poll':
      return 'Sent a poll';
    case 'location':
      return 'Shared a location';
    case 'contact':
      return 'Shared a contact';
    default:
      return `Sent a ${message.kind}`;
  }
}

function main(): void {
  app.setName(APP_NAME);
  // WAPP_DATA_DIR lets developers run a separate profile (for example a test account).
  if (process.env.WAPP_DATA_DIR) app.setPath('userData', process.env.WAPP_DATA_DIR);

  if (!app.requestSingleInstanceLock()) {
    // Another copy is already running with this profile. Two copies would send every
    // scheduled message twice.
    app.quit();
    return;
  }
  app.on('second-instance', showWindow);
  if (process.platform === 'win32') app.setAppUserModelId('com.wapremiumplus.app');

  const dataDir = app.getPath('userData');
  let accountsTimer: NodeJS.Timeout | undefined;
  const accountsChanged = () => {
    clearTimeout(accountsTimer);
    accountsTimer = setTimeout(() => send({ type: 'accounts-changed' }), 400);
  };

  // eslint-disable-next-line prefer-const
  let accounts: Accounts;
  const host: AccountHost = {
    tempDir: join(app.getPath('temp'), 'wa-premium-plus'),
    offline: process.env.WAPP_OFFLINE === '1',
    emit(accountId, event) {
      if (event.type === 'connection' || event.type === 'chats-changed') {
        if (event.type === 'connection' && event.state.status === 'open') accounts?.remember(accountId);
        accountsChanged();
      }
      if (accounts && accountId === accounts.activeId) send(event);
    },
    notify(accountId, message, chatName) {
      const focusedOnIt = mainWindow?.isFocused() && accounts.activeId === accountId;
      if (focusedOnIt || !Notification.isSupported()) return;
      const label = accounts.labelFor(accountId);
      const notification = new Notification({
        title: label ? `${chatName} · ${label}` : chatName,
        body: messageText(message),
      });
      notification.on('click', () => {
        if (accounts.activeId !== accountId) {
          accounts.switchTo(accountId);
          send({ type: 'account-switched' });
        }
        showWindow();
      });
      notification.show();
    },
  };
  accounts = new Accounts(dataDir, host);

  registerIpc({
    accounts,
    onAccountsChanged: accountsChanged,
    onAccountSwitched: () => {
      send({ type: 'account-switched' });
      accountsChanged();
    },
    openCallsWindow: (account, chatId) =>
      openCallsWindow(
        join(resourcesDir, 'icon.png'),
        chatId,
        account.id,
        accounts.labelFor(account.id) ? `Calls · ${accounts.labelFor(account.id)} · WhatsApp Web` : undefined,
      ),
  });

  void app.whenReady().then(() => {
    // wapp-media://<account>/<media|avatar>/<file>
    protocol.handle('wapp-media', (request) => {
      const url = new URL(request.url);
      const [area = '', ...rest] = url.pathname.split('/').filter(Boolean);
      const folder = accounts.get(url.hostname)?.folderFor(area);
      if (!folder || rest.length === 0) return new Response(null, { status: 404 });
      const name = basename(decodeURIComponent(rest.join('/')));
      return net.fetch(pathToFileURL(join(folder, name)).toString(), { headers: request.headers });
    });
    createWindow(!startedHidden());
    createTray();
    accounts.startAll();

    app.on('activate', showWindow);
  });

  app.on('before-quit', () => {
    quitting = true;
    accounts.stopAll();
  });

  // Keep running in the tray when every window is closed.
  app.on('window-all-closed', () => undefined);
}

main();
