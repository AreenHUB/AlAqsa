// ============================================================================
// AlAqsa — Branches repository.
// ============================================================================

import { getDb } from '../database';
import { uuid, now, toBool } from '../helpers';
import type { Branch } from '@shared/types';

interface BranchRow {
  id: string; client_id: string; name_ar: string; name_en: string | null;
  address: string | null; lat: number | null; lng: number | null; map_url: string | null;
  status_label_id: string | null; manager_contact: string | null; notes: string | null;
  created_at: string; updated_at: string;
}

function mapBranch(r: BranchRow): Branch {
  return {
    id: r.id, clientId: r.client_id, nameAr: r.name_ar, nameEn: r.name_en ?? undefined,
    location: {
      address: r.address ?? undefined, lat: r.lat ?? undefined,
      lng: r.lng ?? undefined, mapUrl: r.map_url ?? undefined,
    },
    statusLabelId: r.status_label_id ?? undefined,
    managerContact: r.manager_contact ?? undefined, notes: r.notes ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export const branchesRepo = {
  listByClient(clientId: string): Branch[] {
    const rows = getDb().prepare('SELECT * FROM branches WHERE client_id = ? ORDER BY name_ar').all(clientId) as BranchRow[];
    return rows.map(mapBranch);
  },

  get(id: string): Branch | null {
    const r = getDb().prepare('SELECT * FROM branches WHERE id = ?').get(id) as BranchRow | undefined;
    return r ? mapBranch(r) : null;
  },

  create(input: Partial<Branch>): Branch {
    const db = getDb();
    const id = input.id ?? uuid();
    const ts = now();
    const loc = input.location ?? {};
    db.prepare(`INSERT INTO branches
      (id, client_id, name_ar, name_en, address, lat, lng, map_url, status_label_id, manager_contact, notes, created_at, updated_at)
      VALUES (@id,@client_id,@name_ar,@name_en,@address,@lat,@lng,@map_url,@status_label_id,@manager_contact,@notes,@created_at,@updated_at)`)
      .run({
        id, client_id: input.clientId, name_ar: input.nameAr ?? '', name_en: input.nameEn ?? null,
        address: loc.address ?? null, lat: loc.lat ?? null, lng: loc.lng ?? null, map_url: loc.mapUrl ?? null,
        status_label_id: input.statusLabelId ?? null, manager_contact: input.managerContact ?? null,
        notes: input.notes ?? null, created_at: ts, updated_at: ts,
      });
    return this.get(id)!;
  },

  update(id: string, patch: Partial<Branch>): Branch {
    const existing = this.get(id);
    if (!existing) throw new Error('NOT_FOUND');
    const m = { ...existing, ...patch, location: { ...existing.location, ...patch.location }, updatedAt: now() };
    getDb().prepare(`UPDATE branches SET
      name_ar=@name_ar, name_en=@name_en, address=@address, lat=@lat, lng=@lng, map_url=@map_url,
      status_label_id=@status_label_id, manager_contact=@manager_contact, notes=@notes, updated_at=@updated_at
      WHERE id=@id`)
      .run({
        id, name_ar: m.nameAr, name_en: m.nameEn ?? null, address: m.location.address ?? null,
        lat: m.location.lat ?? null, lng: m.location.lng ?? null, map_url: m.location.mapUrl ?? null,
        status_label_id: m.statusLabelId ?? null, manager_contact: m.managerContact ?? null,
        notes: m.notes ?? null, updated_at: m.updatedAt,
      });
    return this.get(id)!;
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM branches WHERE id = ?').run(id);
  },

  countByClient(clientId: string): number {
    return (getDb().prepare('SELECT count(*) AS c FROM branches WHERE client_id = ?').get(clientId) as { c: number }).c;
  },
};
