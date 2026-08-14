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
  passwordWrap: Wrapped; // DEK wrapped by password-derived KEK
  recoveryWrap: Wrapped; // DEK wrapped by recovery-key-derived KEK
  recoveryFingerprint: string; // sha256 of the recovery key (to detect revocation)
  createdAt: string;
}

export class SecureStore {
  private dek: Buffer | null = null;
  private file: SecureFile | null = null;

  constructor() {
    this.file = readJson<SecureFile | null>(secureStorePath(), null);
  }

  isInitialized(): boolean {
    return !!this.file && fs.existsSync(secureStorePath());
  }

  isUnlocked(): boolean {
    return this.dek !== null;
  }

  /** First-run: create a fresh DEK, wrap it with password + a new recovery key. */
  firstRunSetup(masterPassword: string): { recoveryKey: string } {
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

  unlockWithPassword(password: string): boolean {
    if (!this.file) throw new Error('NOT_INITIALIZED');
    try {
      this.dek = unwrapDek(this.file.passwordWrap, password);
      return true;
    } catch {
      return false;
    }
  }

  unlockWithRecovery(recoveryKey: string): boolean {
    if (!this.file) throw new Error('NOT_INITIALIZED');
    try {
      this.dek = unwrapDek(this.file.recoveryWrap, normalizeRecoveryKey(recoveryKey));
      return true;
    } catch {
      return false;
    }
  }

  /** Change the master password. Requires an unlocked DEK. */
  changePassword(oldPassword: string, newPassword: string): boolean {
    if (!this.file) throw new Error('NOT_INITIALIZED');
    // Verify old password by unwrapping.
    let dek: Buffer;
    try {
      dek = unwrapDek(this.file.passwordWrap, oldPassword);
    } catch {
      return false;
    }
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
