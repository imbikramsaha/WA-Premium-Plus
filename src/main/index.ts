import { join } from 'node:path';
import { app, BrowserWindow, Menu, nativeTheme, Notification, shell, Tray } from 'electron';
import type { AppEvent } from '../shared/types';
import { registerIpc } from './ipc';
import { Scheduler } from './scheduler';
import { Store } from './store';
import { WhatsApp } from './whatsapp';

const APP_NAME = 'WA Premium Plus';
const resourcesDir = app.isPackaged
  ? join(process.resourcesPath, 'resources')
  : join(import.meta.dirname, '../../resources');

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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1715' : '#f4f6f5',
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
  const store = new Store(join(dataDir, 'wapp.db'));

  let scheduler: Scheduler | null = null;
  const whatsapp = new WhatsApp({
    authDir: join(dataDir, 'auth'),
    store,
    emit: (event) => {
      send(event);
      if (event.type === 'connection' && event.state.status === 'open') scheduler?.poke();
    },
    onIncoming: (message, chatName) => {
      if (mainWindow?.isFocused() || !Notification.isSupported()) return;
      const notification = new Notification({
        title: chatName,
        body: message.body || 'New message',
      });
      notification.on('click', showWindow);
      notification.show();
    },
  });
  scheduler = new Scheduler(store, whatsapp, () => send({ type: 'scheduled-changed' }));

  registerIpc({
    store,
    whatsapp,
    scheduler,
    onScheduledChanged: () => send({ type: 'scheduled-changed' }),
  });

  void app.whenReady().then(() => {
    createWindow(!startedHidden());
    createTray();
    void whatsapp.start();
    scheduler?.start();

    app.on('activate', showWindow);
  });

  app.on('before-quit', () => {
    quitting = true;
    scheduler?.stop();
    whatsapp.stop();
  });

  // Keep running in the tray when every window is closed.
  app.on('window-all-closed', () => undefined);
}

main();
