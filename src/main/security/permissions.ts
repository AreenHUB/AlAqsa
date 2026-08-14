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
 * The signed-in user for this session. When no user has signed in (the common
 * single-operator case, where the master password IS the gate) we treat the
 * session as admin — otherwise the app would lock itself out of its own
 * settings on a fresh install.
 */
let currentRole: Role | null = null;
let currentUserId: string | null = null;

export function setCurrentUser(id: string | null, role: Role | null): void {
  currentUserId = id;
  currentRole = role;
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

export function getCurrentRole(): Role {
  return currentRole ?? 'admin';
}

export function assertAllowed(channel: string): void {
  const cap = capabilityFor(channel);
  if (!roleHas(getCurrentRole(), cap)) {
    throw new Error('FORBIDDEN');
  }
}
