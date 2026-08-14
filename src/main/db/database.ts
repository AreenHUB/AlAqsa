// ============================================================================
// AlAqsa — Encrypted database connection + migration runner.
// ============================================================================

import Database from 'better-sqlite3-multiple-ciphers';
import { randomUUID } from 'node:crypto';
import { dbPath } from '../storage/paths';
import { MIGRATIONS } from './schema';
import { SYSTEM_STATUS_LABELS } from '@shared/constants';

export type DB = Database.Database;

let db: DB | null = null;

/** Open (or create) the encrypted DB with the SQLCipher hex key. */
export function openDatabase(sqlcipherHexKey: string): DB {
  if (db) return db;
  const instance = new Database(dbPath());
  instance.pragma(`cipher='sqlcipher'`);
  instance.pragma(`key="x'${sqlcipherHexKey}'"`);
  // Fail fast if the key is wrong: this query throws on a bad key.
  instance.exec('SELECT count(*) FROM sqlite_master;');
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  instance.pragma('synchronous = NORMAL');
  db = instance;
  runMigrations(instance);
  seedDefaults(instance);
  return instance;
}

export function getDb(): DB {
  if (!db) throw new Error('DB_NOT_OPEN');
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function runMigrations(instance: DB): void {
  const current = (instance.pragma('user_version', { simple: true }) as number) || 0;
  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    const tx = instance.transaction(() => {
      instance.exec(m.up);
      instance.pragma(`user_version = ${m.version}`);
    });
    tx();
  }
}

function seedDefaults(instance: DB): void {
  const count = instance.prepare('SELECT count(*) AS c FROM status_labels').get() as { c: number };
  if (count.c === 0) {
    const ins = instance.prepare(
      'INSERT INTO status_labels (id, name_ar, name_en, color, is_system, sort) VALUES (?,?,?,?,1,?)',
    );
    SYSTEM_STATUS_LABELS.forEach((l, i) => ins.run(randomUUID(), l.name_ar, l.name_en, l.color, i));
  }
}

/** True if a DB file exists on disk (used to distinguish first run). */
export function databaseExists(): boolean {
  const fs = require('node:fs') as typeof import('node:fs');
  return fs.existsSync(dbPath());
}
