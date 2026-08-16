// ============================================================================
// AlAqsa — Secure store: manages the master password, recovery key, and the
// Data Encryption Key (DEK) lifecycle. Persists only wrapped material + hashes;
// never the plaintext DEK, password, or recovery key.
// ============================================================================

import fs from 'node:fs';
import {
  Wrapped, wrapDek, unwrapDek, randomBytes, generateRecoveryKey,
  normalizeRecoveryKey, sha256, sqlcipherKey,
} from './crypto';
import { secureStorePath, readJson, writeJson } from '../storage/paths';

interface SecureFile {
  version: 1;
  passwordWrap: Wrapped; // DEK wrapped by the OWNER's master-password KEK
  /**
   * DEK wrapped by the DAILY password KEK.
   *
   * The shop has two secrets:
   *   - the master password, known only to the owner, which authorises
   *     sensitive operations (reset, change passwords, make this PC the host);
   *   - the daily password, which everyone in the shop uses to open and lock
   *     the app.
   *
   * Both have to be able to OPEN the database, because the password is what
   * decrypts it — so the daily password gets its own wrap of the very same DEK,
   * exactly like the recovery key does. What separates them is not what they
   * can decrypt but what they are allowed to authorise: only the master
   * password unlocks an owner session.
   *
   * Optional: installations created before the daily password existed, and
   * owners who never set one, simply do not have this wrap.
   */
  dailyWrap?: Wrapped;
  recoveryWrap: Wrapped; // DEK wrapped by recovery-key-derived KEK
  recoveryFingerprint: string; // sha256 of the recovery key (to detect revocation)
  createdAt: string;
}

/** How the database was opened in the current session. */
export type UnlockKind = 'master' | 'daily' | 'recovery';

export class SecureStore {
  private dek: Buffer | null = null;
  private file: SecureFile | null = null;
  private loaded = false;

  /**
   * Read the secure file lazily. Electron's `app.getPath` is only available
   * once the app is ready, so we must not touch it during module import.
   */
  private ensureLoaded(): void {
    if (this.loaded) return;
    this.file = readJson<SecureFile | null>(secureStorePath(), null);
    this.loaded = true;
  }

  isInitialized(): boolean {
    this.ensureLoaded();
    return !!this.file && fs.existsSync(secureStorePath());
  }

  isUnlocked(): boolean {
    return this.dek !== null;
  }

  /** First-run: create a fresh DEK, wrap it with password + a new recovery key. */
  firstRunSetup(masterPassword: string): { recoveryKey: string } {
    this.ensureLoaded();
    if (this.isInitialized()) throw new Error('ALREADY_INITIALIZED');
    const dek = randomBytes(32);
    const recoveryKey = generateRecoveryKey();
    const file: SecureFile = {
      version: 1,
      passwordWrap: wrapDek(dek, masterPassword),
      recoveryWrap: wrapDek(dek, normalizeRecoveryKey(recoveryKey)),
      recoveryFingerprint: sha256(normalizeRecoveryKey(recoveryKey)),
      createdAt: new Date().toISOString(),
    };
    writeJson(secureStorePath(), file);
    this.file = file;
    this.dek = dek;
    return { recoveryKey };
  }

  /**
   * Open the database with either the master or the daily password.
   *
   * Returns which one was used, so the caller can decide whether this session
   * is allowed to perform owner-only operations. Returns null when neither
   * matches. The master wrap is tried first so that, if the owner ever sets
   * both to the same text, the session is the more privileged one.
   */
  unlockWithPassword(password: string): UnlockKind | null {
    this.ensureLoaded();
    if (!this.file) throw new Error('NOT_INITIALIZED');
    try {
      this.dek = unwrapDek(this.file.passwordWrap, password);
      return 'master';
    } catch { /* not the master password — try the daily one */ }

    if (this.file.dailyWrap) {
      try {
        this.dek = unwrapDek(this.file.dailyWrap, password);
        return 'daily';
      } catch { /* neither */ }
    }
    return null;
  }

  unlockWithRecovery(recoveryKey: string): boolean {
    this.ensureLoaded();
    if (!this.file) throw new Error('NOT_INITIALIZED');
    try {
      this.dek = unwrapDek(this.file.recoveryWrap, normalizeRecoveryKey(recoveryKey));
      return true;
    } catch {
      return false;
    }
  }

  /** True once the owner has set a separate daily password. */
  hasDailyPassword(): boolean {
    this.ensureLoaded();
    return !!this.file?.dailyWrap;
  }

  /**
   * Set or replace the daily password. Authorised by the MASTER password, so
   * staff cannot rotate the lock the owner set. Wraps the same DEK, which is
   * what lets the daily password open the database at all.
   */
  setDailyPassword(masterPassword: string, dailyPassword: string): boolean {
    this.ensureLoaded();
    if (!this.file) throw new Error('NOT_INITIALIZED');
    let dek: Buffer;
    try {
      dek = unwrapDek(this.file.passwordWrap, masterPassword);
    } catch {
      return false;
    }
    this.file.dailyWrap = wrapDek(dek, dailyPassword);
    writeJson(secureStorePath(), this.file);
    return true;
  }

  /**
   * Remove the daily password, leaving the master password as the only way in.
   * Also authorised by the master password.
   */
  clearDailyPassword(masterPassword: string): boolean {
    this.ensureLoaded();
    if (!this.file) throw new Error('NOT_INITIALIZED');
    try {
      unwrapDek(this.file.passwordWrap, masterPassword);
    } catch {
      return false;
    }
    delete this.file.dailyWrap;
    writeJson(secureStorePath(), this.file);
    return true;
  }

  /** Verify the master password without changing the session. */
  verifyMasterPassword(password: string): boolean {
    this.ensureLoaded();
    if (!this.file) return false;
    try {
      unwrapDek(this.file.passwordWrap, password).fill(0);
      return true;
    } catch {
      return false;
    }
  }

  /** Change the master password. Requires an unlocked DEK. */
  changePassword(oldPassword: string, newPassword: string): boolean {
    this.ensureLoaded();
    if (!this.file) throw new Error('NOT_INITIALIZED');
    // Verify old password by unwrapping.
    let dek: Buffer;
    try {
      dek = unwrapDek(this.file.passwordWrap, oldPassword);
    } catch {
      return false;
    }
    // Only the master wrap is replaced. The daily and recovery wraps hold the
    // same DEK under their own keys, so they keep working untouched — changing
    // the owner's password must not lock the shop out of the daily lock.
    this.file.passwordWrap = wrapDek(dek, newPassword);
    writeJson(secureStorePath(), this.file);
    this.dek = dek;
    return true;
  }

  /**
   * Regenerate the recovery key. Revokes the previous one by replacing its wrap
   * and fingerprint. Requires the current password to authorize.
   */
  regenerateRecoveryKey(password: string): { recoveryKey: string } | null {
    this.ensureLoaded();
    if (!this.file) throw new Error('NOT_INITIALIZED');
    let dek: Buffer;
    try {
      dek = unwrapDek(this.file.passwordWrap, password);
    } catch {
      return null;
    }
    const recoveryKey = generateRecoveryKey();
    this.file.recoveryWrap = wrapDek(dek, normalizeRecoveryKey(recoveryKey));
    this.file.recoveryFingerprint = sha256(normalizeRecoveryKey(recoveryKey));
    writeJson(secureStorePath(), this.file);
    return { recoveryKey };
  }

  lock(): void {
    if (this.dek) this.dek.fill(0);
    this.dek = null;
  }

  /** Raw DEK — used to encrypt/decrypt the file store. */
  getDek(): Buffer {
    if (!this.dek) throw new Error('LOCKED');
    return this.dek;
  }

  /** SQLCipher hex key derived from the DEK. */
  getSqlcipherKey(): string {
    return sqlcipherKey(this.getDek());
  }
}
