// ============================================================================
// AlAqsa — Encrypted file store. Documents, photos and signatures are encrypted
// with the same DEK that protects the database and written under files/ as
// opaque blobs. The DB stores only the relative path + metadata.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { filesDir, ensureDir } from './paths';
import { encryptBuffer, decryptBuffer } from '../security/crypto';
import { mediaRepo } from '../db/repositories/miscRepo';
import type { MediaRef } from '@shared/types';

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.txt': 'text/plain',
};

export function guessMime(fileName: string): string {
  return MIME_BY_EXT[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

/** Shard by first 2 hex chars to avoid one huge directory. */
function storedRelPath(id: string): string {
  return path.join(id.slice(0, 2), `${id}.bin`);
}

/** Import a file from disk into the encrypted store; returns its MediaRef. */
export function importFile(sourcePath: string, dek: Buffer, originalName?: string): MediaRef {
  const plain = fs.readFileSync(sourcePath);
  const fileName = originalName ?? path.basename(sourcePath);
  return writeEncrypted(plain, fileName, dek);
}

/** Store an in-memory buffer (e.g. a signature PNG) into the encrypted store. */
export function writeEncrypted(plain: Buffer, fileName: string, dek: Buffer): MediaRef {
  const media = mediaRepo.insert({
    fileName,
    storedPath: '', // filled below once we know the id
    mimeType: guessMime(fileName),
    sizeBytes: plain.length,
  });
  const rel = storedRelPath(media.id);
  const abs = path.join(filesDir(), rel);
  ensureDir(path.dirname(abs));
  fs.writeFileSync(abs, encryptBuffer(plain, dek));
  // Persist the real relative path now that the id exists.
  const { getDb } = require('../db/database') as typeof import('../db/database');
  getDb().prepare('UPDATE media SET stored_path = ? WHERE id = ?').run(rel, media.id);
  return { ...media, storedPath: rel };
}

/** Decrypt a stored file back into memory. */
export function readDecrypted(media: MediaRef, dek: Buffer): Buffer {
  const abs = path.join(filesDir(), media.storedPath);
  const blob = fs.readFileSync(abs);
  return decryptBuffer(blob, dek);
}

/**
 * Decrypt a stored file to a temporary location so the OS can open it with the
 * default application. The temp copy is deleted when the app quits.
 */
export function materializeToTemp(media: MediaRef, dek: Buffer, tempDir: string): string {
  ensureDir(tempDir);
  const out = path.join(tempDir, media.fileName);
  fs.writeFileSync(out, readDecrypted(media, dek));
  return out;
}

export function deleteStored(media: MediaRef): void {
  try {
    const abs = path.join(filesDir(), media.storedPath);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch { /* best effort */ }
}

/** Parse a data: URL (used for canvas signatures) into a Buffer. */
export function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new Error('INVALID_DATA_URL');
  return { buffer: Buffer.from(m[2], 'base64'), mime: m[1] };
}
