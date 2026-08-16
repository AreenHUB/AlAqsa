// ============================================================================
// AlAqsa — Role-based access control.
//
// Roles are enforced in the MAIN process, on the IPC boundary. Hiding a button
// in the renderer is cosmetic — a determined user could still call the channel,
// so the authoritative check has to live here.
//
//   admin      full access, including settings, users and destructive actions
//   technician operational data (clients, branches, devices, visits); no money
//   accountant financial data (invoices, AMC) and read-only client info
//   viewer     read-only, and never sees financial data
// ============================================================================

import type { Role } from '@shared/types';
import { USER_ACCOUNTS_ENABLED, OWNER_ONLY_CHANNELS } from '@shared/featureFlags';

/** Coarse capability buckets a channel can require. */
export type Capability =
  | 'read'            // any signed-in role
  | 'write:ops'       // clients, branches, devices, visits, documents…
  | 'write:finance'   // invoices, AMC contracts
  | 'read:finance'    // seeing money at all
  | 'admin';          // settings, users, backups, reset, licence, network

const MATRIX: Record<Role, Capability[]> = {
  admin: ['read', 'write:ops', 'write:finance', 'read:finance', 'admin'],
  technician: ['read', 'write:ops'],
  accountant: ['read', 'read:finance', 'write:finance'],
  viewer: ['read'],
};

export function roleHas(role: Role, cap: Capability): boolean {
  return MATRIX[role]?.includes(cap) ?? false;
}

/**
 * Which capability a channel needs. Anything not listed defaults to 'read',
 * and every mutating channel is listed explicitly below.
 */
const CHANNEL_CAPS: Record<string, Capability> = {
  // --- operations (write) ---
  'clients:create': 'write:ops',
  'clients:update': 'write:ops',
  'clients:remove': 'write:ops',
  'clients:saveContacts': 'write:ops',
  'branches:create': 'write:ops',
  'branches:update': 'write:ops',
  'branches:remove': 'write:ops',
  'devices:create': 'write:ops',
  'devices:update': 'write:ops',
  'devices:remove': 'write:ops',
  'visits:create': 'write:ops',
  'visits:update': 'write:ops',
  'visits:remove': 'write:ops',
  'documents:add': 'write:ops',
  'documents:remove': 'write:ops',
  'licenses:save': 'write:ops',
  'licenses:remove': 'write:ops',
  'inventory:upsert': 'write:ops',
  'inventory:remove': 'write:ops',
  'inventory:importExcel': 'write:ops',
  'stock:upsert': 'write:ops',
  'stock:remove': 'write:ops',
  'stock:returnToStock': 'write:ops',
  'exports:remove': 'write:ops',
  'reminders:save': 'write:ops',
  'reminders:markDone': 'write:ops',
  'reminders:remove': 'write:ops',
  'notes:save': 'write:ops',
  'notes:remove': 'write:ops',
  'staff:save': 'write:ops',
  'staff:remove': 'write:ops',
  'files:saveDataUrl': 'write:ops',
  'files:importDocument': 'write:ops',

  // --- finance ---
  'invoices:listByClient': 'read:finance',
  'invoices:save': 'write:finance',
  'invoices:remove': 'write:finance',
  'amc:listByClient': 'read:finance',
  'amc:save': 'write:finance',
  'amc:remove': 'write:finance',
  'reports:invoicePdf': 'read:finance',

  // --- admin only ---
  'auth:changePassword': 'admin',
  'auth:regenerateRecoveryKey': 'admin',
  'users:list': 'admin',
  'users:save': 'admin',
  'users:remove': 'admin',
  'statusLabels:save': 'admin',
  'statusLabels:remove': 'admin',
  'settings:set': 'admin',
  'backup:now': 'admin',
  'backup:exportEncrypted': 'admin',
  'backup:restore': 'admin',
  'backup:factoryReset': 'admin',
  'network:setHost': 'admin',
  'network:connect': 'admin',
  'network:disconnect': 'admin',
  // NOTE: 'license:activate' is deliberately NOT listed here. It is exempt
  // from role checks (see UNGATED in registry.ts) because a licence must be
  // activatable before anyone can sign in — the app does not open without one.
  'audit:recent': 'admin',
  'app:seedDemoData': 'admin',
  'reports:exportAllExcel': 'admin',
};

export function capabilityFor(channel: string): Capability {
  return CHANNEL_CAPS[channel] ?? 'read';
}

/**
 * The identity of the current session.
 *
 * ── Current model (user accounts are hidden) ───────────────────────────────
 * The shop uses two passwords, and nothing else:
 *
 *  1. THE DAILY PASSWORD — everyone in the shop knows it. It opens and locks
 *     the app and grants full use of the day-to-day work: clients, visits,
 *     devices, invoices, reports.
 *
 *  2. THE MASTER PASSWORD — the owner alone knows it. It also opens the app,
 *     and additionally authorises the sensitive operations: factory reset,
 *     changing either password, making this PC the network host, backups and
 *     the licence.
 *
 * So the question this module answers is no longer "which role is this?" but
 * "was the app opened by the owner?".
 *
 * ── The role machinery below is intentionally still here ───────────────────
 * MATRIX, roleHas and CHANNEL_CAPS are kept complete and working so that user
 * accounts can be switched back on later without rebuilding them. They are
 * simply not consulted while USER_ACCOUNTS_ENABLED is false.
 */
let currentRole: Role | null = null;
let currentUserId: string | null = null;

/** True once the master password has been entered in this session. */
let ownerAuthenticated = false;

/**
 * True once the app has been opened with EITHER password.
 *
 * Tracked separately from `ownerAuthenticated`: a daily-password session is a
 * fully authenticated user of the shop, it just may not perform owner-only
 * operations.
 */
let unlocked = false;

export function setOwnerAuthenticated(value: boolean): void {
  ownerAuthenticated = value;
  if (value) {
    unlocked = true;
    // Unlocking starts as the owner; a staff sign-in replaces this.
    currentUserId = null;
    currentRole = 'admin';
  }
}

/**
 * Record that the app was opened with the shared DAILY password.
 *
 * This is a real, authenticated session — the holder may do all ordinary shop
 * work — but it is not the owner, so owner-only channels stay closed.
 */
export function setDailyAuthenticated(): void {
  unlocked = true;
  ownerAuthenticated = false;
  currentUserId = null;
  // Full day-to-day access; 'admin' here means "not restricted by role",
  // which is meaningful only if roles are ever switched back on. Owner-only
  // operations are gated by ownerAuthenticated, not by this.
  currentRole = 'admin';
}

export function isOwnerSession(): boolean {
  if (!USER_ACCOUNTS_ENABLED) return ownerAuthenticated;
  return ownerAuthenticated && currentUserId === null;
}

/** True when the app has been opened with either password. */
export function isUnlockedSession(): boolean {
  return unlocked;
}

export function setCurrentUser(id: string | null, role: Role | null): void {
  currentUserId = id;
  currentRole = role;
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

/** The active role, or null when the session is not authenticated at all. */
export function getCurrentRole(): Role | null {
  return currentRole;
}

/** Drop any staff identity and return to the owner session. */
export function returnToOwner(): void {
  currentUserId = null;
  currentRole = ownerAuthenticated ? 'admin' : null;
}

/** Clear everything (called when the app locks). */
export function clearSession(): void {
  ownerAuthenticated = false;
  unlocked = false;
  currentUserId = null;
  currentRole = null;
}

export function assertAllowed(channel: string): void {
  if (!USER_ACCOUNTS_ENABLED) {
    // Two-password model: the app must be open, and owner-only operations
    // additionally require that it was opened with the master password.
    if (!unlocked) throw new Error('NOT_SIGNED_IN');
    if (OWNER_ONLY_CHANNELS.includes(channel) && !ownerAuthenticated) {
      throw new Error('OWNER_PASSWORD_REQUIRED');
    }
    return;
  }

  const role = getCurrentRole();
  if (!role) throw new Error('NOT_SIGNED_IN');
  if (!roleHas(role, capabilityFor(channel))) {
    throw new Error('FORBIDDEN');
  }
}

/**
 * Refuse a channel that belongs to a disabled feature.
 *
 * Hiding the UI is not enough: the IPC channel still exists, so anything that
 * can reach the bridge could still call it. Handlers for flagged-off features
 * call this first.
 */
export function assertFeatureEnabled(enabled: boolean): void {
  if (!enabled) throw new Error('FEATURE_DISABLED');
}
