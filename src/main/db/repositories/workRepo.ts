// ============================================================================
// AlAqsa — Daily work schedule, requirement checklists, and quotations.
//
// These three share a file because they are the "before the visit" side of the
// shop: what is planned for today, what paperwork a job needs, and what was
// quoted to the client before any of it was agreed.
// ============================================================================

import { getDb } from '../database';
import { uuid, now, toBool, fromBool, parseJson } from '../helpers';
import type {
  DayJob, RequirementTemplate, RequirementItem, RequirementCase,
  RequirementCaseItem, Quotation, QuotationItem,
} from '@shared/types';

// ---------------------------------------------------------------------------
// Daily work schedule
// ---------------------------------------------------------------------------
function mapJob(r: any, staffIds: string[] = [], staffNames: string[] = []): DayJob {
  return {
    id: r.id, jobDate: r.job_date,
    clientId: r.client_id ?? undefined, branchId: r.branch_id ?? undefined,
    placeName: r.place_name ?? undefined,
    contactName: r.contact_name ?? undefined, contactPhone: r.contact_phone ?? undefined,
    location: r.location ?? undefined, mapUrl: r.map_url ?? undefined,
    workDescription: r.work_description ?? undefined,
    status: r.status, startTime: r.start_time ?? undefined,
    priority: r.priority, notes: r.notes ?? undefined,
    visitId: r.visit_id ?? undefined,
    staffIds, staffNames,
    clientName: r.client_name ?? undefined,
    branchName: r.branch_name ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** Read the crew for a set of jobs in one query rather than one query per job. */
function crewsFor(jobIds: string[]): Map<string, { ids: string[]; names: string[] }> {
  const out = new Map<string, { ids: string[]; names: string[] }>();
  if (!jobIds.length) return out;
  const marks = jobIds.map(() => '?').join(',');
  const rows = getDb().prepare(
    `SELECT js.job_id, js.staff_id, s.name
     FROM day_job_staff js LEFT JOIN staff s ON s.id = js.staff_id
     WHERE js.job_id IN (${marks})`,
  ).all(...jobIds) as any[];
  for (const r of rows) {
    if (!out.has(r.job_id)) out.set(r.job_id, { ids: [], names: [] });
    const e = out.get(r.job_id)!;
    e.ids.push(r.staff_id);
    if (r.name) e.names.push(r.name);
  }
  return out;
}

const JOB_SELECT = `
  SELECT j.*, c.name_ar AS client_name, b.name_ar AS branch_name
  FROM day_jobs j
  LEFT JOIN clients c ON c.id = j.client_id
  LEFT JOIN branches b ON b.id = j.branch_id
`;

export const dayJobsRepo = {
  /** Every job booked for one day, in the order the crew should work through. */
  listByDate(date: string): DayJob[] {
    const rows = getDb().prepare(
      `${JOB_SELECT} WHERE j.job_date = ? ORDER BY j.priority DESC, j.start_time IS NULL, j.start_time`,
    ).all(date) as any[];
    const crews = crewsFor(rows.map((r) => r.id));
    return rows.map((r) => {
      const c = crews.get(r.id);
      return mapJob(r, c?.ids ?? [], c?.names ?? []);
    });
  },

  /** Jobs in a date range, for the week view and for staff activity. */
  listBetween(from: string, to: string): DayJob[] {
    const rows = getDb().prepare(
      `${JOB_SELECT} WHERE j.job_date BETWEEN ? AND ?
       ORDER BY j.job_date, j.priority DESC, j.start_time IS NULL, j.start_time`,
    ).all(from, to) as any[];
    const crews = crewsFor(rows.map((r) => r.id));
    return rows.map((r) => {
      const c = crews.get(r.id);
      return mapJob(r, c?.ids ?? [], c?.names ?? []);
    });
  },

  listByClient(clientId: string): DayJob[] {
    const rows = getDb().prepare(
      `${JOB_SELECT} WHERE j.client_id = ? ORDER BY j.job_date DESC LIMIT 100`,
    ).all(clientId) as any[];
    const crews = crewsFor(rows.map((r) => r.id));
    return rows.map((r) => {
      const c = crews.get(r.id);
      return mapJob(r, c?.ids ?? [], c?.names ?? []);
    });
  },

  get(id: string): DayJob | null {
    const r = getDb().prepare(`${JOB_SELECT} WHERE j.id = ?`).get(id) as any;
    if (!r) return null;
    const c = crewsFor([id]).get(id);
    return mapJob(r, c?.ids ?? [], c?.names ?? []);
  },

  save(input: Partial<DayJob> & { jobDate: string }): DayJob {
    const db = getDb();
    const id = input.id ?? uuid();
    const ts = now();
    const exists = input.id && db.prepare('SELECT 1 FROM day_jobs WHERE id = ?').get(input.id);

    // Merge onto the stored row rather than overwriting it. Callers that only
    // mean to change one thing — reassigning the crew, moving the time — must
    // not blank the address and the phone number by omitting them.
    const current = exists ? this.get(id) : null;
    const merged = { ...(current ?? {}), ...input } as Partial<DayJob> & { jobDate: string };

    const tx = db.transaction(() => {
      if (exists) {
        db.prepare(`UPDATE day_jobs SET job_date=@job_date, client_id=@client_id,
          branch_id=@branch_id, place_name=@place_name, contact_name=@contact_name,
          contact_phone=@contact_phone, location=@location, map_url=@map_url,
          work_description=@work_description, status=@status, start_time=@start_time,
          priority=@priority, notes=@notes, visit_id=@visit_id, updated_at=@updated_at
          WHERE id=@id`).run(rowFor(id, merged, ts));
      } else {
        db.prepare(`INSERT INTO day_jobs (id, job_date, client_id, branch_id, place_name,
          contact_name, contact_phone, location, map_url, work_description, status,
          start_time, priority, notes, visit_id, created_at, updated_at)
          VALUES (@id,@job_date,@client_id,@branch_id,@place_name,@contact_name,
          @contact_phone,@location,@map_url,@work_description,@status,@start_time,
          @priority,@notes,@visit_id,@created_at,@updated_at)`)
          .run({ ...rowFor(id, merged, ts), created_at: ts });
      }

      // The crew is replaced wholesale: it is a small set and "who is going
      // today" is decided fresh each time rather than edited member by member.
      if (input.staffIds) {
        db.prepare('DELETE FROM day_job_staff WHERE job_id = ?').run(id);
        const ins = db.prepare('INSERT OR IGNORE INTO day_job_staff (job_id, staff_id) VALUES (?,?)');
        for (const sid of input.staffIds) if (sid) ins.run(id, sid);
      }
    });
    tx();
    return this.get(id)!;
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM day_jobs WHERE id = ?').run(id);
  },

  setStatus(id: string, status: string): void {
    getDb().prepare('UPDATE day_jobs SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now(), id);
  },

  /** Link the job to the visit it produced, so the day sheet shows it is done. */
  linkVisit(id: string, visitId: string): void {
    getDb().prepare("UPDATE day_jobs SET visit_id = ?, status = 'done', updated_at = ? WHERE id = ?")
      .run(visitId, now(), id);
  },

  countsForDate(date: string): { total: number; done: number; planned: number } {
    const db = getDb();
    const one = (sql: string) => (db.prepare(sql).get(date) as { c: number }).c;
    return {
      total: one('SELECT count(*) AS c FROM day_jobs WHERE job_date = ?'),
      done: one("SELECT count(*) AS c FROM day_jobs WHERE job_date = ? AND status = 'done'"),
      planned: one("SELECT count(*) AS c FROM day_jobs WHERE job_date = ? AND status = 'planned'"),
    };
  },
};

function rowFor(id: string, i: Partial<DayJob>, ts: string) {
  return {
    id, job_date: i.jobDate, client_id: i.clientId ?? null, branch_id: i.branchId ?? null,
    place_name: i.placeName ?? null, contact_name: i.contactName ?? null,
    contact_phone: i.contactPhone ?? null, location: i.location ?? null,
    map_url: i.mapUrl ?? null, work_description: i.workDescription ?? null,
    status: i.status ?? 'planned', start_time: i.startTime ?? null,
    priority: i.priority ?? 0, notes: i.notes ?? null, visit_id: i.visitId ?? null,
    updated_at: ts,
  };
}

// ---------------------------------------------------------------------------
// Requirement checklists
// ---------------------------------------------------------------------------
function mapTemplateItem(r: any): RequirementItem {
  return {
    id: r.id, templateId: r.template_id, label: r.label, hint: r.hint ?? undefined,
    required: toBool(r.required), cost: r.cost ?? undefined, sort: r.sort,
  };
}

function mapTemplate(r: any, items: RequirementItem[]): RequirementTemplate {
  return {
    id: r.id, nameAr: r.name_ar, nameEn: r.name_en ?? undefined,
    description: r.description ?? undefined,
    estimatedCost: r.estimated_cost ?? undefined, currency: r.currency,
    active: toBool(r.active), sort: r.sort, items,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export const requirementTemplatesRepo = {
  list(includeInactive = false): RequirementTemplate[] {
    const db = getDb();
    const rows = db.prepare(
      `SELECT * FROM requirement_templates ${includeInactive ? '' : 'WHERE active = 1'}
       ORDER BY sort, name_ar`,
    ).all() as any[];
    const items = db.prepare('SELECT * FROM requirement_items ORDER BY sort').all() as any[];
    return rows.map((r) => mapTemplate(r, items.filter((i) => i.template_id === r.id).map(mapTemplateItem)));
  },

  get(id: string): RequirementTemplate | null {
    const db = getDb();
    const r = db.prepare('SELECT * FROM requirement_templates WHERE id = ?').get(id) as any;
    if (!r) return null;
    const items = db.prepare('SELECT * FROM requirement_items WHERE template_id = ? ORDER BY sort')
      .all(id) as any[];
    return mapTemplate(r, items.map(mapTemplateItem));
  },

  save(input: Partial<RequirementTemplate>): RequirementTemplate {
    const db = getDb();
    const id = input.id ?? uuid();
    const ts = now();
    const exists = input.id && db.prepare('SELECT 1 FROM requirement_templates WHERE id = ?').get(input.id);

    const tx = db.transaction(() => {
      const row = {
        id, name_ar: input.nameAr ?? '', name_en: input.nameEn ?? null,
        description: input.description ?? null,
        estimated_cost: input.estimatedCost ?? null,
        currency: input.currency ?? 'AED',
        active: fromBool(input.active ?? true), sort: input.sort ?? 0, updated_at: ts,
      };
      if (exists) {
        db.prepare(`UPDATE requirement_templates SET name_ar=@name_ar, name_en=@name_en,
          description=@description, estimated_cost=@estimated_cost, currency=@currency,
          active=@active, sort=@sort, updated_at=@updated_at WHERE id=@id`).run(row);
      } else {
        db.prepare(`INSERT INTO requirement_templates (id, name_ar, name_en, description,
          estimated_cost, currency, active, sort, created_at, updated_at)
          VALUES (@id,@name_ar,@name_en,@description,@estimated_cost,@currency,@active,@sort,@created_at,@updated_at)`)
          .run({ ...row, created_at: ts });
      }

      if (input.items) {
        db.prepare('DELETE FROM requirement_items WHERE template_id = ?').run(id);
        const ins = db.prepare(`INSERT INTO requirement_items (id, template_id, label, hint, required, cost, sort)
          VALUES (?,?,?,?,?,?,?)`);
        input.items.forEach((it, idx) => {
          if (!it.label?.trim()) return;
          ins.run(it.id ?? uuid(), id, it.label.trim(), it.hint ?? null,
            fromBool(it.required ?? true), it.cost ?? null, it.sort ?? idx);
        });
      }
    });
    tx();
    return this.get(id)!;
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM requirement_templates WHERE id = ?').run(id);
  },
};

function mapCaseItem(r: any): RequirementCaseItem {
  return {
    id: r.id, caseId: r.case_id, label: r.label, hint: r.hint ?? undefined,
    required: toBool(r.required), cost: r.cost ?? undefined,
    collected: toBool(r.collected), documentId: r.document_id ?? undefined, sort: r.sort,
  };
}

function mapCase(r: any, items: RequirementCaseItem[]): RequirementCase {
  return {
    id: r.id, clientId: r.client_id, templateId: r.template_id ?? undefined,
    title: r.title, status: r.status, dueDate: r.due_date ?? undefined,
    totalCost: r.total_cost ?? undefined, notes: r.notes ?? undefined, items,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export const requirementCasesRepo = {
  listByClient(clientId: string): RequirementCase[] {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM requirement_cases WHERE client_id = ? ORDER BY created_at DESC',
    ).all(clientId) as any[];
    if (!rows.length) return [];
    const marks = rows.map(() => '?').join(',');
    const items = db.prepare(
      `SELECT * FROM requirement_case_items WHERE case_id IN (${marks}) ORDER BY sort`,
    ).all(...rows.map((r) => r.id)) as any[];
    return rows.map((r) => mapCase(r, items.filter((i) => i.case_id === r.id).map(mapCaseItem)));
  },

  get(id: string): RequirementCase | null {
    const db = getDb();
    const r = db.prepare('SELECT * FROM requirement_cases WHERE id = ?').get(id) as any;
    if (!r) return null;
    const items = db.prepare('SELECT * FROM requirement_case_items WHERE case_id = ? ORDER BY sort')
      .all(id) as any[];
    return mapCase(r, items.map(mapCaseItem));
  },

  /**
   * Start a case for a client, copying the template's items.
   *
   * The items are COPIED rather than referenced so that editing a template
   * later never rewrites the history of a case already in progress.
   */
  createFromTemplate(clientId: string, templateId: string, title?: string): RequirementCase {
    const tpl = requirementTemplatesRepo.get(templateId);
    if (!tpl) throw new Error('NOT_FOUND');
    return this.save({
      clientId,
      templateId,
      title: title ?? tpl.nameAr,
      totalCost: tpl.estimatedCost,
      items: tpl.items.map((i) => ({
        id: uuid(), caseId: '', label: i.label, hint: i.hint,
        required: i.required, cost: i.cost, collected: false, sort: i.sort,
      })),
    });
  },

  save(input: Partial<RequirementCase> & { clientId: string }): RequirementCase {
    const db = getDb();
    const id = input.id ?? uuid();
    const ts = now();
    const exists = input.id && db.prepare('SELECT 1 FROM requirement_cases WHERE id = ?').get(input.id);

    // Merge onto what is stored: closing a case must not erase its due date.
    const current = exists ? this.get(id) : null;
    const m = { ...(current ?? {}), ...input } as Partial<RequirementCase> & { clientId: string };

    const tx = db.transaction(() => {
      const row = {
        id, client_id: m.clientId, template_id: m.templateId ?? null,
        title: m.title ?? '', status: m.status ?? 'open',
        due_date: m.dueDate ?? null, total_cost: m.totalCost ?? null,
        notes: m.notes ?? null, updated_at: ts,
      };
      if (exists) {
        db.prepare(`UPDATE requirement_cases SET template_id=@template_id, title=@title,
          status=@status, due_date=@due_date, total_cost=@total_cost, notes=@notes,
          updated_at=@updated_at WHERE id=@id`).run(row);
      } else {
        db.prepare(`INSERT INTO requirement_cases (id, client_id, template_id, title, status,
          due_date, total_cost, notes, created_at, updated_at)
          VALUES (@id,@client_id,@template_id,@title,@status,@due_date,@total_cost,@notes,@created_at,@updated_at)`)
          .run({ ...row, created_at: ts });
      }

      if (input.items) {
        db.prepare('DELETE FROM requirement_case_items WHERE case_id = ?').run(id);
        const ins = db.prepare(`INSERT INTO requirement_case_items
          (id, case_id, label, hint, required, cost, collected, document_id, sort)
          VALUES (?,?,?,?,?,?,?,?,?)`);
        input.items.forEach((it, idx) => {
          if (!it.label?.trim()) return;
          ins.run(it.id ?? uuid(), id, it.label.trim(), it.hint ?? null,
            fromBool(it.required ?? true), it.cost ?? null,
            fromBool(it.collected), it.documentId ?? null, it.sort ?? idx);
        });
      }
    });
    tx();
    return this.get(id)!;
  },

  /** Tick or untick one requirement without rewriting the whole case. */
  setItemCollected(itemId: string, collected: boolean, documentId?: string): void {
    getDb().prepare(
      'UPDATE requirement_case_items SET collected = ?, document_id = ? WHERE id = ?',
    ).run(fromBool(collected), documentId ?? null, itemId);
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM requirement_cases WHERE id = ?').run(id);
  },
};

// ---------------------------------------------------------------------------
// Quotations
// ---------------------------------------------------------------------------
function mapQuotation(r: any): Quotation {
  return {
    id: r.id, clientId: r.client_id, branchId: r.branch_id ?? undefined,
    number: r.number, date: r.date, validUntil: r.valid_until ?? undefined,
    status: r.status, items: parseJson<QuotationItem[]>(r.items, []),
    subtotal: r.subtotal, taxRate: r.tax_rate, taxAmount: r.tax_amount,
    discount: r.discount, total: r.total, trn: r.trn ?? undefined,
    terms: r.terms ?? undefined, notes: r.notes ?? undefined,
    invoiceId: r.invoice_id ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** Money is always recomputed from the lines so a printed quote adds up. */
function computeQuoteTotals(items: QuotationItem[], taxRate: number, discount: number) {
  const subtotal = items.reduce(
    (s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0,
  );
  const afterDiscount = Math.max(0, subtotal - (Number(discount) || 0));
  const taxAmount = Math.round(afterDiscount * ((Number(taxRate) || 0) / 100) * 100) / 100;
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    taxAmount,
    total: Math.round((afterDiscount + taxAmount) * 100) / 100,
  };
}

export const quotationsRepo = {
  listByClient(clientId: string): Quotation[] {
    return (getDb().prepare(
      'SELECT * FROM quotations WHERE client_id = ? ORDER BY date DESC, created_at DESC',
    ).all(clientId) as any[]).map(mapQuotation);
  },

  recent(limit = 100): Quotation[] {
    return (getDb().prepare(
      'SELECT * FROM quotations ORDER BY date DESC, created_at DESC LIMIT ?',
    ).all(limit) as any[]).map(mapQuotation);
  },

  get(id: string): Quotation | null {
    const r = getDb().prepare('SELECT * FROM quotations WHERE id = ?').get(id) as any;
    return r ? mapQuotation(r) : null;
  },

  /** Next number in the QT-0001 series. */
  nextNumber(): string {
    const r = getDb().prepare(
      `SELECT MAX(CAST(substr(number, 4) AS INTEGER)) AS m FROM quotations WHERE number LIKE 'QT-%'`,
    ).get() as { m: number | null };
    return `QT-${String((r.m ?? 0) + 1).padStart(4, '0')}`;
  },

  save(input: Partial<Quotation> & { clientId: string }): Quotation {
    const db = getDb();
    const id = input.id ?? uuid();
    const ts = now();
    const exists = input.id && db.prepare('SELECT 1 FROM quotations WHERE id = ?').get(input.id);

    // Merge onto the stored quotation: marking one as sent must not drop its
    // line items, and money is recomputed from whatever the merge produced.
    const current = exists ? this.get(id) : null;
    const m = { ...(current ?? {}), ...input } as Partial<Quotation> & { clientId: string };

    const items = m.items ?? [];
    const taxRate = m.taxRate ?? 0;
    const discount = m.discount ?? 0;
    const { subtotal, taxAmount, total } = computeQuoteTotals(items, taxRate, discount);

    const row = {
      id, client_id: m.clientId, branch_id: m.branchId ?? null,
      number: m.number || this.nextNumber(),
      date: m.date ?? ts.slice(0, 10), valid_until: m.validUntil ?? null,
      status: m.status ?? 'draft', items: JSON.stringify(items),
      subtotal, tax_rate: taxRate, tax_amount: taxAmount, discount, total,
      trn: m.trn ?? null, terms: m.terms ?? null, notes: m.notes ?? null,
      invoice_id: m.invoiceId ?? null, updated_at: ts,
    };

    if (exists) {
      db.prepare(`UPDATE quotations SET branch_id=@branch_id, number=@number, date=@date,
        valid_until=@valid_until, status=@status, items=@items, subtotal=@subtotal,
        tax_rate=@tax_rate, tax_amount=@tax_amount, discount=@discount, total=@total,
        trn=@trn, terms=@terms, notes=@notes, invoice_id=@invoice_id, updated_at=@updated_at
        WHERE id=@id`).run(row);
    } else {
      db.prepare(`INSERT INTO quotations (id, client_id, branch_id, number, date, valid_until,
        status, items, subtotal, tax_rate, tax_amount, discount, total, trn, terms, notes,
        invoice_id, created_at, updated_at)
        VALUES (@id,@client_id,@branch_id,@number,@date,@valid_until,@status,@items,@subtotal,
        @tax_rate,@tax_amount,@discount,@total,@trn,@terms,@notes,@invoice_id,@created_at,@updated_at)`)
        .run({ ...row, created_at: ts });
    }
    return this.get(id)!;
  },

  setStatus(id: string, status: string): void {
    getDb().prepare('UPDATE quotations SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now(), id);
  },

  linkInvoice(id: string, invoiceId: string): void {
    getDb().prepare(
      "UPDATE quotations SET invoice_id = ?, status = 'accepted', updated_at = ? WHERE id = ?",
    ).run(invoiceId, now(), id);
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM quotations WHERE id = ?').run(id);
  },
};
