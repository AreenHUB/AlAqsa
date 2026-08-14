// ============================================================================
// AlAqsa — Devices repository (cameras, NVR/DVR, HDD, switches, UPS, ...).
// Device count per branch is unbounded — 1 or 100+ cameras both work.
// ============================================================================

import { getDb } from '../database';
import { uuid, now } from '../helpers';
import type { Device, MediaRef } from '@shared/types';

interface DeviceRow {
  id: string; branch_id: string; type: string; label: string | null;
  position_in_branch: string | null; manufacturer: string | null; model: string | null;
  serial_number: string | null; channels: number | null; capacity: string | null;
  firmware: string | null; source: string; install_date: string | null;
  warranty_expiry: string | null; health: string | null; inventory_item_id: string | null;
  notes: string | null; created_at: string; updated_at: string;
}

function photosOf(deviceId: string): MediaRef[] {
  const rows = getDb().prepare(
    `SELECT m.* FROM media m
     JOIN device_photos dp ON dp.media_id = m.id
     WHERE dp.device_id = ? ORDER BY m.created_at`,
  ).all(deviceId) as any[];
  return rows.map((r) => ({
    id: r.id, fileName: r.file_name, storedPath: r.stored_path,
    mimeType: r.mime_type, sizeBytes: r.size_bytes, createdAt: r.created_at,
  }));
}

function mapDevice(r: DeviceRow): Device {
  return {
    id: r.id, branchId: r.branch_id, type: r.type as Device['type'],
    label: r.label ?? undefined, positionInBranch: r.position_in_branch ?? undefined,
    manufacturer: r.manufacturer ?? undefined, model: r.model ?? undefined,
    serialNumber: r.serial_number ?? undefined, channels: r.channels ?? undefined,
    capacity: r.capacity ?? undefined, firmware: r.firmware ?? undefined,
    source: (r.source as Device['source']) ?? 'ours',
    installDate: r.install_date ?? undefined, warrantyExpiry: r.warranty_expiry ?? undefined,
    health: (r.health as Device['health']) ?? undefined,
    inventoryItemId: r.inventory_item_id ?? undefined, notes: r.notes ?? undefined,
    photos: photosOf(r.id), createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export const devicesRepo = {
  listByBranch(branchId: string): Device[] {
    const rows = getDb().prepare('SELECT * FROM devices WHERE branch_id = ? ORDER BY type, label').all(branchId) as DeviceRow[];
    return rows.map(mapDevice);
  },

  listByClient(clientId: string): Device[] {
    const rows = getDb().prepare(
      `SELECT d.* FROM devices d JOIN branches b ON b.id = d.branch_id
       WHERE b.client_id = ? ORDER BY d.type, d.label`,
    ).all(clientId) as DeviceRow[];
    return rows.map(mapDevice);
  },

  get(id: string): Device | null {
    const r = getDb().prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | undefined;
    return r ? mapDevice(r) : null;
  },

  findBySerial(serial: string): Device | null {
    const r = getDb().prepare('SELECT * FROM devices WHERE serial_number = ?').get(serial) as DeviceRow | undefined;
    return r ? mapDevice(r) : null;
  },

  create(input: Partial<Device>): Device {
    const id = input.id ?? uuid();
    const ts = now();
    getDb().prepare(`INSERT INTO devices
      (id, branch_id, type, label, position_in_branch, manufacturer, model, serial_number,
       channels, capacity, firmware, source, install_date, warranty_expiry, health,
       inventory_item_id, notes, created_at, updated_at)
      VALUES (@id,@branch_id,@type,@label,@position_in_branch,@manufacturer,@model,@serial_number,
       @channels,@capacity,@firmware,@source,@install_date,@warranty_expiry,@health,
       @inventory_item_id,@notes,@created_at,@updated_at)`)
      .run({
        id, branch_id: input.branchId, type: input.type ?? 'camera',
        label: input.label ?? null, position_in_branch: input.positionInBranch ?? null,
        manufacturer: input.manufacturer ?? null, model: input.model ?? null,
        serial_number: input.serialNumber ?? null, channels: input.channels ?? null,
        capacity: input.capacity ?? null, firmware: input.firmware ?? null,
        source: input.source ?? 'ours', install_date: input.installDate ?? null,
        warranty_expiry: input.warrantyExpiry ?? null, health: input.health ?? null,
        inventory_item_id: input.inventoryItemId ?? null, notes: input.notes ?? null,
        created_at: ts, updated_at: ts,
      });
    return this.get(id)!;
  },

  update(id: string, patch: Partial<Device>): Device {
    const existing = this.get(id);
    if (!existing) throw new Error('NOT_FOUND');
    const m = { ...existing, ...patch, updatedAt: now() };
    getDb().prepare(`UPDATE devices SET
      type=@type, label=@label, position_in_branch=@position_in_branch, manufacturer=@manufacturer,
      model=@model, serial_number=@serial_number, channels=@channels, capacity=@capacity,
      firmware=@firmware, source=@source, install_date=@install_date, warranty_expiry=@warranty_expiry,
      health=@health, inventory_item_id=@inventory_item_id, notes=@notes, updated_at=@updated_at
      WHERE id=@id`)
      .run({
        id, type: m.type, label: m.label ?? null, position_in_branch: m.positionInBranch ?? null,
        manufacturer: m.manufacturer ?? null, model: m.model ?? null,
        serial_number: m.serialNumber ?? null, channels: m.channels ?? null,
        capacity: m.capacity ?? null, firmware: m.firmware ?? null, source: m.source,
        install_date: m.installDate ?? null, warranty_expiry: m.warrantyExpiry ?? null,
        health: m.health ?? null, inventory_item_id: m.inventoryItemId ?? null,
        notes: m.notes ?? null, updated_at: m.updatedAt,
      });
    return this.get(id)!;
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM devices WHERE id = ?').run(id);
  },

  attachPhoto(deviceId: string, mediaId: string): void {
    getDb().prepare('INSERT OR IGNORE INTO device_photos (device_id, media_id) VALUES (?,?)').run(deviceId, mediaId);
  },

  /** Devices whose warranty expires within `days` (for reminders/dashboard). */
  expiringWarranties(days: number): Device[] {
    const limit = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const rows = getDb().prepare(
      `SELECT * FROM devices WHERE warranty_expiry IS NOT NULL
       AND warranty_expiry >= ? AND warranty_expiry <= ? ORDER BY warranty_expiry`,
    ).all(today, limit) as DeviceRow[];
    return rows.map(mapDevice);
  },

  countAll(): number {
    return (getDb().prepare('SELECT count(*) AS c FROM devices').get() as { c: number }).c;
  },

  countByType(type: string): number {
    return (getDb().prepare('SELECT count(*) AS c FROM devices WHERE type = ?').get(type) as { c: number }).c;
  },
};
