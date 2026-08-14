// ============================================================================
// AlAqsa — DB helper utilities shared by repositories.
// ============================================================================

import { randomUUID } from 'node:crypto';

export function uuid(): string {
  return randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

/** Parse a JSON column safely with a fallback. */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toBool(v: unknown): boolean {
  return v === 1 || v === true || v === '1';
}

export function fromBool(v: boolean | undefined): number {
  return v ? 1 : 0;
}

/** Generate the next human-friendly client code, e.g. ALQ-0007. */
export function nextClientCode(existingMax: number): string {
  const n = existingMax + 1;
  return `ALQ-${String(n).padStart(4, '0')}`;
}
