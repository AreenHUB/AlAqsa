// ============================================================================
// AlAqsa — Cryptographic primitives.
//
// Design:
//  - A random 256-bit Data Encryption Key (DEK) encrypts the SQLCipher DB and
//    the file store. The DEK never touches disk in plaintext.
//  - The DEK is wrapped (AES-256-GCM) by a Key Encryption Key (KEK) derived
//    from the user's master password via scrypt.
//  - A second, independent wrap of the DEK is made with a KEK derived from a
//    randomly generated Recovery Key (shown to the user ONCE). This is the
//    revocable "central" access path — regenerating it re-wraps the DEK with a
//    fresh recovery key and discards the old wrap.
//
// This gives the user a guaranteed way back in (recovery key) WITHOUT a fixed
// backdoor: rotating the password or the recovery key never loses data because
// the underlying DEK is stable, only its wraps change.
// ============================================================================

import crypto from 'node:crypto';

const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, keylen: 32 } as const;

export function randomBytes(n: number): Buffer {
  return crypto.randomBytes(n);
}

/** Derive a 32-byte key from a secret + salt using scrypt. */
export function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.scryptSync(secret, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: 256 * 1024 * 1024,
  });
}

export interface Wrapped {
  salt: string; // base64
  iv: string; // base64
  tag: string; // base64
  ct: string; // base64  (wrapped DEK)
}

/** Wrap (encrypt) the DEK with a KEK derived from `secret`. */
export function wrapDek(dek: Buffer, secret: string): Wrapped {
  const salt = crypto.randomBytes(16);
  const kek = deriveKey(secret, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
  const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  };
}

/** Unwrap (decrypt) the DEK. Throws if the secret is wrong (auth tag fails). */
export function unwrapDek(w: Wrapped, secret: string): Buffer {
  const salt = Buffer.from(w.salt, 'base64');
  const kek = deriveKey(secret, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', kek, Buffer.from(w.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(w.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(w.ct, 'base64')), decipher.final()]);
}

/**
 * Generate a human-friendly recovery key, grouped for readability, e.g.
 * ALQ-7Q2F-9KX3-M4TB-8WPD-2R6H. ~130 bits of entropy from the alphabet.
 */
export function generateRecoveryKey(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusable chars
  const groups = 5;
  const perGroup = 4;
  const parts: string[] = [];
  const bytes = crypto.randomBytes(groups * perGroup);
  let idx = 0;
  for (let g = 0; g < groups; g++) {
    let s = '';
    for (let c = 0; c < perGroup; c++) s += alphabet[bytes[idx++] % alphabet.length];
    parts.push(s);
  }
  return 'ALQ-' + parts.join('-');
}

export function normalizeRecoveryKey(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

/** Constant-time compare of two hex/utf strings. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** SHA-256 hex digest. */
export function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** Encrypt an arbitrary buffer (for the file store) with the DEK. */
export function encryptBuffer(plain: Buffer, dek: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  // layout: [12 iv][16 tag][ct]
  return Buffer.concat([iv, tag, ct]);
}

export function decryptBuffer(blob: Buffer, dek: Buffer): Buffer {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Derive the SQLCipher hex key from the DEK (SQLCipher wants a passphrase/key). */
export function sqlcipherKey(dek: Buffer): string {
  // Use raw key form: x'<64 hex>' — 32 bytes = 256-bit key.
  return dek.toString('hex');
}
