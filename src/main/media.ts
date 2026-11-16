// Media files: working out file types, downloading message media, and keeping
// copies of files attached to scheduled messages.

import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { AttachmentKind } from '../shared/types';
import type { Attachment } from './store';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.3gp': 'video/3gpp',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.amr': 'audio/amr',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/amr': '.amr',
  'application/pdf': '.pdf',
};

export function mimeForFile(name: string): string {
  return MIME_BY_EXT[extname(name).toLowerCase()] ?? 'application/octet-stream';
}

export function extensionFor(mimetype: string | undefined, fileName?: string): string {
  const fromName = fileName ? extname(fileName) : '';
  if (fromName && fromName.length <= 6) return fromName.toLowerCase();
  const base = (mimetype ?? '').split(';')[0]!.trim();
  return EXT_BY_MIME[base] ?? '.bin';
}

/**
 * How a file is sent. WhatsApp only plays certain formats inline; anything else goes as a
 * document so the recipient can still open it.
 */
export function kindForMime(mimetype: string): AttachmentKind {
  if (mimetype === 'image/jpeg' || mimetype === 'image/png') return 'image';
  if (mimetype === 'video/mp4' || mimetype === 'video/3gpp') return 'video';
  if (['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/amr'].includes(mimetype)) return 'audio';
  return 'document';
}

/** 100 MB: WhatsApp's limit for media; larger files must go as documents (up to 2 GB). */
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024 * 1024;

export async function describeFile(path: string, name = basename(path), mimetype = mimeForFile(name)) {
  const { size } = await stat(path);
  let kind = kindForMime(mimetype);
  if (kind !== 'document' && size > MAX_MEDIA_BYTES) kind = 'document';
  if (size > MAX_DOCUMENT_BYTES) throw new Error('Files larger than 2 GB cannot be sent on WhatsApp.');
  return { name, mimetype, kind, size };
}

/** Copies a file into the app's attachments folder so a scheduled message still has it later. */
export async function keepAttachment(sourcePath: string, attachmentsDir: string): Promise<Attachment> {
  const info = await describeFile(sourcePath);
  await mkdir(attachmentsDir, { recursive: true });
  const target = join(attachmentsDir, `${randomUUID()}${extname(info.name).toLowerCase()}`);
  await copyFile(sourcePath, target);
  return { ...info, path: target };
}

/** Writes pasted or recorded bytes to a temporary file and returns its path. */
export async function writeTempFile(dir: string, name: string, data: Uint8Array): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${randomUUID()}${extname(name) || '.bin'}`);
  await writeFile(path, data);
  return path;
}

/** Stable file name for a downloaded message's media. */
export function mediaFileName(chatId: string, messageId: string, mimetype?: string, fileName?: string): string {
  const hash = createHash('sha1').update(`${chatId}/${messageId}`).digest('hex').slice(0, 20);
  return `${hash}${extensionFor(mimetype, fileName)}`;
}
