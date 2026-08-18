// ============================================================================
// AlAqsa — IPC handler registration.
//
// Every handler returns Result<T> so the renderer never sees a raw throw.
// Handlers that touch data require an unlocked DB and a valid license.
// ============================================================================

import { ipcMain, dialog, shell, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { AppContext } from '../main';
import { loadConfig, saveConfig } from '../main';
import type { Result } from '@shared/ipc';
import { openDatabase, getDb, closeDatabase } from '../db/database';
import { clientsRepo } from '../db/repositories/clientsRepo';
import { branchesRepo } from '../db/repositories/branchesRepo';
import { devicesRepo } from '../db/repositories/devicesRepo';
import { visitsRepo } from '../db/repositories/visitsRepo';
import {
  documentsRepo, camLicenseRepo, inventoryRepo, amcRepo, invoicesRepo,
  remindersRepo, statusLabelsRepo, settingsRepo, auditRepo, searchRepo,
  dashboardRepo, mediaRepo, stockUnitsRepo, exportsRepo,
} from '../db/repositories/miscRepo';
import {
  dayJobsRepo, requirementTemplatesRepo, requirementCasesRepo, quotationsRepo,
} from '../db/repositories/workRepo';
import { importFile, materializeToTemp, dataUrlToBuffer, writeEncrypted, deleteStored } from '../storage/fileStore';
import { dataDir, filesDir, backupsDir, reportsDir, secureStorePath, dbPath } from '../storage/paths';
import { APP_NAME, APP_VERSION, AUTHOR } from '@shared/constants';
import { seedDemoData } from '../services/demoData';
import { staffRepo, notesRepo } from '../db/repositories/staffRepo';
import {
  assertAllowed, setCurrentUser, getCurrentRole, getCurrentUserId,
  setOwnerAuthenticated, setDailyAuthenticated, returnToOwner, clearSession,
  isOwnerSession, isUnlockedSession, assertFeatureEnabled,
} from '../security/permissions';
import { USER_ACCOUNTS_ENABLED } from '@shared/featureFlags';
import {
  generateVisitPdf, generateAgreementPdf, generateInvoicePdf,
  generateQuotationPdf, generateDaySheetPdf,
} from '../services/pdfService';
import { exportClientExcel, exportAllExcel, importInventoryExcel } from '../services/excelService';
import { shareViaWhatsApp, shareTextViaWhatsApp, printFile } from '../services/shareService';
import { deviceQrDataUrl } from '../services/qrService';
import { networkService } from '../services/networkService';

const ok = <T>(data: T): Result<T> => ({ ok: true, data });

/**
 * Turn an exception into something a shop owner can act on.
 *
 * Raw messages (module stacks, SQLite errors, filesystem paths) are logged for
 * diagnosis but never returned verbatim: a short stable `code` is sent instead
 * and the renderer renders the message in the user's language.
 */
function classifyError(e: unknown): { code: string; error: string } {
  const raw = e instanceof Error ? e.message : String(e);

  // Known, expected conditions keep their identifiers.
  const known = [
    'LOCKED', 'FORBIDDEN', 'LICENSE_INVALID', 'NOT_INITIALIZED',
    'ALREADY_INITIALIZED', 'WRONG_PASSWORD', 'WRONG_RECOVERY_KEY',
    'PASSWORD_TOO_SHORT', 'NOT_FOUND', 'DATA_EXISTS', 'CANCELLED',
    'NO_LOCATION', 'FILE_NOT_FOUND', 'INVALID_LICENSE',
    'VISIT_NOT_FOUND', 'CLIENT_NOT_FOUND', 'INVOICE_NOT_FOUND',
    'ARABIC_FONTS_NOT_FOUND', 'NO_SHEET', 'NO_HEADER_ROW', 'INVALID_DATA_URL',
    'NOT_SIGNED_IN', 'USERNAME_TAKEN', 'USERNAME_REQUIRED',
    'PASSWORD_REQUIRED', 'USER_NOT_FOUND', 'USER_HAS_NO_PASSWORD',
    'CANNOT_REMOVE_LAST_ADMIN',
    'OWNER_PASSWORD_REQUIRED', 'DAILY_MUST_DIFFER', 'FEATURE_DISABLED',
    'ALREADY_INVOICED', 'NO_PDF_VIEWER',
  ];
  if (known.includes(raw)) return { code: raw, error: raw };

  // Everything else is an internal fault: log the detail, return a code.
  console.error('[AlAqsa] internal error:', raw);
  if (/Cannot find module|MODULE_NOT_FOUND/.test(raw)) {
    return { code: 'REPORT_ENGINE_MISSING', error: 'REPORT_ENGINE_MISSING' };
  }
  if (/ENOENT|EACCES|EPERM|EBUSY/.test(raw)) {
    return { code: 'FILE_ACCESS_FAILED', error: 'FILE_ACCESS_FAILED' };
  }
  if (/SQLITE|database|no such table/i.test(raw)) {
    return { code: 'DATABASE_ERROR', error: 'DATABASE_ERROR' };
  }
  return { code: 'INTERNAL_ERROR', error: 'INTERNAL_ERROR' };
}

const err = (e: unknown): Result<never> => {
  const { code, error } = classifyError(e);
  return { ok: false, error, code };
};

/**
 * Wrap a handler with uniform error handling and a role check.
 *
 * The permission check happens here rather than in the renderer: hiding a
 * button is only cosmetic, so this boundary is the authoritative one.
 * Auth/licence channels opt out because they must work before a role exists.
 */
const UNGATED = new Set([
  'auth:status', 'auth:unlock', 'auth:unlockWithRecovery',
  'auth:firstRunSetup', 'auth:lock', 'app:about',
  'settings:setLanguage', 'settings:setTheme', 'network:getMode',
  'auth:listUsers', 'auth:signIn', 'auth:signOut', 'auth:currentUser',
  // Describing the session, and proving ownership, must work before any
  // owner-gated channel will pass — otherwise the owner could never elevate.
  // 'auth:elevate' verifies the master password itself before granting it.
  'auth:sessionInfo', 'auth:elevate', 'auth:dropOwner',
  // Licensing must work BEFORE anyone can be authenticated: with no valid
  // licence the app never opens, so requiring a role to activate one is a
  // deadlock — the licence screen could never submit a key. Activation is
  // safe to leave open because a key is only accepted if it carries a valid
  // signature from the developer's private key.
  'license:state', 'license:activate',
]);

function handle<T>(channel: string, fn: (...args: any[]) => T | Promise<T>): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      if (!UNGATED.has(channel)) assertAllowed(channel);
      return ok(await fn(...args));
    } catch (e) {
      return err(e);
    }
  });
}

/** Guard: data handlers require an unlocked store. */
function requireUnlocked(ctx: AppContext): void {
  if (!ctx.secure.isUnlocked()) throw new Error('LOCKED');
  const state = ctx.license.state();
  if (state.status === 'expired' || state.status === 'revoked' || state.status === 'missing') {
    throw new Error('LICENSE_INVALID');
  }
}

function notifyDataChanged(ctx: AppContext, entity: string): void {
  ctx.mainWindow?.webContents.send('event:data-changed', entity);
}

/**
 * Re-derive a product's quantity from the units still in the shop.
 *
 * Quantity is never adjusted by arithmetic (`qty - 1`): counting the units is
 * the one calculation that cannot drift out of step with reality after a
 * re-import, a deleted device, or a unit returned to stock.
 */
function syncInventoryQuantity(inventoryItemId?: string): void {
  if (!inventoryItemId) return;
  const db = getDb();
  const { c } = db.prepare(
    "SELECT count(*) AS c FROM stock_units WHERE inventory_item_id = ? AND status = 'in_stock'",
  ).get(inventoryItemId) as { c: number };
  db.prepare('UPDATE inventory SET quantity = ? WHERE id = ?').run(c, inventoryItemId);
}

/**
 * Consume the shop units fitted during a visit.
 *
 * A replaced part carries the NEW serial that went in. If that serial belongs
 * to a unit still sitting in the shop, the visit is what took it out, so the
 * unit is marked installed and the product count follows. Without this a
 * technician could fit twenty cameras from stock and the shop would still
 * believe they were on the shelf.
 *
 * Runs after the visit is stored, and never throws: a stock bookkeeping
 * problem must not lose the visit record itself.
 */
function consumeReplacedParts(ctx: AppContext, visit: { id: string; branchId?: string; replacedParts?: { newSerial?: string }[] }): void {
  try {
    const parts = visit.replacedParts ?? [];
    if (!parts.length) return;
    const branch = visit.branchId ? branchesRepo.get(visit.branchId) : null;
    let changed = false;

    for (const p of parts) {
      const serial = (p.newSerial ?? '').trim();
      if (!serial) continue;
      const unit = stockUnitsRepo.findBySerial(serial);
      if (!unit || unit.status !== 'in_stock') continue;
      stockUnitsRepo.markInstalled(unit.id, visit.id, branch?.clientId, visit.branchId);
      syncInventoryQuantity(unit.inventoryItemId);
      changed = true;
    }
    if (changed) {
      notifyDataChanged(ctx, 'stock');
      notifyDataChanged(ctx, 'inventory');
    }
  } catch (e) {
    console.error('[AlAqsa] could not consume replaced parts:', e);
  }
}

export function registerIpcHandlers(ctx: AppContext): void {
  // ---- auth --------------------------------------------------------------
  handle('auth:status', () => ({
    initialized: ctx.secure.isInitialized(),
    unlocked: ctx.secure.isUnlocked(),
    licenseState: ctx.license.state(),
    language: loadConfig().language,
  }));

  handle('auth:firstRunSetup', (password: string, language: 'ar' | 'en') => {
    if (!password || password.length < 6) throw new Error('PASSWORD_TOO_SHORT');
    const { recoveryKey } = ctx.secure.firstRunSetup(password);
    saveConfig({ language });
    openDatabase(ctx.secure.getSqlcipherKey());
    // Whoever sets the master password is the owner of this installation.
    setOwnerAuthenticated(true);
    auditRepo.log('setup', 'app', undefined, 'First run setup completed');
    return { recoveryKey };
  });

  handle('auth:unlock', (password: string) => {
    // Either password opens the app. Which one was used decides whether this
    // session may perform the owner-only operations.
    const kind = ctx.secure.unlockWithPassword(password);
    if (!kind) throw new Error('WRONG_PASSWORD');
    openDatabase(ctx.secure.getSqlcipherKey());
    if (kind === 'master') {
      setOwnerAuthenticated(true);
    } else {
      setDailyAuthenticated();
    }
    auditRepo.log('unlock', 'app', undefined,
      kind === 'master' ? 'Unlocked with the master password' : 'Unlocked with the daily password');
    return {
      initialized: true, unlocked: true,
      licenseState: ctx.license.state(), language: loadConfig().language,
    };
  });

  handle('auth:unlockWithRecovery', (recoveryKey: string) => {
    if (!ctx.secure.unlockWithRecovery(recoveryKey)) throw new Error('WRONG_RECOVERY_KEY');
    openDatabase(ctx.secure.getSqlcipherKey());
    setOwnerAuthenticated(true);
    auditRepo.log('unlock', 'app', undefined, 'Unlocked with RECOVERY KEY');
    return {
      initialized: true, unlocked: true,
      licenseState: ctx.license.state(), language: loadConfig().language,
    };
  });

  handle('auth:changePassword', (oldPw: string, newPw: string) => {
    if (!newPw || newPw.length < 6) throw new Error('PASSWORD_TOO_SHORT');
    if (!ctx.secure.changePassword(oldPw, newPw)) throw new Error('WRONG_PASSWORD');
    auditRepo.log('change_password', 'app', undefined, 'Master password changed');
    return null;
  });

  handle('auth:regenerateRecoveryKey', (password: string) => {
    const res = ctx.secure.regenerateRecoveryKey(password);
    if (!res) throw new Error('WRONG_PASSWORD');
    auditRepo.log('regenerate_recovery', 'app', undefined, 'Recovery key regenerated (old one revoked)');
    return res;
  });

  handle('auth:lock', () => {
    // Clear the whole session, including ownership.
    clearSession();
    ctx.secure.lock();
    closeDatabase();
    ctx.mainWindow?.webContents.send('event:locked');
    return null;
  });

  // ---- the two passwords --------------------------------------------------
  /**
   * Who is using the app right now, and what may they do?
   *
   * The renderer uses this to hide owner-only controls. Hiding is a courtesy:
   * the same rule is enforced on every channel in `assertAllowed`.
   */
  handle('auth:sessionInfo', () => ({
    unlocked: ctx.secure.isUnlocked(),
    isOwner: isOwnerSession(),
    hasDailyPassword: ctx.secure.hasDailyPassword(),
    userAccountsEnabled: USER_ACCOUNTS_ENABLED,
  }));

  /**
   * Prove ownership without locking and reopening the app.
   *
   * The shop opens with the daily password in the morning; when the owner then
   * wants to change a setting, he types the master password here and the
   * session is upgraded for as long as the app stays open.
   */
  handle('auth:elevate', (masterPassword: string) => {
    requireUnlocked(ctx);
    if (!ctx.secure.verifyMasterPassword(masterPassword)) throw new Error('WRONG_PASSWORD');
    setOwnerAuthenticated(true);
    auditRepo.log('elevate', 'app', undefined, 'Owner authorised with the master password');
    return { isOwner: true };
  });

  /** Step back down to a daily session (e.g. the owner leaves the counter). */
  handle('auth:dropOwner', () => {
    requireUnlocked(ctx);
    setDailyAuthenticated();
    return { isOwner: false };
  });

  handle('auth:setDailyPassword', (masterPassword: string, dailyPassword: string) => {
    requireUnlocked(ctx);
    if (!dailyPassword || dailyPassword.length < 4) throw new Error('PASSWORD_TOO_SHORT');
    // Refuse to make the two secrets identical: that would silently hand every
    // member of staff the owner's authority.
    if (ctx.secure.verifyMasterPassword(dailyPassword)) throw new Error('DAILY_MUST_DIFFER');
    if (!ctx.secure.setDailyPassword(masterPassword, dailyPassword)) throw new Error('WRONG_PASSWORD');
    auditRepo.log('set_daily_password', 'app', undefined, 'Daily password set');
    return null;
  });

  handle('auth:clearDailyPassword', (masterPassword: string) => {
    requireUnlocked(ctx);
    if (!ctx.secure.clearDailyPassword(masterPassword)) throw new Error('WRONG_PASSWORD');
    auditRepo.log('clear_daily_password', 'app', undefined, 'Daily password removed');
    return null;
  });

  /**
   * Sign in as one of the configured users.
   *
   * The master password unlocks the encrypted database; this is a second,
   * separate step that decides WHAT the signed-in person may do. When no users
   * are configured the app stays in single-operator mode (admin), so an
   * existing installation is unaffected.
   */
  handle('auth:listUsers', () => {
    assertFeatureEnabled(USER_ACCOUNTS_ENABLED);
    requireUnlocked(ctx);
    const rows = getDb().prepare(
      'SELECT id, username, display_name, role FROM users WHERE active = 1 ORDER BY display_name',
    ).all() as any[];
    return rows.map((r) => ({
      id: r.id, username: r.username, displayName: r.display_name, role: r.role,
    }));
  });

  handle('auth:signIn', (userId: string, password: string) => {
    assertFeatureEnabled(USER_ACCOUNTS_ENABLED);
    requireUnlocked(ctx);
    const bcrypt = require('bcryptjs') as typeof import('bcryptjs');
    const row = getDb().prepare(
      'SELECT id, username, display_name, role, pass_hash, active FROM users WHERE id = ?',
    ).get(userId) as any;

    if (!row || !row.active) throw new Error('USER_NOT_FOUND');
    // A user saved without a password cannot be signed in as; this avoids an
    // empty password silently granting that user's role.
    if (!row.pass_hash) throw new Error('USER_HAS_NO_PASSWORD');
    if (!bcrypt.compareSync(password, row.pass_hash)) throw new Error('WRONG_PASSWORD');

    setCurrentUser(row.id, row.role);
    auditRepo.log('sign_in', 'user', row.id, row.username, row.id);
    return { id: row.id, username: row.username, displayName: row.display_name, role: row.role };
  });

  handle('auth:signOut', () => {
    assertFeatureEnabled(USER_ACCOUNTS_ENABLED);
    const id = getCurrentUserId();
    // Back to the owner session (the master password is still held), not to a
    // permission-less state — the owner never signed out of the machine.
    returnToOwner();
    auditRepo.log('sign_out', 'user', id ?? undefined);
    return null;
  });

  handle('auth:currentUser', () => {
    if (!USER_ACCOUNTS_ENABLED) {
      // No user accounts: the session is described purely by which password
      // opened the app.
      if (!isUnlockedSession()) return null;
      return {
        id: null, username: isOwnerSession() ? 'owner' : 'shop',
        displayName: '', role: 'admin' as const, isOwner: isOwnerSession(),
      };
    }
    const id = getCurrentUserId();
    // No staff id => the owner session established by the master password.
    if (!id) return isOwnerSession() ? { id: null, username: 'owner', displayName: '', role: 'admin' as const, isOwner: true } : null;
    const row = getDb().prepare(
      'SELECT id, username, display_name, role FROM users WHERE id = ?',
    ).get(id) as any;
    return row ? { id: row.id, username: row.username, displayName: row.display_name, role: row.role } : null;
  });

  // ---- license -----------------------------------------------------------
  handle('license:state', () => ctx.license.state());
  handle('license:activate', (licenseString: string) => {
    const state = ctx.license.activate(licenseString);
    if (state.status !== 'valid') throw new Error('INVALID_LICENSE');
    return state;
  });

  // ---- clients -----------------------------------------------------------
  handle('clients:list', (q) => { requireUnlocked(ctx); return clientsRepo.list(q ?? {}); });
  handle('clients:get', (id: string) => { requireUnlocked(ctx); return clientsRepo.get(id); });
  handle('clients:create', (input) => {
    requireUnlocked(ctx);
    const c = clientsRepo.create(input);
    // Most clients are a single site. Devices and visits must attach to a
    // branch, so one is created here and hidden by the UI until the owner
    // adds a real second branch — otherwise a new client cannot be worked on
    // at all until someone invents a branch for them.
    branchesRepo.ensureDefault(c.id);
    auditRepo.log('create', 'client', c.id, c.nameAr);
    notifyDataChanged(ctx, 'clients');
    return c;
  });
  handle('clients:update', (id: string, patch) => {
    requireUnlocked(ctx);
    const c = clientsRepo.update(id, patch);
    auditRepo.log('update', 'client', id, c.nameAr);
    notifyDataChanged(ctx, 'clients');
    return c;
  });
  handle('clients:remove', (id: string) => {
    requireUnlocked(ctx);
    clientsRepo.remove(id);
    auditRepo.log('delete', 'client', id);
    notifyDataChanged(ctx, 'clients');
    return null;
  });
  handle('clients:contacts', (clientId: string) => { requireUnlocked(ctx); return clientsRepo.contacts(clientId); });
  handle('clients:saveContacts', (clientId: string, contacts) => {
    requireUnlocked(ctx);
    const res = clientsRepo.saveContacts(clientId, contacts);
    auditRepo.log('update', 'contacts', clientId);
    return res;
  });

  // ---- branches ----------------------------------------------------------
  handle('branches:listByClient', (clientId: string) => { requireUnlocked(ctx); return branchesRepo.listByClient(clientId); });
  /** The branch to use when the client has none of their own. */
  handle('branches:ensureDefault', (clientId: string) => {
    requireUnlocked(ctx); return branchesRepo.ensureDefault(clientId);
  });
  /** Whether branches are worth showing for this client at all. */
  handle('branches:hasReal', (clientId: string) => {
    requireUnlocked(ctx); return branchesRepo.hasRealBranches(clientId);
  });
  handle('branches:create', (input) => {
    requireUnlocked(ctx);
    const b = branchesRepo.create(input);
    auditRepo.log('create', 'branch', b.id, b.nameAr);
    notifyDataChanged(ctx, 'branches');
    return b;
  });
  handle('branches:update', (id: string, patch) => {
    requireUnlocked(ctx);
    const b = branchesRepo.update(id, patch);
    auditRepo.log('update', 'branch', id, b.nameAr);
    notifyDataChanged(ctx, 'branches');
    return b;
  });
  handle('branches:remove', (id: string) => {
    requireUnlocked(ctx);
    branchesRepo.remove(id);
    auditRepo.log('delete', 'branch', id);
    notifyDataChanged(ctx, 'branches');
    return null;
  });

  // ---- devices -----------------------------------------------------------
  handle('devices:listByBranch', (branchId: string) => { requireUnlocked(ctx); return devicesRepo.listByBranch(branchId); });
  handle('devices:listByClient', (clientId: string) => { requireUnlocked(ctx); return devicesRepo.listByClient(clientId); });
  handle('devices:create', (input) => {
    requireUnlocked(ctx);
    const d = devicesRepo.create(input);
    // Installing a device consumes the shop unit carrying that serial, so the
    // stock count follows what actually left the shop instead of being
    // adjusted by hand.
    if (d.serialNumber) {
      const unit = stockUnitsRepo.findBySerial(d.serialNumber);
      if (unit && unit.status === 'in_stock') {
        const branch = d.branchId ? branchesRepo.get(d.branchId) : null;
        stockUnitsRepo.markInstalled(unit.id, d.id, branch?.clientId, d.branchId);
        syncInventoryQuantity(unit.inventoryItemId);
        notifyDataChanged(ctx, 'stock');
      }
    }
    auditRepo.log('create', 'device', d.id, d.label ?? d.serialNumber ?? d.type);
    notifyDataChanged(ctx, 'devices');
    return d;
  });
  handle('devices:update', (id: string, patch) => {
    requireUnlocked(ctx);
    const d = devicesRepo.update(id, patch);
    auditRepo.log('update', 'device', id);
    notifyDataChanged(ctx, 'devices');
    return d;
  });
  handle('devices:remove', (id: string) => {
    requireUnlocked(ctx);
    // Deleting the device releases its unit back into the shop, otherwise the
    // item would be lost from stock with nothing installed to account for it.
    const existing = devicesRepo.get(id);
    if (existing?.serialNumber) {
      const unit = stockUnitsRepo.findBySerial(existing.serialNumber);
      if (unit && unit.deviceId === id) {
        stockUnitsRepo.returnToStock(unit.id);
        syncInventoryQuantity(unit.inventoryItemId);
        notifyDataChanged(ctx, 'stock');
      }
    }
    devicesRepo.remove(id);
    auditRepo.log('delete', 'device', id);
    notifyDataChanged(ctx, 'devices');
    return null;
  });
  handle('devices:findBySerial', (serial: string) => { requireUnlocked(ctx); return devicesRepo.findBySerial(serial); });

  /**
   * What does this serial belong to?
   *
   * Answers the scanner's question in one call, looking in both places a
   * serial can live and telling the caller which it was:
   *   - a unit still in the shop  -> fill the form from the stock record;
   *   - a device already installed -> say where it is, so the same camera is
   *     not recorded at two clients.
   */
  handle('stock:lookupSerial', (serial: string) => {
    requireUnlocked(ctx);
    const unit = stockUnitsRepo.findBySerial(serial);
    const device = devicesRepo.findBySerial(serial.trim());
    if (!unit && !device) return null;

    let client = null;
    let branch = null;
    const clientId = device?.branchId ? undefined : unit?.clientId;
    if (unit?.clientId || clientId) {
      client = clientsRepo.get((unit?.clientId ?? clientId)!);
    }
    if (device?.branchId) {
      branch = branchesRepo.get(device.branchId);
      if (branch?.clientId) client = clientsRepo.get(branch.clientId);
    }
    return {
      unit, device,
      clientName: client ? (client.nameAr || client.nameEn) : undefined,
      branchName: branch ? (branch.nameAr || branch.nameEn) : undefined,
    };
  });

  handle('stock:list', (q) => { requireUnlocked(ctx); return stockUnitsRepo.list(q ?? {}); });
  handle('stock:get', (id: string) => { requireUnlocked(ctx); return stockUnitsRepo.get(id); });
  handle('stock:counts', () => { requireUnlocked(ctx); return stockUnitsRepo.counts(); });
  handle('stock:upsert', (input: any) => {
    requireUnlocked(ctx);
    const u = stockUnitsRepo.upsert(input);
    auditRepo.log('save', 'stock_unit', u.id, u.serialNumber);
    notifyDataChanged(ctx, 'stock');
    return u;
  });
  handle('stock:remove', (id: string) => {
    requireUnlocked(ctx);
    stockUnitsRepo.remove(id);
    auditRepo.log('delete', 'stock_unit', id);
    notifyDataChanged(ctx, 'stock');
    return null;
  });
  handle('stock:returnToStock', (id: string) => {
    requireUnlocked(ctx);
    stockUnitsRepo.returnToStock(id);
    notifyDataChanged(ctx, 'stock');
    return null;
  });
  handle('devices:qrDataUrl', async (id: string) => {
    requireUnlocked(ctx);
    const d = devicesRepo.get(id);
    if (!d) throw new Error('NOT_FOUND');
    return deviceQrDataUrl(d);
  });

  // ---- documents ---------------------------------------------------------
  handle('documents:listByClient', (clientId: string) => { requireUnlocked(ctx); return documentsRepo.listByClient(clientId); });
  handle('documents:listByBranch', (branchId: string) => { requireUnlocked(ctx); return documentsRepo.listByBranch(branchId); });
  handle('documents:add', (clientId: string | null, branchId: string | null, kind: string, title: string, sourcePath: string) => {
    requireUnlocked(ctx);
    const media = importFile(sourcePath, ctx.secure.getDek());
    const doc = documentsRepo.create({
      clientId: clientId ?? undefined, branchId: branchId ?? undefined,
      kind: kind as any, title, mediaId: media.id,
    });
    auditRepo.log('create', 'document', doc.id, title);
    notifyDataChanged(ctx, 'documents');
    return doc;
  });
  handle('documents:remove', (id: string) => {
    requireUnlocked(ctx);
    const doc = documentsRepo.get(id);
    if (doc) { deleteStored(doc.media); mediaRepo.remove(doc.media.id); }
    documentsRepo.remove(id);
    auditRepo.log('delete', 'document', id);
    notifyDataChanged(ctx, 'documents');
    return null;
  });
  handle('documents:open', async (id: string) => {
    requireUnlocked(ctx);
    const doc = documentsRepo.get(id);
    if (!doc) throw new Error('NOT_FOUND');
    const tmp = materializeToTemp(doc.media, ctx.secure.getDek(), ctx.tempDir);
    await shell.openPath(tmp);
    auditRepo.log('open', 'document', id, doc.title);
    return null;
  });

  // ---- camera licenses ---------------------------------------------------
  handle('licenses:listByClient', (clientId: string) => { requireUnlocked(ctx); return camLicenseRepo.listByClient(clientId); });
  handle('licenses:save', (input) => {
    requireUnlocked(ctx);
    const l = camLicenseRepo.save(input);
    auditRepo.log('save', 'camera_license', l.id);
    notifyDataChanged(ctx, 'licenses');
    return l;
  });
  handle('licenses:remove', (id: string) => {
    requireUnlocked(ctx); camLicenseRepo.remove(id);
    notifyDataChanged(ctx, 'licenses'); return null;
  });

  // ---- visits ------------------------------------------------------------
  handle('visits:listByClient', (clientId: string) => { requireUnlocked(ctx); return visitsRepo.listByClient(clientId); });
  handle('visits:listByBranch', (branchId: string) => { requireUnlocked(ctx); return visitsRepo.listByBranch(branchId); });
  handle('visits:get', (id: string) => { requireUnlocked(ctx); return visitsRepo.get(id); });
  handle('visits:create', (input) => {
    requireUnlocked(ctx);
    const v = visitsRepo.create(input);
    consumeReplacedParts(ctx, v);
    auditRepo.log('create', 'visit', v.id, v.visitDate);
    notifyDataChanged(ctx, 'visits');
    return v;
  });
  handle('visits:update', (id: string, patch) => {
    requireUnlocked(ctx);
    const v = visitsRepo.update(id, patch);
    consumeReplacedParts(ctx, v);
    auditRepo.log('update', 'visit', id);
    notifyDataChanged(ctx, 'visits');
    return v;
  });
  handle('visits:remove', (id: string) => {
    requireUnlocked(ctx); visitsRepo.remove(id);
    auditRepo.log('delete', 'visit', id);
    notifyDataChanged(ctx, 'visits'); return null;
  });

  // ---- inventory ---------------------------------------------------------
  handle('inventory:list', (search?: string) => { requireUnlocked(ctx); return inventoryRepo.list(search); });
  handle('inventory:upsert', (input) => {
    requireUnlocked(ctx);
    const i = inventoryRepo.upsert(input);
    notifyDataChanged(ctx, 'inventory');
    return i;
  });
  handle('inventory:remove', (id: string) => {
    requireUnlocked(ctx); inventoryRepo.remove(id);
    notifyDataChanged(ctx, 'inventory'); return null;
  });
  handle('inventory:importExcel', async (sourcePath: string) => {
    requireUnlocked(ctx);
    const res = await importInventoryExcel(sourcePath);
    auditRepo.log('import', 'inventory', undefined, `${res.imported} items`);
    notifyDataChanged(ctx, 'inventory');
    return res;
  });

  // ---- AMC / invoices ----------------------------------------------------
  handle('amc:listByClient', (clientId: string) => { requireUnlocked(ctx); return amcRepo.listByClient(clientId); });
  handle('amc:save', (input) => { requireUnlocked(ctx); return amcRepo.save(input); });
  handle('amc:remove', (id: string) => { requireUnlocked(ctx); amcRepo.remove(id); return null; });

  handle('invoices:listByClient', (clientId: string) => { requireUnlocked(ctx); return invoicesRepo.listByClient(clientId); });
  handle('invoices:save', (input) => {
    requireUnlocked(ctx);
    const inv = invoicesRepo.save(input);
    notifyDataChanged(ctx, 'invoices');
    return inv;
  });
  handle('invoices:remove', (id: string) => { requireUnlocked(ctx); invoicesRepo.remove(id); return null; });

  // ---- reminders ---------------------------------------------------------
  handle('reminders:upcoming', (days: number) => { requireUnlocked(ctx); return remindersRepo.upcoming(days ?? 30); });
  handle('reminders:all', () => { requireUnlocked(ctx); return remindersRepo.all(); });
  handle('reminders:save', (input) => {
    requireUnlocked(ctx);
    const r = remindersRepo.save(input);
    notifyDataChanged(ctx, 'reminders');
    return r;
  });
  handle('reminders:markDone', (id: string) => {
    requireUnlocked(ctx); remindersRepo.markDone(id);
    notifyDataChanged(ctx, 'reminders'); return null;
  });
  handle('reminders:remove', (id: string) => {
    requireUnlocked(ctx); remindersRepo.remove(id);
    notifyDataChanged(ctx, 'reminders'); return null;
  });

  // ---- status labels -----------------------------------------------------
  handle('statusLabels:list', () => { requireUnlocked(ctx); return statusLabelsRepo.list(); });
  handle('statusLabels:save', (input) => { requireUnlocked(ctx); return statusLabelsRepo.save(input); });
  handle('statusLabels:remove', (id: string) => { requireUnlocked(ctx); statusLabelsRepo.remove(id); return null; });

  // ---- reports -----------------------------------------------------------
  handle('reports:visitPdf', async (visitId: string) => {
    requireUnlocked(ctx);
    const p = await generateVisitPdf(visitId, ctx.secure.getDek());
    const visit = visitsRepo.get(visitId);
    exportsRepo.record({
      clientId: visit?.clientId, kind: 'visit_pdf', filePath: p,
      refId: visitId, title: visit?.visitDate,
    });
    auditRepo.log('export', 'visit_report', visitId, p);
    notifyDataChanged(ctx, 'exports');
    return { path: p };
  });
  handle('reports:agreementPdf', async (clientId: string) => {
    requireUnlocked(ctx);
    const p = await generateAgreementPdf(clientId);
    exportsRepo.record({ clientId, kind: 'agreement_pdf', filePath: p });
    auditRepo.log('export', 'agreement', clientId, p);
    notifyDataChanged(ctx, 'exports');
    return { path: p };
  });
  handle('reports:invoicePdf', async (invoiceId: string) => {
    requireUnlocked(ctx);
    const p = await generateInvoicePdf(invoiceId);
    const inv = invoicesRepo.get(invoiceId);
    exportsRepo.record({
      clientId: inv?.clientId, kind: 'invoice_pdf', filePath: p,
      refId: invoiceId, title: inv?.number,
    });
    auditRepo.log('export', 'invoice', invoiceId, p);
    notifyDataChanged(ctx, 'exports');
    return { path: p };
  });
  handle('reports:exportClientExcel', async (clientId: string) => {
    requireUnlocked(ctx);
    const p = await exportClientExcel(clientId);
    exportsRepo.record({ clientId, kind: 'client_excel', filePath: p });
    auditRepo.log('export', 'client_excel', clientId, p);
    notifyDataChanged(ctx, 'exports');
    return { path: p };
  });
  handle('reports:exportAllExcel', async () => {
    requireUnlocked(ctx);
    const p = await exportAllExcel();
    // No client: this file covers the whole shop.
    exportsRepo.record({ kind: 'full_excel', filePath: p });
    auditRepo.log('export', 'all_excel', undefined, p);
    notifyDataChanged(ctx, 'exports');
    return { path: p };
  });
  handle('reports:shareWhatsApp', async (pdfPath: string, phone: string, message: string) => {
    requireUnlocked(ctx);
    await shareViaWhatsApp(pdfPath, phone, message);
    return null;
  });
  handle('reports:print', async (pdfPath: string) => {
    requireUnlocked(ctx);
    await printFile(pdfPath);
    return null;
  });

  // ---- daily work schedule ----------------------------------------------
  handle('dayJobs:listByDate', (date: string) => {
    requireUnlocked(ctx); return dayJobsRepo.listByDate(date);
  });
  handle('dayJobs:listBetween', (from: string, to: string) => {
    requireUnlocked(ctx); return dayJobsRepo.listBetween(from, to);
  });
  handle('dayJobs:listByClient', (clientId: string) => {
    requireUnlocked(ctx); return dayJobsRepo.listByClient(clientId);
  });
  handle('dayJobs:get', (id: string) => { requireUnlocked(ctx); return dayJobsRepo.get(id); });
  handle('dayJobs:counts', (date: string) => {
    requireUnlocked(ctx); return dayJobsRepo.countsForDate(date);
  });
  handle('dayJobs:save', (input: any) => {
    requireUnlocked(ctx);
    const j = dayJobsRepo.save(input);
    auditRepo.log(input.id ? 'update' : 'create', 'day_job', j.id, j.placeName ?? j.clientName);
    notifyDataChanged(ctx, 'dayJobs');
    return j;
  });
  handle('dayJobs:setStatus', (id: string, status: string) => {
    requireUnlocked(ctx);
    dayJobsRepo.setStatus(id, status);
    notifyDataChanged(ctx, 'dayJobs');
    return null;
  });
  handle('dayJobs:remove', (id: string) => {
    requireUnlocked(ctx);
    dayJobsRepo.remove(id);
    auditRepo.log('delete', 'day_job', id);
    notifyDataChanged(ctx, 'dayJobs');
    return null;
  });
  handle('dayJobs:sheetPdf', async (date: string) => {
    requireUnlocked(ctx);
    const p = await generateDaySheetPdf(date);
    exportsRepo.record({ kind: 'day_sheet_pdf', filePath: p, title: date });
    auditRepo.log('export', 'day_sheet', undefined, p);
    notifyDataChanged(ctx, 'exports');
    return { path: p };
  });

  // ---- requirement checklists -------------------------------------------
  handle('requirements:listTemplates', (includeInactive?: boolean) => {
    requireUnlocked(ctx); return requirementTemplatesRepo.list(!!includeInactive);
  });
  handle('requirements:getTemplate', (id: string) => {
    requireUnlocked(ctx); return requirementTemplatesRepo.get(id);
  });
  handle('requirements:saveTemplate', (input: any) => {
    requireUnlocked(ctx);
    const t = requirementTemplatesRepo.save(input);
    auditRepo.log(input.id ? 'update' : 'create', 'requirement_template', t.id, t.nameAr);
    notifyDataChanged(ctx, 'requirements');
    return t;
  });
  handle('requirements:removeTemplate', (id: string) => {
    requireUnlocked(ctx);
    requirementTemplatesRepo.remove(id);
    auditRepo.log('delete', 'requirement_template', id);
    notifyDataChanged(ctx, 'requirements');
    return null;
  });
  handle('requirements:listCases', (clientId: string) => {
    requireUnlocked(ctx); return requirementCasesRepo.listByClient(clientId);
  });
  handle('requirements:getCase', (id: string) => {
    requireUnlocked(ctx); return requirementCasesRepo.get(id);
  });
  handle('requirements:createCase', (clientId: string, templateId: string, title?: string) => {
    requireUnlocked(ctx);
    const c = requirementCasesRepo.createFromTemplate(clientId, templateId, title);
    auditRepo.log('create', 'requirement_case', c.id, c.title, clientId);
    notifyDataChanged(ctx, 'requirements');
    return c;
  });
  handle('requirements:saveCase', (input: any) => {
    requireUnlocked(ctx);
    const c = requirementCasesRepo.save(input);
    notifyDataChanged(ctx, 'requirements');
    return c;
  });
  handle('requirements:setItemCollected', (itemId: string, collected: boolean, documentId?: string) => {
    requireUnlocked(ctx);
    requirementCasesRepo.setItemCollected(itemId, collected, documentId);
    notifyDataChanged(ctx, 'requirements');
    return null;
  });
  handle('requirements:removeCase', (id: string) => {
    requireUnlocked(ctx);
    requirementCasesRepo.remove(id);
    notifyDataChanged(ctx, 'requirements');
    return null;
  });

  // ---- quotations --------------------------------------------------------
  handle('quotations:listByClient', (clientId: string) => {
    requireUnlocked(ctx); return quotationsRepo.listByClient(clientId);
  });
  handle('quotations:recent', (limit?: number) => {
    requireUnlocked(ctx); return quotationsRepo.recent(limit ?? 100);
  });
  handle('quotations:get', (id: string) => { requireUnlocked(ctx); return quotationsRepo.get(id); });
  handle('quotations:nextNumber', () => { requireUnlocked(ctx); return quotationsRepo.nextNumber(); });
  handle('quotations:save', (input: any) => {
    requireUnlocked(ctx);
    const q = quotationsRepo.save(input);
    auditRepo.log(input.id ? 'update' : 'create', 'quotation', q.id, q.number, q.clientId);
    notifyDataChanged(ctx, 'quotations');
    return q;
  });
  handle('quotations:setStatus', (id: string, status: string) => {
    requireUnlocked(ctx);
    quotationsRepo.setStatus(id, status);
    notifyDataChanged(ctx, 'quotations');
    return null;
  });
  handle('quotations:remove', (id: string) => {
    requireUnlocked(ctx);
    quotationsRepo.remove(id);
    auditRepo.log('delete', 'quotation', id);
    notifyDataChanged(ctx, 'quotations');
    return null;
  });
  /**
   * Turn an accepted quotation into an invoice, carrying the lines across so
   * nothing is retyped and the two documents cannot disagree.
   */
  handle('quotations:convertToInvoice', (id: string) => {
    requireUnlocked(ctx);
    const q = quotationsRepo.get(id);
    if (!q) throw new Error('NOT_FOUND');
    if (q.invoiceId) throw new Error('ALREADY_INVOICED');
    const inv = invoicesRepo.save({
      clientId: q.clientId,
      date: new Date().toISOString().slice(0, 10),
      items: q.items.map((i) => ({
        id: i.id, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice,
      })),
      taxRate: q.taxRate,
      trn: q.trn,
      terms: q.terms,
      notes: q.notes,
      status: 'unpaid',
      paid: 0,
    } as never);
    quotationsRepo.linkInvoice(id, inv.id);
    auditRepo.log('convert', 'quotation', id, `-> invoice ${inv.number}`, q.clientId);
    notifyDataChanged(ctx, 'quotations');
    notifyDataChanged(ctx, 'invoices');
    return inv;
  });
  handle('quotations:pdf', async (id: string) => {
    requireUnlocked(ctx);
    const p = await generateQuotationPdf(id);
    const q = quotationsRepo.get(id);
    exportsRepo.record({
      clientId: q?.clientId, kind: 'quotation_pdf', filePath: p,
      refId: id, title: q?.number,
    });
    auditRepo.log('export', 'quotation', id, p);
    notifyDataChanged(ctx, 'exports');
    return { path: p };
  });

  // ---- export history ----------------------------------------------------
  handle('exports:listByClient', (clientId: string) => {
    requireUnlocked(ctx); return exportsRepo.listByClient(clientId);
  });
  handle('exports:recent', (limit?: number) => {
    requireUnlocked(ctx); return exportsRepo.recent(limit ?? 100);
  });
  /** Open the file in whatever the system uses for it. */
  /**
   * Open an exported file.
   *
   * `shell.openPath` hands the file to whatever Windows has associated with
   * it. On a PC with no PDF reader installed that association does not exist,
   * so nothing happens and the button appears broken — which is exactly what
   * the shop saw. Rather than fail, the file is shown in Explorer (the same
   * thing the WhatsApp share does, which is why that one "worked") and a clear
   * message explains why.
   */
  handle('exports:open', async (filePath: string) => {
    requireUnlocked(ctx);
    if (!fs.existsSync(filePath)) throw new Error('FILE_NOT_FOUND');
    const e = await shell.openPath(filePath);
    if (e) {
      shell.showItemInFolder(filePath);
      throw new Error('NO_PDF_VIEWER');
    }
    return null;
  });
  /** Reveal the file in Explorer, which answers "where is it?" directly. */
  handle('exports:revealInFolder', (filePath: string) => {
    requireUnlocked(ctx);
    if (!fs.existsSync(filePath)) throw new Error('FILE_NOT_FOUND');
    shell.showItemInFolder(filePath);
    return null;
  });
  /** Open the reports folder itself. */
  handle('exports:openFolder', async () => {
    requireUnlocked(ctx);
    const e = await shell.openPath(reportsDir());
    if (e) throw new Error('FILE_ACCESS_FAILED');
    return { path: reportsDir() };
  });
  /** Forget a history entry. The file on disk is left alone. */
  handle('exports:remove', (id: string) => {
    requireUnlocked(ctx);
    exportsRepo.remove(id);
    notifyDataChanged(ctx, 'exports');
    return null;
  });

  // ---- staff directory ---------------------------------------------------
  handle('staff:list', (includeInactive?: boolean) => {
    requireUnlocked(ctx); return staffRepo.list(!!includeInactive);
  });
  handle('staff:save', (input) => {
    requireUnlocked(ctx);
    const s = staffRepo.save(input);
    auditRepo.log('save', 'staff', s.id, s.name);
    return s;
  });
  handle('staff:remove', (id: string) => {
    requireUnlocked(ctx); staffRepo.remove(id);
    auditRepo.log('delete', 'staff', id);
    return null;
  });
  handle('staff:activity', (fromDate?: string, toDate?: string) => {
    requireUnlocked(ctx); return staffRepo.activity(fromDate, toDate);
  });

  // ---- note entries ------------------------------------------------------
  handle('notes:listByClient', (clientId: string) => {
    requireUnlocked(ctx); return notesRepo.listByClient(clientId);
  });
  handle('notes:listByBranch', (branchId: string) => {
    requireUnlocked(ctx); return notesRepo.listByBranch(branchId);
  });
  handle('notes:save', (input) => {
    requireUnlocked(ctx);
    const n = notesRepo.save(input);
    auditRepo.log('save', 'note', n.id);
    notifyDataChanged(ctx, 'notes');
    return n;
  });
  handle('notes:remove', (id: string) => {
    requireUnlocked(ctx); notesRepo.remove(id);
    notifyDataChanged(ctx, 'notes');
    return null;
  });

  // ---- quick sharing -----------------------------------------------------
  handle('share:whatsAppText', async (phone: string, message: string) => {
    requireUnlocked(ctx);
    await shareTextViaWhatsApp(phone, message);
    return null;
  });

  handle('share:branchLocation', async (branchId: string, phone: string) => {
    requireUnlocked(ctx);
    const branch = branchesRepo.get(branchId);
    if (!branch) throw new Error('NOT_FOUND');
    const client = clientsRepo.get(branch.clientId);

    // Prefer exact coordinates; fall back to a search link on the address.
    const loc = branch.location;
    const mapLink = loc.lat != null && loc.lng != null
      ? `https://maps.google.com/?q=${loc.lat},${loc.lng}`
      : loc.mapUrl
        ? loc.mapUrl
        : loc.address
          ? `https://maps.google.com/?q=${encodeURIComponent(loc.address)}`
          : '';

    if (!mapLink) throw new Error('NO_LOCATION');

    const lines = [
      `📍 ${client?.nameAr ?? ''} — ${branch.nameAr}`,
      loc.address ? `العنوان: ${loc.address}` : '',
      branch.managerContact ? `مسؤول الفرع: ${branch.managerContact}` : '',
      '',
      mapLink,
    ].filter(Boolean);

    await shareTextViaWhatsApp(phone, lines.join('\n'));
    auditRepo.log('share', 'branch_location', branchId, branch.nameAr);
    return null;
  });

  // ---- search / dashboard ------------------------------------------------
  handle('search:global', (term: string) => {
    requireUnlocked(ctx);
    if (!term || term.trim().length < 1) {
      return { clients: [], branches: [], devices: [], contacts: [] };
    }
    return searchRepo.global(term.trim());
  });
  handle('dashboard:stats', () => { requireUnlocked(ctx); return dashboardRepo.stats(); });

  // ---- audit -------------------------------------------------------------
  handle('audit:recent', (limit: number) => { requireUnlocked(ctx); return auditRepo.recent(limit ?? 200); });

  // ---- users (roles) -----------------------------------------------------
  handle('users:list', () => {
    assertFeatureEnabled(USER_ACCOUNTS_ENABLED);
    requireUnlocked(ctx);
    return getDb().prepare('SELECT id, username, display_name, role, active, created_at FROM users ORDER BY username')
      .all().map((r: any) => ({
        id: r.id, username: r.username, displayName: r.display_name,
        role: r.role, active: !!r.active, createdAt: r.created_at,
      }));
  });
  handle('users:save', async (input: any, password?: string) => {
    assertFeatureEnabled(USER_ACCOUNTS_ENABLED);
    requireUnlocked(ctx);
    const bcrypt = require('bcryptjs') as typeof import('bcryptjs');
    const db = getDb();
    const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
    const id = input.id ?? randomUUID();
    const exists = input.id && db.prepare('SELECT 1 FROM users WHERE id = ?').get(input.id);

    const username = String(input.username ?? '').trim();
    if (!username) throw new Error('USERNAME_REQUIRED');

    // usernames are UNIQUE in the schema; a clash used to surface as a raw
    // SQLite error and the new account simply never appeared in the list.
    const clash = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as { id: string } | undefined;
    if (clash && clash.id !== id) throw new Error('USERNAME_TAKEN');

    // An account with no password can never sign in, so it would look like it
    // had vanished. Require one when creating.
    if (!exists && !password) throw new Error('PASSWORD_REQUIRED');
    if (password && password.length < 4) throw new Error('PASSWORD_TOO_SHORT');

    // No need to force an admin account: the owner always has admin rights via
    // the master password, so the shop can never lock itself out of Settings.
    const role = input.role ?? 'viewer';

    const hash = password ? bcrypt.hashSync(password, 10) : null;
    if (exists) {
      db.prepare(`UPDATE users SET username=?, display_name=?, role=?, active=?
        ${hash ? ', pass_hash=?' : ''} WHERE id=?`)
        .run(...(hash
          ? [username, input.displayName, input.role, input.active ? 1 : 0, hash, id]
          : [username, input.displayName, input.role, input.active ? 1 : 0, id]));
    } else {
      db.prepare('INSERT INTO users (id, username, display_name, role, pass_hash, active, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, username, input.displayName, role, hash, input.active === false ? 0 : 1, new Date().toISOString());
    }
    auditRepo.log('save', 'user', id, input.username);
    const r: any = db.prepare('SELECT id, username, display_name, role, active, created_at FROM users WHERE id = ?').get(id);
    return { id: r.id, username: r.username, displayName: r.display_name, role: r.role, active: !!r.active, createdAt: r.created_at };
  });
  handle('users:remove', (id: string) => {
    assertFeatureEnabled(USER_ACCOUNTS_ENABLED);
    requireUnlocked(ctx);
    // Safe to remove any account: the owner retains admin through the master
    // password, so deleting staff can never lock the shop out.
    const db = getDb();
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    auditRepo.log('delete', 'user', id);
    return null;
  });

  // ---- backup / restore / factory reset ----------------------------------
  handle('backup:now', () => {
    requireUnlocked(ctx);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(backupsDir(), `alaqsa-backup-${stamp}.db`);
    // The DB is already encrypted at rest, so a file copy is a safe backup.
    getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(dbPath(), dest);
    auditRepo.log('backup', 'app', undefined, dest);
    return { path: dest };
  });

  handle('backup:exportEncrypted', async () => {
    requireUnlocked(ctx);
    const res = await dialog.showSaveDialog({
      title: 'تصدير نسخة احتياطية مشفّرة',
      defaultPath: path.join(app.getPath('documents'), `alaqsa-backup-${Date.now()}.db`),
      filters: [{ name: 'AlAqsa Backup', extensions: ['db'] }],
    });
    if (res.canceled || !res.filePath) throw new Error('CANCELLED');
    getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(dbPath(), res.filePath);
    auditRepo.log('export', 'backup', undefined, res.filePath);
    return { path: res.filePath };
  });

  handle('backup:restore', (sourcePath: string) => {
    requireUnlocked(ctx);
    if (!fs.existsSync(sourcePath)) throw new Error('FILE_NOT_FOUND');
    closeDatabase();
    fs.copyFileSync(sourcePath, dbPath());
    openDatabase(ctx.secure.getSqlcipherKey());
    auditRepo.log('restore', 'backup', undefined, sourcePath);
    notifyDataChanged(ctx, 'all');
    return null;
  });

  /**
   * Factory reset — wipes ALL data back to an empty app.
   * Gated by the master password; the UI must also show an explicit warning.
   * A safety backup is taken first so an accidental reset is still recoverable.
   */
  handle('backup:factoryReset', (password: string) => {
    requireUnlocked(ctx);
    if (!ctx.secure.unlockWithPassword(password)) throw new Error('WRONG_PASSWORD');

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safety = path.join(backupsDir(), `before-reset-${stamp}.db`);
    getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(dbPath(), safety);

    closeDatabase();
    for (const f of [dbPath(), `${dbPath()}-wal`, `${dbPath()}-shm`]) {
      if (fs.existsSync(f)) fs.rmSync(f, { force: true });
    }
    fs.rmSync(filesDir(), { recursive: true, force: true });

    openDatabase(ctx.secure.getSqlcipherKey());
    auditRepo.log('factory_reset', 'app', undefined, `Safety backup: ${safety}`);
    notifyDataChanged(ctx, 'all');
    return null;
  });

  // ---- files -------------------------------------------------------------
  handle('files:pickOpen', async (filters?: { name: string; extensions: string[] }[]) => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters ?? [
        { name: 'كل الملفات المدعومة', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'webp'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });

  handle('files:pickSave', async (defaultName: string) => {
    const res = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('documents'), defaultName),
    });
    return res.canceled || !res.filePath ? null : res.filePath;
  });

  handle('files:saveDataUrl', (dataUrl: string, suggestedName: string) => {
    requireUnlocked(ctx);
    const { buffer } = dataUrlToBuffer(dataUrl);
    return writeEncrypted(buffer, suggestedName, ctx.secure.getDek());
  });

  handle('files:importDocument', (sourcePath: string) => {
    requireUnlocked(ctx);
    return importFile(sourcePath, ctx.secure.getDek());
  });

  // ---- settings ----------------------------------------------------------
  handle('settings:get', (key: string) => { requireUnlocked(ctx); return settingsRepo.get(key); });
  handle('settings:set', (key: string, value: string) => {
    requireUnlocked(ctx); settingsRepo.set(key, value); return null;
  });
  handle('settings:setLanguage', (lang: 'ar' | 'en') => { saveConfig({ language: lang }); return null; });
  handle('settings:setTheme', (theme: 'light' | 'dark') => {
    saveConfig({ theme });
    const { nativeTheme } = require('electron') as typeof import('electron');
    nativeTheme.themeSource = theme;
    return null;
  });

  // ---- network -----------------------------------------------------------
  handle('network:getMode', () => {
    const c = loadConfig();
    return { mode: c.networkMode, hostAddress: c.hostAddress };
  });
  handle('network:setHost', () => {
    requireUnlocked(ctx);
    networkService.startHost(ctx);
    saveConfig({ networkMode: 'host' });
    return null;
  });
  handle('network:discover', () => networkService.discover());
  handle('network:connect', async (address: string, port: number) => {
    await networkService.connectToHost(address, port);
    saveConfig({ networkMode: 'client', hostAddress: address, hostPort: port });
    return null;
  });
  handle('network:disconnect', () => {
    networkService.stop();
    saveConfig({ networkMode: 'standalone' });
    return null;
  });

  // ---- app ---------------------------------------------------------------
  handle('app:about', () => ({
    name: APP_NAME,
    version: APP_VERSION,
    author: AUTHOR.name,
    email: AUTHOR.email,
    phone: AUTHOR.phone,
    github: AUTHOR.github,
    year: new Date().getFullYear(),
  }));

  handle('app:seedDemoData', () => {
    requireUnlocked(ctx);
    // Guard in the main process too: once the shop has real records, sample
    // data must never be injectable, however the call was triggered.
    const existing = (getDb().prepare('SELECT count(*) AS c FROM clients').get() as { c: number }).c;
    if (existing > 0) throw new Error('DATA_EXISTS');
    const res = seedDemoData();
    auditRepo.log('seed', 'demo_data', undefined, `${res.clients} clients`);
    notifyDataChanged(ctx, 'all');
    return res;
  });

  handle('app:zoom', (direction: 'in' | 'out' | 'reset') => {
    const wc = ctx.mainWindow?.webContents;
    if (!wc) return null;
    if (direction === 'reset') wc.setZoomLevel(0);
    else if (direction === 'in') wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 5));
    else wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3));
    return null;
  });

  /** Lets the UI hide the demo button (and show the current role) sensibly. */
  handle('app:state', () => {
    requireUnlocked(ctx);
    const clients = (getDb().prepare('SELECT count(*) AS c FROM clients').get() as { c: number }).c;
    return { isEmpty: clients === 0, role: getCurrentRole() };
  });
}
