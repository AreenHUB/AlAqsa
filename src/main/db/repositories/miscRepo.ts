// ============================================================================
// AlAqsa — Remaining repositories: media, documents, camera licenses, inventory,
// AMC, invoices, reminders, status labels, settings, audit, search, dashboard.
// ============================================================================

import { getDb } from '../database';
import { uuid, now, toBool, fromBool, parseJson } from '../helpers';
import type {
  MediaRef, DocumentRecord, CameraLicense, InventoryItem, AmcContract,
  Invoice, Reminder, StatusLabel, AuditEntry, Client, Branch, Device, Contact,
  StockUnit,
} from '@shared/types';
import type { DashboardStats, GlobalSearchResult } from '@shared/ipc';

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------
export const mediaRepo = {
  insert(m: Omit<MediaRef, 'id' | 'createdAt'> & { id?: string }): MediaRef {
    const id = m.id ?? uuid();
    const ts = now();
    getDb().prepare(
      'INSERT INTO media (id, file_name, stored_path, mime_type, size_bytes, created_at) VALUES (?,?,?,?,?,?)',
    ).run(id, m.fileName, m.storedPath, m.mimeType, m.sizeBytes, ts);
    return { id, fileName: m.fileName, storedPath: m.storedPath, mimeType: m.mimeType, sizeBytes: m.sizeBytes, createdAt: ts };
  },
  get(id: string): MediaRef | null {
    const r = getDb().prepare('SELECT * FROM media WHERE id = ?').get(id) as any;
    return r ? { id: r.id, fileName: r.file_name, storedPath: r.stored_path, mimeType: r.mime_type, sizeBytes: r.size_bytes, createdAt: r.created_at } : null;
  },
  remove(id: string): void {
    getDb().prepare('DELETE FROM media WHERE id = ?').run(id);
  },
};

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
function mapDoc(r: any): DocumentRecord {
  return {
    id: r.id, clientId: r.client_id ?? undefined, branchId: r.branch_id ?? undefined,
    kind: r.kind, title: r.title, media: mediaRepo.get(r.media_id)!,
    issueDate: r.issue_date ?? undefined, expiryDate: r.expiry_date ?? undefined,
    notes: r.notes ?? undefined, createdAt: r.created_at,
  };
}

export const documentsRepo = {
  listByClient(clientId: string): DocumentRecord[] {
    const rows = getDb().prepare('SELECT * FROM documents WHERE client_id = ? ORDER BY created_at DESC').all(clientId) as any[];
    return rows.map(mapDoc);
  },
  listByBranch(branchId: string): DocumentRecord[] {
    const rows = getDb().prepare('SELECT * FROM documents WHERE branch_id = ? ORDER BY created_at DESC').all(branchId) as any[];
    return rows.map(mapDoc);
  },
  get(id: string): DocumentRecord | null {
    const r = getDb().prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
    return r ? mapDoc(r) : null;
  },
  create(d: Partial<DocumentRecord> & { mediaId: string }): DocumentRecord {
    const id = d.id ?? uuid();
    const ts = now();
    getDb().prepare(`INSERT INTO documents
      (id, client_id, branch_id, kind, title, media_id, issue_date, expiry_date, notes, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, d.clientId ?? null, d.branchId ?? null, d.kind ?? 'other', d.title ?? '',
        d.mediaId, d.issueDate ?? null, d.expiryDate ?? null, d.notes ?? null, ts);
    return this.get(id)!;
  },
  remove(id: string): void {
    getDb().prepare('DELETE FROM documents WHERE id = ?').run(id);
  },
};

// ---------------------------------------------------------------------------
// Camera licenses (UAE)
// ---------------------------------------------------------------------------
function mapLic(r: any): CameraLicense {
  return {
    id: r.id, clientId: r.client_id, branchId: r.branch_id ?? undefined,
    licenseNumber: r.license_number ?? undefined, issueDate: r.issue_date ?? undefined,
    renewalDate: r.renewal_date ?? undefined, expiryDate: r.expiry_date ?? undefined,
    documentId: r.document_id ?? undefined, notes: r.notes ?? undefined,
  };
}

export const camLicenseRepo = {
  listByClient(clientId: string): CameraLicense[] {
    const rows = getDb().prepare('SELECT * FROM camera_licenses WHERE client_id = ? ORDER BY expiry_date').all(clientId) as any[];
    return rows.map(mapLic);
  },
  get(id: string): CameraLicense | null {
    const r = getDb().prepare('SELECT * FROM camera_licenses WHERE id = ?').get(id) as any;
    return r ? mapLic(r) : null;
  },
  save(input: Partial<CameraLicense>): CameraLicense {
    const db = getDb();
    const id = input.id ?? uuid();
    const exists = input.id && db.prepare('SELECT 1 FROM camera_licenses WHERE id = ?').get(input.id);
    if (exists) {
      db.prepare(`UPDATE camera_licenses SET branch_id=?, license_number=?, issue_date=?,
        renewal_date=?, expiry_date=?, document_id=?, notes=? WHERE id=?`)
        .run(input.branchId ?? null, input.licenseNumber ?? null, input.issueDate ?? null,
          input.renewalDate ?? null, input.expiryDate ?? null, input.documentId ?? null,
          input.notes ?? null, id);
    } else {
      db.prepare(`INSERT INTO camera_licenses
        (id, client_id, branch_id, license_number, issue_date, renewal_date, expiry_date, document_id, notes)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, input.clientId, input.branchId ?? null, input.licenseNumber ?? null,
          input.issueDate ?? null, input.renewalDate ?? null, input.expiryDate ?? null,
          input.documentId ?? null, input.notes ?? null);
    }
    return this.get(id)!;
  },
  remove(id: string): void {
    getDb().prepare('DELETE FROM camera_licenses WHERE id = ?').run(id);
  },
  expiringWithin(days: number): CameraLicense[] {
    const today = new Date().toISOString().slice(0, 10);
    const limit = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const rows = getDb().prepare(
      'SELECT * FROM camera_licenses WHERE expiry_date IS NOT NULL AND expiry_date >= ? AND expiry_date <= ? ORDER BY expiry_date',
    ).all(today, limit) as any[];
    return rows.map(mapLic);
  },
};

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------
function mapInv(r: any): InventoryItem {
  return {
    id: r.id, type: r.type, manufacturer: r.manufacturer ?? undefined,
    model: r.model ?? undefined, description: r.description ?? undefined,
    quantity: r.quantity ?? undefined, unitPrice: r.unit_price ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export const inventoryRepo = {
  list(search?: string): InventoryItem[] {
    const db = getDb();
    const rows = search
      ? db.prepare(`SELECT * FROM inventory WHERE model LIKE @s OR manufacturer LIKE @s OR description LIKE @s ORDER BY model`)
          .all({ s: `%${search}%` }) as any[]
      : db.prepare('SELECT * FROM inventory ORDER BY model').all() as any[];
    return rows.map(mapInv);
  },
  get(id: string): InventoryItem | null {
    const r = getDb().prepare('SELECT * FROM inventory WHERE id = ?').get(id) as any;
    return r ? mapInv(r) : null;
  },
  upsert(input: Partial<InventoryItem>): InventoryItem {
    const db = getDb();
    const id = input.id ?? uuid();
    const ts = now();
    const exists = input.id && db.prepare('SELECT 1 FROM inventory WHERE id = ?').get(input.id);
    if (exists) {
      db.prepare(`UPDATE inventory SET type=?, manufacturer=?, model=?, description=?,
        quantity=?, unit_price=?, updated_at=? WHERE id=?`)
        .run(input.type ?? 'other', input.manufacturer ?? null, input.model ?? null,
          input.description ?? null, input.quantity ?? null, input.unitPrice ?? null, ts, id);
    } else {
      db.prepare(`INSERT INTO inventory (id, type, manufacturer, model, description, quantity, unit_price, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, input.type ?? 'other', input.manufacturer ?? null, input.model ?? null,
          input.description ?? null, input.quantity ?? null, input.unitPrice ?? null, ts, ts);
    }
    return this.get(id)!;
  },
  remove(id: string): void {
    getDb().prepare('DELETE FROM inventory WHERE id = ?').run(id);
  },
};

// ---------------------------------------------------------------------------
// Stock units — one row per PHYSICAL item, identified by its serial number.
// ---------------------------------------------------------------------------
function mapUnit(r: any): StockUnit {
  return {
    id: r.id, serialNumber: r.serial_number,
    inventoryItemId: r.inventory_item_id ?? undefined,
    itemName: r.item_name, type: r.type,
    manufacturer: r.manufacturer ?? undefined,
    unitPrice: r.unit_price ?? undefined,
    status: r.status,
    clientId: r.client_id ?? undefined,
    branchId: r.branch_id ?? undefined,
    deviceId: r.device_id ?? undefined,
    ageDays: r.age_days ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/**
 * Serials are compared case-insensitively and without separators.
 *
 * The shop's own stock take mixes cases for the same format, barcode scanners
 * report whatever the label encodes, and a person retyping a serial rarely
 * reproduces the dashes. Matching on this key means all of those find the
 * same unit, while `serial_number` keeps the original for display.
 */
export function serialKey(serial: string): string {
  return serial.trim().toLowerCase().replace(/[\s\-_/.:]/g, '');
}

export const stockUnitsRepo = {
  /** Look a unit up by serial, however it was typed or scanned. */
  findBySerial(serial: string): StockUnit | null {
    const key = serialKey(serial);
    if (!key) return null;
    const r = getDb()
      .prepare('SELECT * FROM stock_units WHERE serial_key = ? ORDER BY status = \'in_stock\' DESC LIMIT 1')
      .get(key) as any;
    return r ? mapUnit(r) : null;
  },

  get(id: string): StockUnit | null {
    const r = getDb().prepare('SELECT * FROM stock_units WHERE id = ?').get(id) as any;
    return r ? mapUnit(r) : null;
  },

  /** Browse/search the shop's serialised stock. */
  list(q: { search?: string; status?: string; limit?: number; offset?: number } = {}):
  { rows: StockUnit[]; total: number } {
    const db = getDb();
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (q.search) {
      // Match the serial the way a scanner would, and the item name the way a
      // person would.
      where.push('(serial_key LIKE @key OR item_name LIKE @raw OR serial_number LIKE @raw)');
      params.key = `%${serialKey(q.search)}%`;
      params.raw = `%${q.search.trim()}%`;
    }
    if (q.status) { where.push('status = @status'); params.status = q.status; }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = (db.prepare(`SELECT count(*) AS c FROM stock_units ${whereSql}`)
      .get(params) as { c: number }).c;
    const rows = db.prepare(
      `SELECT * FROM stock_units ${whereSql} ORDER BY item_name, serial_number
       LIMIT @limit OFFSET @offset`,
    ).all({ ...params, limit: q.limit ?? 100, offset: q.offset ?? 0 }) as any[];
    return { rows: rows.map(mapUnit), total };
  },

  upsert(input: Partial<StockUnit> & { serialNumber: string }): StockUnit {
    const db = getDb();
    const ts = now();
    const key = serialKey(input.serialNumber);
    const existing = input.id
      ? db.prepare('SELECT id FROM stock_units WHERE id = ?').get(input.id) as any
      : db.prepare('SELECT id FROM stock_units WHERE serial_key = ?').get(key) as any;
    const id = existing?.id ?? input.id ?? uuid();

    if (existing) {
      db.prepare(`UPDATE stock_units SET serial_number=?, serial_key=?, inventory_item_id=?,
        item_name=?, type=?, manufacturer=?, unit_price=?, status=?, client_id=?, branch_id=?,
        device_id=?, age_days=?, notes=?, updated_at=? WHERE id=?`)
        .run(input.serialNumber.trim(), key, input.inventoryItemId ?? null,
          input.itemName ?? '', input.type ?? 'other', input.manufacturer ?? null,
          input.unitPrice ?? null, input.status ?? 'in_stock', input.clientId ?? null,
          input.branchId ?? null, input.deviceId ?? null, input.ageDays ?? null,
          input.notes ?? null, ts, id);
    } else {
      db.prepare(`INSERT INTO stock_units (id, serial_number, serial_key, inventory_item_id,
        item_name, type, manufacturer, unit_price, status, client_id, branch_id, device_id,
        age_days, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, input.serialNumber.trim(), key, input.inventoryItemId ?? null,
          input.itemName ?? '', input.type ?? 'other', input.manufacturer ?? null,
          input.unitPrice ?? null, input.status ?? 'in_stock', input.clientId ?? null,
          input.branchId ?? null, input.deviceId ?? null, input.ageDays ?? null,
          input.notes ?? null, ts, ts);
    }
    return this.get(id)!;
  },

  /**
   * Mark a unit as installed at a client. Called when a device is created from
   * a scanned serial, so shop stock reflects what actually left the shop.
   */
  markInstalled(id: string, deviceId: string, clientId?: string, branchId?: string): void {
    getDb().prepare(
      `UPDATE stock_units SET status='installed', device_id=?, client_id=?, branch_id=?,
       updated_at=? WHERE id=?`,
    ).run(deviceId, clientId ?? null, branchId ?? null, now(), id);
  },

  /** Put a unit back into stock (device deleted or wrongly linked). */
  returnToStock(id: string): void {
    getDb().prepare(
      `UPDATE stock_units SET status='in_stock', device_id=NULL, client_id=NULL,
       branch_id=NULL, updated_at=? WHERE id=?`,
    ).run(now(), id);
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM stock_units WHERE id = ?').run(id);
  },

  counts(): { total: number; inStock: number; installed: number } {
    const db = getDb();
    const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
    return {
      total: one('SELECT count(*) AS c FROM stock_units'),
      inStock: one("SELECT count(*) AS c FROM stock_units WHERE status='in_stock'"),
      installed: one("SELECT count(*) AS c FROM stock_units WHERE status='installed'"),
    };
  },
};

// ---------------------------------------------------------------------------
// AMC contracts
// ---------------------------------------------------------------------------
function mapAmc(r: any): AmcContract {
  // usedVisits is DERIVED from the visits actually linked to this contract, so
  // the counter can never drift from reality the way a hand-typed number does.
  const used = (getDb().prepare(
    'SELECT count(*) AS c FROM visits WHERE amc_contract_id = ? AND counts_against_amc = 1',
  ).get(r.id) as { c: number }).c;

  return {
    id: r.id, clientId: r.client_id, branchId: r.branch_id ?? undefined,
    startDate: r.start_date, endDate: r.end_date,
    totalVisits: r.total_visits,
    usedVisits: used,
    unlimitedVisits: r.unlimited_visits === 1,
    amount: r.amount ?? undefined, notes: r.notes ?? undefined,
  };
}

export const amcRepo = {
  listByClient(clientId: string): AmcContract[] {
    const rows = getDb().prepare('SELECT * FROM amc_contracts WHERE client_id = ? ORDER BY end_date DESC').all(clientId) as any[];
    return rows.map(mapAmc);
  },
  get(id: string): AmcContract | null {
    const r = getDb().prepare('SELECT * FROM amc_contracts WHERE id = ?').get(id) as any;
    return r ? mapAmc(r) : null;
  },
  save(input: Partial<AmcContract>): AmcContract {
    const db = getDb();
    const id = input.id ?? uuid();
    const exists = input.id && db.prepare('SELECT 1 FROM amc_contracts WHERE id = ?').get(input.id);
    // used_visits stays in the table for older rows but is no longer authoritative.
    if (exists) {
      db.prepare(`UPDATE amc_contracts SET branch_id=?, start_date=?, end_date=?, total_visits=?,
        unlimited_visits=?, amount=?, notes=? WHERE id=?`)
        .run(input.branchId ?? null, input.startDate, input.endDate, input.totalVisits ?? 0,
          input.unlimitedVisits ? 1 : 0, input.amount ?? null, input.notes ?? null, id);
    } else {
      db.prepare(`INSERT INTO amc_contracts
        (id, client_id, branch_id, start_date, end_date, total_visits, used_visits, unlimited_visits, amount, notes)
        VALUES (?,?,?,?,?,?,0,?,?,?)`)
        .run(id, input.clientId, input.branchId ?? null, input.startDate, input.endDate,
          input.totalVisits ?? 0, input.unlimitedVisits ? 1 : 0,
          input.amount ?? null, input.notes ?? null);
    }
    return this.get(id)!;
  },

  /** Contracts covering a branch on a given date — used to auto-link visits. */
  activeFor(clientId: string, branchId: string, onDate: string): AmcContract[] {
    const rows = getDb().prepare(
      `SELECT * FROM amc_contracts
       WHERE client_id = ? AND (branch_id IS NULL OR branch_id = ?)
         AND start_date <= ? AND end_date >= ?
       ORDER BY end_date`,
    ).all(clientId, branchId, onDate, onDate) as any[];
    return rows.map(mapAmc);
  },
  remove(id: string): void {
    getDb().prepare('DELETE FROM amc_contracts WHERE id = ?').run(id);
  },
};

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------
function mapInvoice(r: any): Invoice {
  return {
    id: r.id, clientId: r.client_id, number: r.number, date: r.date,
    dueDate: r.due_date ?? undefined,
    subtotal: r.subtotal ?? 0,
    taxRate: r.tax_rate ?? 0,
    taxAmount: r.tax_amount ?? 0,
    total: r.total, paid: r.paid, status: r.status,
    trn: r.trn ?? undefined,
    items: parseJson<Invoice['items']>(r.items, []),
    terms: r.terms ?? undefined,
    notes: r.notes ?? undefined,
  };
}

/** Recompute money from the line items so the printed document always adds up. */
function computeTotals(items: Invoice['items'], taxRate: number, fallbackTotal?: number) {
  const subtotal = items.length
    ? items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0)
    : (fallbackTotal ?? 0);
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  return { subtotal, taxAmount, total: Math.round((subtotal + taxAmount) * 100) / 100 };
}

export const invoicesRepo = {
  listByClient(clientId: string): Invoice[] {
    const rows = getDb().prepare('SELECT * FROM invoices WHERE client_id = ? ORDER BY date DESC').all(clientId) as any[];
    return rows.map(mapInvoice);
  },
  get(id: string): Invoice | null {
    const r = getDb().prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
    return r ? mapInvoice(r) : null;
  },
  save(input: Partial<Invoice>): Invoice {
    const db = getDb();
    const id = input.id ?? uuid();
    const items = input.items ?? [];
    const taxRate = input.taxRate ?? 0;
    const { subtotal, taxAmount, total } = computeTotals(items, taxRate, input.total);
    const paid = input.paid ?? 0;
    const status: Invoice['status'] = paid <= 0 ? 'unpaid' : paid >= total ? 'paid' : 'partial';
    const exists = input.id && db.prepare('SELECT 1 FROM invoices WHERE id = ?').get(input.id);

    const params = {
      id, number: input.number ?? '', date: input.date ?? now().slice(0, 10),
      due_date: input.dueDate ?? null, subtotal, tax_rate: taxRate, tax_amount: taxAmount,
      total, paid, status, trn: input.trn ?? null,
      items: JSON.stringify(items), terms: input.terms ?? null, notes: input.notes ?? null,
    };

    if (exists) {
      db.prepare(`UPDATE invoices SET number=@number, date=@date, due_date=@due_date,
        subtotal=@subtotal, tax_rate=@tax_rate, tax_amount=@tax_amount, total=@total,
        paid=@paid, status=@status, trn=@trn, items=@items, terms=@terms, notes=@notes
        WHERE id=@id`).run(params);
    } else {
      db.prepare(`INSERT INTO invoices
        (id, client_id, number, date, due_date, subtotal, tax_rate, tax_amount, total, paid, status, trn, items, terms, notes)
        VALUES (@id,@client_id,@number,@date,@due_date,@subtotal,@tax_rate,@tax_amount,@total,@paid,@status,@trn,@items,@terms,@notes)`)
        .run({ ...params, client_id: input.clientId });
    }
    return this.get(id)!;
  },
  remove(id: string): void {
    getDb().prepare('DELETE FROM invoices WHERE id = ?').run(id);
  },
  /** Clients with overdue unpaid invoices — used to auto-flag bad payers. */
  overdueClientIds(): string[] {
    const today = new Date().toISOString().slice(0, 10);
    const rows = getDb().prepare(
      `SELECT DISTINCT client_id FROM invoices WHERE status != 'paid' AND due_date IS NOT NULL AND due_date < ?`,
    ).all(today) as { client_id: string }[];
    return rows.map((r) => r.client_id);
  },
};

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------
function mapReminder(r: any): Reminder {
  return {
    id: r.id, kind: r.kind, clientId: r.client_id ?? undefined,
    branchId: r.branch_id ?? undefined, deviceId: r.device_id ?? undefined,
    title: r.title, dueDate: r.due_date, leadDays: r.lead_days,
    done: toBool(r.done), createdAt: r.created_at,
  };
}

export const remindersRepo = {
  all(): Reminder[] {
    const rows = getDb().prepare('SELECT * FROM reminders ORDER BY due_date').all() as any[];
    return rows.map(mapReminder);
  },
  upcoming(days: number): Reminder[] {
    const today = new Date().toISOString().slice(0, 10);
    const limit = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const rows = getDb().prepare(
      'SELECT * FROM reminders WHERE done = 0 AND due_date >= ? AND due_date <= ? ORDER BY due_date',
    ).all(today, limit) as any[];
    return rows.map(mapReminder);
  },
  /** Due now, accounting for lead time (used for desktop notifications). */
  dueNow(): Reminder[] {
    const rows = getDb().prepare(
      `SELECT * FROM reminders WHERE done = 0
       AND date(due_date, '-' || lead_days || ' days') <= date('now') ORDER BY due_date`,
    ).all() as any[];
    return rows.map(mapReminder);
  },
  get(id: string): Reminder | null {
    const r = getDb().prepare('SELECT * FROM reminders WHERE id = ?').get(id) as any;
    return r ? mapReminder(r) : null;
  },
  save(input: Partial<Reminder>): Reminder {
    const db = getDb();
    const id = input.id ?? uuid();
    const exists = input.id && db.prepare('SELECT 1 FROM reminders WHERE id = ?').get(input.id);
    if (exists) {
      db.prepare(`UPDATE reminders SET kind=?, client_id=?, branch_id=?, device_id=?, title=?,
        due_date=?, lead_days=?, done=? WHERE id=?`)
        .run(input.kind ?? 'custom', input.clientId ?? null, input.branchId ?? null,
          input.deviceId ?? null, input.title ?? '', input.dueDate, input.leadDays ?? 30,
          fromBool(input.done), id);
    } else {
      db.prepare(`INSERT INTO reminders (id, kind, client_id, branch_id, device_id, title, due_date, lead_days, done, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(id, input.kind ?? 'custom', input.clientId ?? null, input.branchId ?? null,
          input.deviceId ?? null, input.title ?? '', input.dueDate, input.leadDays ?? 30,
          fromBool(input.done), now());
    }
    return this.get(id)!;
  },
  markDone(id: string): void {
    getDb().prepare('UPDATE reminders SET done = 1 WHERE id = ?').run(id);
  },
  remove(id: string): void {
    getDb().prepare('DELETE FROM reminders WHERE id = ?').run(id);
  },
};

// ---------------------------------------------------------------------------
// Status labels
// ---------------------------------------------------------------------------
export const statusLabelsRepo = {
  list(): StatusLabel[] {
    const rows = getDb().prepare('SELECT * FROM status_labels ORDER BY sort, name_ar').all() as any[];
    return rows.map((r) => ({
      id: r.id, name_ar: r.name_ar, name_en: r.name_en, color: r.color, isSystem: toBool(r.is_system),
    }));
  },
  save(input: Partial<StatusLabel>): StatusLabel {
    const db = getDb();
    const id = input.id ?? uuid();
    const exists = input.id && db.prepare('SELECT 1 FROM status_labels WHERE id = ?').get(input.id);
    if (exists) {
      db.prepare('UPDATE status_labels SET name_ar=?, name_en=?, color=? WHERE id=?')
        .run(input.name_ar ?? '', input.name_en ?? '', input.color ?? '#1E88E5', id);
    } else {
      const maxSort = (db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM status_labels').get() as { m: number }).m;
      db.prepare('INSERT INTO status_labels (id, name_ar, name_en, color, is_system, sort) VALUES (?,?,?,?,0,?)')
        .run(id, input.name_ar ?? '', input.name_en ?? '', input.color ?? '#1E88E5', maxSort + 1);
    }
    return this.list().find((l) => l.id === id)!;
  },
  remove(id: string): void {
    // System labels are protected from deletion.
    getDb().prepare('DELETE FROM status_labels WHERE id = ? AND is_system = 0').run(id);
  },
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export const settingsRepo = {
  get(key: string): string | null {
    const r = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value ?? null;
  },
  set(key: string, value: string): void {
    getDb().prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  },
};

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
export const auditRepo = {
  log(action: string, entity: string, entityId?: string, summary?: string, userId?: string): void {
    getDb().prepare('INSERT INTO audit_log (id, at, user_id, action, entity, entity_id, summary) VALUES (?,?,?,?,?,?,?)')
      .run(uuid(), now(), userId ?? null, action, entity, entityId ?? null, summary ?? null);
  },
  recent(limit: number): AuditEntry[] {
    const rows = getDb().prepare('SELECT * FROM audit_log ORDER BY at DESC LIMIT ?').all(Math.min(limit, 1000)) as any[];
    return rows.map((r) => ({
      id: r.id, at: r.at, userId: r.user_id ?? undefined, action: r.action,
      entity: r.entity, entityId: r.entity_id ?? undefined, summary: r.summary ?? undefined,
    }));
  },
};

// ---------------------------------------------------------------------------
// Global search (Ctrl+K) — name, branch, serial, phone, model
// ---------------------------------------------------------------------------
export const searchRepo = {
  global(term: string): GlobalSearchResult {
    const db = getDb();
    const s = `%${term}%`;
    const clients = db.prepare(
      'SELECT * FROM clients WHERE name_ar LIKE ? OR name_en LIKE ? OR code LIKE ? LIMIT 25',
    ).all(s, s, s) as any[];
    const branches = db.prepare(
      'SELECT * FROM branches WHERE name_ar LIKE ? OR name_en LIKE ? OR address LIKE ? LIMIT 25',
    ).all(s, s, s) as any[];
    const devices = db.prepare(
      'SELECT * FROM devices WHERE serial_number LIKE ? OR model LIKE ? OR label LIKE ? OR manufacturer LIKE ? LIMIT 25',
    ).all(s, s, s, s) as any[];
    const contacts = db.prepare(
      'SELECT * FROM contacts WHERE name LIKE ? OR phones LIKE ? OR emails LIKE ? LIMIT 25',
    ).all(s, s, s) as any[];
    // Shop stock is searched by the normalised serial too, so a serial typed
    // with different dashes or casing than the label still finds its unit.
    const key = `%${serialKey(term)}%`;
    const stockUnits = db.prepare(
      `SELECT * FROM stock_units
       WHERE serial_key LIKE ? OR serial_number LIKE ? OR item_name LIKE ?
       ORDER BY status = 'in_stock' DESC, item_name LIMIT 25`,
    ).all(key, s, s) as any[];

    return {
      stockUnits: stockUnits.map(mapUnit),
      clients: clients.map((r) => ({
        id: r.id, code: r.code, type: r.type, nameAr: r.name_ar, nameEn: r.name_en ?? undefined,
        statusLabelId: r.status_label_id ?? undefined, rating: r.rating,
        isFlagged: toBool(r.is_flagged), flagReason: r.flag_reason ?? undefined,
        notes: r.notes ?? undefined, dealCount: r.deal_count,
        createdAt: r.created_at, updatedAt: r.updated_at,
      })) as Client[],
      branches: branches.map((r) => ({
        id: r.id, clientId: r.client_id, nameAr: r.name_ar, nameEn: r.name_en ?? undefined,
        location: { address: r.address ?? undefined, lat: r.lat ?? undefined, lng: r.lng ?? undefined, mapUrl: r.map_url ?? undefined },
        statusLabelId: r.status_label_id ?? undefined, managerContact: r.manager_contact ?? undefined,
        notes: r.notes ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at,
      })) as Branch[],
      devices: devices.map((r) => ({
        id: r.id, branchId: r.branch_id, type: r.type, label: r.label ?? undefined,
        positionInBranch: r.position_in_branch ?? undefined, manufacturer: r.manufacturer ?? undefined,
        model: r.model ?? undefined, serialNumber: r.serial_number ?? undefined,
        channels: r.channels ?? undefined, capacity: r.capacity ?? undefined,
        firmware: r.firmware ?? undefined, source: r.source, installDate: r.install_date ?? undefined,
        warrantyExpiry: r.warranty_expiry ?? undefined, health: r.health ?? undefined,
        inventoryItemId: r.inventory_item_id ?? undefined, notes: r.notes ?? undefined,
        photos: [], createdAt: r.created_at, updatedAt: r.updated_at,
      })) as Device[],
      contacts: contacts.map((r) => ({
        id: r.id, clientId: r.client_id, name: r.name, role: r.role ?? undefined,
        phones: JSON.parse(r.phones || '[]'), emails: JSON.parse(r.emails || '[]'),
        isPrimary: toBool(r.is_primary), order: r.sort,
      })) as Contact[],
    };
  },
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export const dashboardRepo = {
  stats(): DashboardStats {
    const db = getDb();
    const one = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { c: number }).c;
    const monthStart = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    })();
    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    return {
      clients: one('SELECT count(*) AS c FROM clients'),
      branches: one('SELECT count(*) AS c FROM branches'),
      devices: one('SELECT count(*) AS c FROM devices'),
      camerasTotal: one(`SELECT count(*) AS c FROM devices WHERE type = 'camera'`),
      visitsThisMonth: one('SELECT count(*) AS c FROM visits WHERE visit_date >= ?', monthStart),
      upcomingReminders: one('SELECT count(*) AS c FROM reminders WHERE done = 0 AND due_date >= ? AND due_date <= ?', today, in30),
      expiringLicenses: one('SELECT count(*) AS c FROM camera_licenses WHERE expiry_date >= ? AND expiry_date <= ?', today, in30),
      expiringWarranties: one('SELECT count(*) AS c FROM devices WHERE warranty_expiry >= ? AND warranty_expiry <= ?', today, in30),
      flaggedClients: one('SELECT count(*) AS c FROM clients WHERE is_flagged = 1'),
    };
  },
};
