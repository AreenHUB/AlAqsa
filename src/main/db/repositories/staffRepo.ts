// ============================================================================
// AlAqsa — Shop staff directory + dated note entries.
//
// Staff exist so a technician name is picked from a list rather than retyped
// (and mis-spelled) on every visit, which also makes per-technician activity
// reporting possible. A "temporary" member covers the one-off helper case.
// ============================================================================

import { getDb } from '../database';
import { uuid, now, toBool, fromBool } from '../helpers';
import type { StaffMember, NoteEntry } from '@shared/types';

function mapStaff(r: any): StaffMember {
  return {
    id: r.id, name: r.name, role: r.role ?? undefined,
    phone: r.phone ?? undefined, email: r.email ?? undefined,
    active: toBool(r.active), isTemporary: toBool(r.is_temporary),
    notes: r.notes ?? undefined, createdAt: r.created_at,
  };
}

export const staffRepo = {
  list(includeInactive = false): StaffMember[] {
    const sql = includeInactive
      ? 'SELECT * FROM staff ORDER BY is_temporary, name'
      : 'SELECT * FROM staff WHERE active = 1 ORDER BY is_temporary, name';
    return (getDb().prepare(sql).all() as any[]).map(mapStaff);
  },

  get(id: string): StaffMember | null {
    const r = getDb().prepare('SELECT * FROM staff WHERE id = ?').get(id) as any;
    return r ? mapStaff(r) : null;
  },

  findByName(name: string): StaffMember | null {
    const r = getDb().prepare('SELECT * FROM staff WHERE name = ? COLLATE NOCASE').get(name.trim()) as any;
    return r ? mapStaff(r) : null;
  },

  save(input: Partial<StaffMember>): StaffMember {
    const db = getDb();
    const id = input.id ?? uuid();
    const exists = input.id && db.prepare('SELECT 1 FROM staff WHERE id = ?').get(input.id);
    if (exists) {
      db.prepare(`UPDATE staff SET name=?, role=?, phone=?, email=?, active=?, is_temporary=?, notes=? WHERE id=?`)
        .run(input.name ?? '', input.role ?? null, input.phone ?? null, input.email ?? null,
          fromBool(input.active !== false), fromBool(input.isTemporary), input.notes ?? null, id);
    } else {
      db.prepare(`INSERT INTO staff (id, name, role, phone, email, active, is_temporary, notes, created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, input.name ?? '', input.role ?? null, input.phone ?? null, input.email ?? null,
          fromBool(input.active !== false), fromBool(input.isTemporary), input.notes ?? null, now());
    }
    return this.get(id)!;
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM staff WHERE id = ?').run(id);
  },

  /**
   * Per-technician activity: visit counts by type plus the last visit date.
   * Counts visits recorded against the staff id, falling back to the free-text
   * technician name for visits saved before the directory existed.
   */
  activity(fromDate?: string, toDate?: string): {
    staffId?: string; name: string; total: number;
    maintenance: number; installation: number; repair: number;
    lastVisit?: string;
  }[] {
    const db = getDb();
    const where: string[] = [];
    const params: any[] = [];
    if (fromDate) { where.push('v.visit_date >= ?'); params.push(fromDate); }
    if (toDate) { where.push('v.visit_date <= ?'); params.push(toDate); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT
        COALESCE(s.id, '')                    AS staff_id,
        COALESCE(s.name, v.technician, '—')   AS name,
        COUNT(*)                              AS total,
        SUM(CASE WHEN v.type = 'maintenance'  THEN 1 ELSE 0 END) AS maintenance,
        SUM(CASE WHEN v.type = 'installation' THEN 1 ELSE 0 END) AS installation,
        SUM(CASE WHEN v.type = 'repair'       THEN 1 ELSE 0 END) AS repair,
        MAX(v.visit_date)                     AS last_visit
      FROM visits v
      LEFT JOIN staff s ON s.id = v.technician_id
      ${whereSql}
      GROUP BY COALESCE(s.id, v.technician)
      HAVING name != '—'
      ORDER BY total DESC
    `).all(...params) as any[];

    return rows.map((r) => ({
      staffId: r.staff_id || undefined,
      name: r.name,
      total: r.total,
      maintenance: r.maintenance,
      installation: r.installation,
      repair: r.repair,
      lastVisit: r.last_visit ?? undefined,
    }));
  },
};

// ---------------------------------------------------------------------------
// Note entries — a dated log of things worth remembering about a client or
// branch ("the gate code is X", "the owner disputed the last invoice").
// ---------------------------------------------------------------------------
function mapNote(r: any): NoteEntry {
  return {
    id: r.id, clientId: r.client_id ?? undefined, branchId: r.branch_id ?? undefined,
    deviceId: r.device_id ?? undefined, body: r.body, author: r.author ?? undefined,
    pinned: toBool(r.pinned), createdAt: r.created_at,
  };
}

export const notesRepo = {
  listByClient(clientId: string): NoteEntry[] {
    return (getDb().prepare(
      'SELECT * FROM note_entries WHERE client_id = ? ORDER BY pinned DESC, created_at DESC',
    ).all(clientId) as any[]).map(mapNote);
  },

  listByBranch(branchId: string): NoteEntry[] {
    return (getDb().prepare(
      'SELECT * FROM note_entries WHERE branch_id = ? ORDER BY pinned DESC, created_at DESC',
    ).all(branchId) as any[]).map(mapNote);
  },

  get(id: string): NoteEntry | null {
    const r = getDb().prepare('SELECT * FROM note_entries WHERE id = ?').get(id) as any;
    return r ? mapNote(r) : null;
  },

  save(input: Partial<NoteEntry>): NoteEntry {
    const db = getDb();
    const id = input.id ?? uuid();
    const exists = input.id && db.prepare('SELECT 1 FROM note_entries WHERE id = ?').get(input.id);
    if (exists) {
      db.prepare('UPDATE note_entries SET body=?, author=?, pinned=?, branch_id=?, device_id=? WHERE id=?')
        .run(input.body ?? '', input.author ?? null, fromBool(input.pinned),
          input.branchId ?? null, input.deviceId ?? null, id);
    } else {
      db.prepare(`INSERT INTO note_entries (id, client_id, branch_id, device_id, body, author, pinned, created_at)
        VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, input.clientId ?? null, input.branchId ?? null, input.deviceId ?? null,
          input.body ?? '', input.author ?? null, fromBool(input.pinned), now());
    }
    return this.get(id)!;
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM note_entries WHERE id = ?').run(id);
  },
};
