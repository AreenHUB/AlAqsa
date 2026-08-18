// ============================================================================
// AlAqsa — Clients & Contacts repository.
// ============================================================================

import { getDb } from '../database';
import { uuid, now, parseJson, toBool, fromBool, nextClientCode } from '../helpers';
import type { Client, Contact } from '@shared/types';
import type { ClientQuery } from '@shared/ipc';

interface ClientRow {
  id: string; code: string; type: string; name_ar: string; name_en: string | null;
  status_label_id: string | null; rating: number; is_flagged: number;
  flag_reason: string | null; notes: string | null; deal_count: number;
  created_at: string; updated_at: string;
}

function mapClient(r: ClientRow): Client {
  return {
    id: r.id, code: r.code, type: r.type as Client['type'], nameAr: r.name_ar,
    nameEn: r.name_en ?? undefined, statusLabelId: r.status_label_id ?? undefined,
    rating: r.rating, rated: toBool((r as any).rated), isFlagged: toBool(r.is_flagged),
    flagReason: r.flag_reason ?? undefined,
    notes: r.notes ?? undefined, dealCount: r.deal_count,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export const clientsRepo = {
  list(q: ClientQuery): { rows: Client[]; total: number } {
    const db = getDb();
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (q.search) {
      where.push('(name_ar LIKE @s OR name_en LIKE @s OR code LIKE @s)');
      params.s = `%${q.search}%`;
    }
    if (q.type) { where.push('type = @type'); params.type = q.type; }
    if (q.statusLabelId) { where.push('status_label_id = @slid'); params.slid = q.statusLabelId; }
    if (q.flaggedOnly) { where.push('is_flagged = 1'); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const allowedSort = new Set(['name_ar', 'name_en', 'code', 'rating', 'deal_count', 'created_at', 'updated_at']);
    const sortBy = allowedSort.has(q.sortBy || '') ? q.sortBy : 'updated_at';
    const sortDir = q.sortDir === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 1000);
    const offset = Math.max(q.offset ?? 0, 0);

    const total = (db.prepare(`SELECT count(*) AS c FROM clients ${whereSql}`).get(params) as { c: number }).c;
    // Sort strictly by the requested column. Flagged clients are highlighted in
    // red rather than forced to the top, so an explicit sort is never overridden.
    const rows = db
      .prepare(`SELECT * FROM clients ${whereSql} ORDER BY ${sortBy} ${sortDir} LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit, offset }) as ClientRow[];
    return { rows: rows.map(mapClient), total };
  },

  get(id: string): Client | null {
    const r = getDb().prepare('SELECT * FROM clients WHERE id = ?').get(id) as ClientRow | undefined;
    return r ? mapClient(r) : null;
  },

  create(input: Partial<Client>): Client {
    const db = getDb();
    const id = input.id ?? uuid();
    const ts = now();
    const maxRow = db.prepare(`SELECT MAX(CAST(substr(code, 5) AS INTEGER)) AS m FROM clients WHERE code LIKE 'ALQ-%'`).get() as { m: number | null };
    const code = input.code ?? nextClientCode(maxRow.m ?? 0);
    db.prepare(`INSERT INTO clients
      (id, code, type, name_ar, name_en, status_label_id, rating, rated, is_flagged, flag_reason, notes, deal_count, created_at, updated_at)
      VALUES (@id,@code,@type,@name_ar,@name_en,@status_label_id,@rating,@rated,@is_flagged,@flag_reason,@notes,@deal_count,@created_at,@updated_at)`)
      .run({
        id, code, type: input.type ?? 'person', name_ar: input.nameAr ?? '',
        name_en: input.nameEn ?? null, status_label_id: input.statusLabelId ?? null,
        rating: input.rating ?? 0,
        // A rating only counts once someone actually gives one.
        rated: fromBool(input.rated ?? ((input.rating ?? 0) > 0)),
        is_flagged: fromBool(input.isFlagged),
        flag_reason: input.flagReason ?? null, notes: input.notes ?? null,
        deal_count: input.dealCount ?? 0, created_at: ts, updated_at: ts,
      });
    return this.get(id)!;
  },

  update(id: string, patch: Partial<Client>): Client {
    const db = getDb();
    const existing = this.get(id);
    if (!existing) throw new Error('NOT_FOUND');
    const merged = { ...existing, ...patch, updatedAt: now() };
    db.prepare(`UPDATE clients SET
      type=@type, name_ar=@name_ar, name_en=@name_en, status_label_id=@status_label_id,
      rating=@rating, rated=@rated, is_flagged=@is_flagged, flag_reason=@flag_reason, notes=@notes,
      deal_count=@deal_count, updated_at=@updated_at WHERE id=@id`)
      .run({
        id, type: merged.type, name_ar: merged.nameAr, name_en: merged.nameEn ?? null,
        status_label_id: merged.statusLabelId ?? null, rating: merged.rating,
        rated: fromBool(merged.rated ?? (merged.rating > 0)),
        is_flagged: fromBool(merged.isFlagged), flag_reason: merged.flagReason ?? null,
        notes: merged.notes ?? null, deal_count: merged.dealCount, updated_at: merged.updatedAt,
      });
    return this.get(id)!;
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM clients WHERE id = ?').run(id);
  },

  contacts(clientId: string): Contact[] {
    const rows = getDb().prepare('SELECT * FROM contacts WHERE client_id = ? ORDER BY sort').all(clientId) as any[];
    return rows.map((r) => ({
      id: r.id, clientId: r.client_id, name: r.name, role: r.role ?? undefined,
      phones: parseJson<string[]>(r.phones, []), emails: parseJson<string[]>(r.emails, []),
      isPrimary: toBool(r.is_primary), order: r.sort,
    }));
  },

  saveContacts(clientId: string, contacts: Contact[]): Contact[] {
    const db = getDb();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM contacts WHERE client_id = ?').run(clientId);
      const ins = db.prepare(`INSERT INTO contacts (id, client_id, name, role, phones, emails, is_primary, sort)
        VALUES (?,?,?,?,?,?,?,?)`);
      // Callers may send blank ids for new rows — always mint one then.
      contacts.forEach((c, i) => ins.run(
        c.id || uuid(), clientId, c.name, c.role ?? null,
        JSON.stringify(c.phones ?? []), JSON.stringify(c.emails ?? []),
        fromBool(c.isPrimary), c.order ?? i,
      ));
    });
    tx();
    return this.contacts(clientId);
  },
};
