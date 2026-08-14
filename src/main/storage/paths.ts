// ============================================================================
// AlAqsa — Filesystem paths. Data lives OUTSIDE the app dir so that uninstall
// or update never destroys client data. On Windows this resolves to
//   %AppData%\Roaming\AlAqsa\
// ============================================================================

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

/** Root data directory (created if missing). */
export function dataDir(): string {
  // app.getPath('userData') already points at %AppData%/Roaming/<appName>.
  const dir = app.getPath('userData');
  ensureDir(dir);
  return dir;
}

export function dbPath(): string {
  return path.join(dataDir(), 'alaqsa.db');
}

/** Encrypted-at-rest file store for documents, photos, signatures. */
export function filesDir(): string {
  const dir = path.join(dataDir(), 'files');
  ensureDir(dir);
  return dir;
}

export function backupsDir(): string {
  const dir = path.join(dataDir(), 'backups');
  ensureDir(dir);
  return dir;
}

export function reportsDir(): string {
  const dir = path.join(dataDir(), 'reports');
  ensureDir(dir);
  return dir;
}

/** Where non-secret local config (language, theme, network mode) is stored. */
export function configPath(): string {
  return path.join(dataDir(), 'config.json');
}

/** Where the (hashed) security material is stored — never the plaintext key. */
export function secureStorePath(): string {
  return path.join(dataDir(), 'secure.json');
}

/** Where the signed license blob is stored. */
export function licensePath(): string {
  return path.join(dataDir(), 'license.lic');
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf-8');
}
