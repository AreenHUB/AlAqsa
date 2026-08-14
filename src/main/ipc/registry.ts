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
  dashboardRepo, mediaRepo,
} from '../db/repositories/miscRepo';
import { importFile, materializeToTemp, dataUrlToBuffer, writeEncrypted, deleteStored } from '../storage/fileStore';
import { dataDir, filesDir, backupsDir, reportsDir, secureStorePath, dbPath } from '../storage/paths';
import { APP_NAME, APP_VERSION, AUTHOR } from '@shared/constants';
import { seedDemoData } from '../services/demoData';
import { staffRepo, notesRepo } from '../db/repositories/staffRepo';
import { assertAllowed, setCurrentUser, getCurrentRole } from '../security/permissions';
import { generateVisitPdf, generateAgreementPdf, generateInvoicePdf } from '../services/pdfService';
import { exportClientExcel, exportAllExcel, importInventoryExcel } from '../services/excelService';
import { shareViaWhatsApp, shareTextViaWhatsApp, printFile } from '../services/shareService';
import { deviceQrDataUrl } from '../services/qrService';
import { networkService } from '../services/networkService';

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const err = (e: unknown): Result<never> => ({
  ok: false,
  error: e instanceof Error ? e.message : String(e),
});

/**
 * Wrap a handler with uniform error handling and a role check.
 *
 * The permission check happens here rather than in the renderer: hiding a
 * button is only cosmetic, so this boundary is the authoritative one.
 * Auth/licence channels opt out because they must work before a role exists.
 */
const UNGATED = new Set([
  'auth:status', 'auth:unlock', 'auth:unlockWithRecovery',
  'auth:firstRunSetup', 'auth:lock', 'license:state', 'app:about',
  'settings:setLanguage', 'settings:setTheme', 'network:getMode',
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
    auditRepo.log('setup', 'app', undefined, 'First run setup completed');
    return { recoveryKey };
  });

  handle('auth:unlock', (password: string) => {
    if (!ctx.secure.unlockWithPassword(password)) throw new Error('WRONG_PASSWORD');
    openDatabase(ctx.secure.getSqlcipherKey());
    auditRepo.log('unlock', 'app', undefined, 'Unlocked with password');
    return {
      initialized: true, unlocked: true,
      licenseState: ctx.license.state(), language: loadConfig().language,
    };
  });

  handle('auth:unlockWithRecovery', (recoveryKey: string) => {
    if (!ctx.secure.unlockWithRecovery(recoveryKey)) throw new Error('WRONG_RECOVERY_KEY');
    openDatabase(ctx.secure.getSqlcipherKey());
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
    ctx.secure.lock();
    closeDatabase();
    ctx.mainWindow?.webContents.send('event:locked');
    return null;
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
    devicesRepo.remove(id);
    auditRepo.log('delete', 'device', id);
    notifyDataChanged(ctx, 'devices');
    return null;
  });
  handle('devices:findBySerial', (serial: string) => { requireUnlocked(ctx); return devicesRepo.findBySerial(serial); });
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
    auditRepo.log('create', 'visit', v.id, v.visitDate);
    notifyDataChanged(ctx, 'visits');
    return v;
  });
  handle('visits:update', (id: string, patch) => {
    requireUnlocked(ctx);
    const v = visitsRepo.update(id, patch);
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
    auditRepo.log('export', 'visit_report', visitId, p);
    return { path: p };
  });
  handle('reports:agreementPdf', async (clientId: string) => {
    requireUnlocked(ctx);
    const p = await generateAgreementPdf(clientId);
    auditRepo.log('export', 'agreement', clientId, p);
    return { path: p };
  });
  handle('reports:invoicePdf', async (invoiceId: string) => {
    requireUnlocked(ctx);
    const p = await generateInvoicePdf(invoiceId);
    auditRepo.log('export', 'invoice', invoiceId, p);
    return { path: p };
  });
  handle('reports:exportClientExcel', async (clientId: string) => {
    requireUnlocked(ctx);
    const p = await exportClientExcel(clientId);
    auditRepo.log('export', 'client_excel', clientId, p);
    return { path: p };
  });
  handle('reports:exportAllExcel', async () => {
    requireUnlocked(ctx);
    const p = await exportAllExcel();
    auditRepo.log('export', 'all_excel', undefined, p);
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
    requireUnlocked(ctx);
    return getDb().prepare('SELECT id, username, display_name, role, active, created_at FROM users ORDER BY username')
      .all().map((r: any) => ({
        id: r.id, username: r.username, displayName: r.display_name,
        role: r.role, active: !!r.active, createdAt: r.created_at,
      }));
  });
  handle('users:save', async (input: any, password?: string) => {
    requireUnlocked(ctx);
    const bcrypt = require('bcryptjs') as typeof import('bcryptjs');
    const db = getDb();
    const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
    const id = input.id ?? randomUUID();
    const hash = password ? bcrypt.hashSync(password, 10) : null;
    const exists = input.id && db.prepare('SELECT 1 FROM users WHERE id = ?').get(input.id);
    if (exists) {
      db.prepare(`UPDATE users SET username=?, display_name=?, role=?, active=?
        ${hash ? ', pass_hash=?' : ''} WHERE id=?`)
        .run(...(hash
          ? [input.username, input.displayName, input.role, input.active ? 1 : 0, hash, id]
          : [input.username, input.displayName, input.role, input.active ? 1 : 0, id]));
    } else {
      db.prepare('INSERT INTO users (id, username, display_name, role, pass_hash, active, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, input.username, input.displayName, input.role ?? 'viewer', hash, input.active === false ? 0 : 1, new Date().toISOString());
    }
    auditRepo.log('save', 'user', id, input.username);
    const r: any = db.prepare('SELECT id, username, display_name, role, active, created_at FROM users WHERE id = ?').get(id);
    return { id: r.id, username: r.username, displayName: r.display_name, role: r.role, active: !!r.active, createdAt: r.created_at };
  });
  handle('users:remove', (id: string) => {
    requireUnlocked(ctx);
    getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
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

  /** Lets the UI hide the demo button (and show the current role) sensibly. */
  handle('app:state', () => {
    requireUnlocked(ctx);
    const clients = (getDb().prepare('SELECT count(*) AS c FROM clients').get() as { c: number }).c;
    return { isEmpty: clients === 0, role: getCurrentRole() };
  });
}
