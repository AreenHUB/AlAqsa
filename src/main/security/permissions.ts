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
  'license:activate': 'admin',
  'audit:recent': 'admin',
  'app:seedDemoData': 'admin',
  'reports:exportAllExcel': 'admin',
};

export function capabilityFor(channel: string): Capability {
  return CHANNEL_CAPS[channel] ?? 'read';
}

/**
 * The signed-in identity for this session.
 *
 * There are exactly two ways to obtain a role:
 *
 *  1. THE OWNER — proves it by entering the master password, which is the key
 *     that decrypts the database. Nobody else can open the app at all, so
 *     whoever holds it is by definition the owner and gets 'admin'. Asking
 *     them for a second, separate password would add friction without adding
 *     security: they already hold the strongest secret in the system.
 *
 *  2. A STAFF MEMBER — picks their name and enters THEIR OWN password. They
 *     never need the master password; the owner unlocks the machine once and
 *     staff sign in and out on top of that.
 *
 * SECURITY: a session that has done neither has NO role. An earlier version
 * defaulted to 'admin' for unauthenticated sessions, which let anyone skip the
 * sign-in screen and act as an administrator.
 */
let currentRole: Role | null = null;
let currentUserId: string | null = null;

/** True once the master password has been entered in this session. */
let ownerAuthenticated = false;

export function setOwnerAuthenticated(value: boolean): void {
  ownerAuthenticated = value;
  if (value) {
    // Unlocking starts as the owner; a staff sign-in replaces this.
    currentUserId = null;
    currentRole = 'admin';
  }
}

export function isOwnerSession(): boolean {
  return ownerAuthenticated && currentUserId === null;
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
  currentUserId = null;
  currentRole = null;
}

export function assertAllowed(channel: string): void {
  const role = getCurrentRole();
  if (!role) throw new Error('NOT_SIGNED_IN');
  if (!roleHas(role, capabilityFor(channel))) {
    throw new Error('FORBIDDEN');
  }
}
