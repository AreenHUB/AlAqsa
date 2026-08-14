// ============================================================================
// AlAqsa — All visits across clients, newest first, with report generation.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import {
  Loading, EmptyState, Badge, Select, useToast, fmtDate,
} from '../components/ui';
import { ShareReportModal } from '../components/ShareReportModal';
import type { Route } from '../Shell';
import type { Client, Visit, Branch, Contact } from '@shared/types';
import { VISIT_TYPES } from '@shared/constants';

interface Row {
  visit: Visit;
  client: Client;
  branch?: Branch;
}

export function VisitsScreen({ navigate }: { navigate: (r: Route) => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [share, setShare] = useState<{ path: string; contacts: Contact[]; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const clientsRes = await window.alaqsa.clients.list({ limit: 500 });
    if (!clientsRes.ok) { setLoading(false); return; }

    const collected: Row[] = [];
    await Promise.all(clientsRes.data.rows.map(async (client) => {
      const [visits, branches] = await Promise.all([
        window.alaqsa.visits.listByClient(client.id),
        window.alaqsa.branches.listByClient(client.id),
      ]);
      if (!visits.ok) return;
      for (const visit of visits.data) {
        collected.push({
          visit, client,
          branch: branches.ok ? branches.data.find((b) => b.id === visit.branchId) : undefined,
        });
      }
    }));

    collected.sort((a, b) => b.visit.visitDate.localeCompare(a.visit.visitDate));
    setRows(collected);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (typeFilter && r.visit.type !== typeFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return r.client.nameAr.toLowerCase().includes(s)
        || (r.branch?.nameAr ?? '').toLowerCase().includes(s)
        || (r.visit.technician ?? '').toLowerCase().includes(s);
    }
    return true;
  }), [rows, typeFilter, search]);

  const generateReport = async (row: Row) => {
    const res = await window.alaqsa.reports.visitPdf(row.visit.id);
    if (!res.ok) return toast.error(res.error);
    const contacts = await window.alaqsa.clients.contacts(row.client.id);
    toast.success(t.reports.generated);
    setShare({
      path: res.data.path,
      contacts: contacts.ok ? contacts.data : [],
      name: row.client.nameAr,
    });
  };

  const typeLabel = (v: string) => {
    const item = VISIT_TYPES.find((x) => x.value === v);
    return item ? (lang === 'ar' ? item.ar : item.en) : v;
  };

  if (loading) return <Loading />;

  return (
    <div className="col gap-16 fade-in">
      <div>
        <h1 style={{ fontSize: 22 }}>{t.visits.title}</h1>
        <p className="muted small">{filtered.length} {t.common.results}</p>
      </div>

      <div className="card">
        <div className="card-body row gap-10 wrap" style={{ padding: 14 }}>
          <input
            className="input"
            style={{ flex: '2 1 240px' }}
            placeholder={`🔍 ${t.common.search}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div style={{ flex: '1 1 160px' }}>
            <Select
              value={typeFilter}
              onChange={setTypeFilter}
              placeholder={t.visits.visitType}
              options={VISIT_TYPES.map((v) => ({ value: v.value, label: lang === 'ar' ? v.ar : v.en }))}
            />
          </div>
          {(search || typeFilter) && (
            <button className="btn btn-ghost" onClick={() => { setSearch(''); setTypeFilter(''); }}>
              ✕ {t.common.clearFilters}
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="🛠" title={t.visits.noVisits}
          message={t.clients.existingClientDesc}
          action={<button className="btn btn-primary" onClick={() => navigate({ name: 'clients' })}>
            {t.nav.clients} →</button>} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.visits.visitDate}</th>
                <th>{t.nav.clients}</th>
                <th>{t.branches.title}</th>
                <th>{t.visits.visitType}</th>
                <th>{t.visits.technician}</th>
                <th>{t.visits.checklist}</th>
                <th>{t.visits.nextVisitDate}</th>
                <th style={{ width: 130 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ visit, client, branch }) => {
                const done = Object.values(visit.checklist).filter(Boolean).length;
                return (
                  <tr key={visit.id} className={client.isFlagged ? 'flagged' : ''}>
                    <td className="small bold">{fmtDate(visit.visitDate)}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" style={{ padding: 0, height: 'auto' }}
                        onClick={() => navigate({ name: 'client', id: client.id })}>
                        {client.isFlagged && '🔴 '}{client.nameAr}
                      </button>
                    </td>
                    <td className="small">{branch?.nameAr ?? '—'}</td>
                    <td><Badge kind="info">{typeLabel(visit.type)}</Badge></td>
                    <td className="small">{visit.technician ?? '—'}</td>
                    <td>
                      <Badge kind={done === 9 ? 'success' : done > 0 ? 'warning' : 'neutral'}>
                        {done}/9
                      </Badge>
                    </td>
                    <td className="small">{fmtDate(visit.nextVisitDate)}</td>
                    <td>
                      <div className="cell-actions">
                        <button className="btn btn-outline btn-sm" onClick={() => generateReport({ visit, client, branch })}>
                          📄 {t.common.export}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ShareReportModal
        open={!!share}
        pdfPath={share?.path ?? ''}
        contacts={share?.contacts ?? []}
        clientName={share?.name ?? ''}
        onClose={() => setShare(null)}
      />
    </div>
  );
}
