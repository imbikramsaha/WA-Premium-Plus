// Window requests for exports and insights.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dialog, shell } from 'electron';
import type { ExportFormat } from '../shared/types';
import type { Account } from './account';
import { computeInsights } from './analytics';
import { exportChat, safeFileName } from './export';

type Handle = (channel: string, fn: (account: Account, ...args: unknown[]) => unknown) => void;

const FORMATS: ExportFormat[] = ['txt', 'html', 'csv', 'json'];
const FILTERS: Record<ExportFormat, Electron.FileFilter> = {
  txt: { name: 'Text', extensions: ['txt'] },
  html: { name: 'Web page', extensions: ['html'] },
  csv: { name: 'CSV (Excel, Google Sheets)', extensions: ['csv'] },
  json: { name: 'JSON', extensions: ['json'] },
};

function parseFormat(value: unknown): ExportFormat {
  return FORMATS.includes(value as ExportFormat) ? (value as ExportFormat) : 'txt';
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function chooseFolder(title: string): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({ title, buttonLabel: 'Export here', properties: ['openDirectory', 'createDirectory'] });
  return canceled || !filePaths[0] ? null : filePaths[0];
}

export function registerDataIpc(handle: Handle): void {
  handle('exportChat', async (a, chatId, format, includeMedia) => {
    if (typeof chatId !== 'string') throw new Error('Choose a chat.');
    const fmt = parseFormat(format);
    const name = safeFileName(a.store.chatName(chatId));
    const me = a.whatsapp.connection.me?.name ?? 'You';
    let target: string;
    if (includeMedia) {
      const folder = await chooseFolder('Choose where to save the export');
      if (!folder) return null;
      target = join(folder, `${name} (WhatsApp chat ${today()})`);
      await mkdir(target, { recursive: true });
    } else {
      const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: `${name}.${fmt}`, filters: [FILTERS[fmt]] });
      if (canceled || !filePath) return null;
      target = filePath;
    }
    const result = await exportChat(a.store, a.mediaDir, me, chatId, fmt, Boolean(includeMedia), target);
    shell.showItemInFolder(result.path);
    return result.path;
  });

  handle('exportAllChats', async (a, format, includeMedia) => {
    const fmt = parseFormat(format);
    const folder = await chooseFolder('Choose where to save your chats');
    if (!folder) return null;
    const root = join(folder, `WhatsApp chats ${today()}`);
    await mkdir(root, { recursive: true });
    const me = a.whatsapp.connection.me?.name ?? 'You';
    const used = new Set<string>();
    for (const chat of a.store.listChats()) {
      if (!chat.lastMessage) continue;
      let name = safeFileName(chat.name);
      for (let i = 2; used.has(name.toLowerCase()); i++) name = `${safeFileName(chat.name)} (${i})`;
      used.add(name.toLowerCase());
      if (includeMedia) {
        const dir = join(root, name);
        await mkdir(dir, { recursive: true });
        await exportChat(a.store, a.mediaDir, me, chat.id, fmt, true, dir);
      } else {
        await exportChat(a.store, a.mediaDir, me, chat.id, fmt, false, join(root, `${name}.${fmt}`));
      }
    }
    await shell.openPath(root);
    return root;
  });

  handle('saveTextFile', async (_a, defaultName, content) => {
    if (typeof content !== 'string') throw new Error('Nothing to save.');
    const name = typeof defaultName === 'string' ? defaultName : 'export.csv';
    const ext = name.split('.').pop() ?? 'txt';
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (canceled || !filePath) return null;
    await writeFile(filePath, content, 'utf8');
    shell.showItemInFolder(filePath);
    return filePath;
  });

  handle('getInsights', (a, days) => {
    const n = typeof days === 'number' && [7, 30, 90, 365].includes(days) ? days : 30;
    return computeInsights(a.store, n);
  });
}
