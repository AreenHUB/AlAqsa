// ============================================================================
// AlAqsa — Clients list: table / cards views, search, filters, create & edit.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import {
  Loading, EmptyState, Badge, Stars, ConfirmDialog, useToast, useErrorMessage, Select, fmtDate,
} from '../components/ui';
import { ClientFormModal } from '../components/ClientFormModal';
import type { Route } from '../Shell';
import type { Client, StatusLabel } from '@shared/types';
import { CLIENT_TYPES } from '@shared/constants';

type ViewMode = 'table' | 'cards';

export function ClientsScreen({ navigate }: { navigate: (r: Route) => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [rows, setRows] = useState<Client[]>([]);
  const [labels, setLabels] = useState<StatusLabel[]>([]);
  const [branchCounts, setBranchCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [labelFilter, setLabelFilter] = useState('');
  const [view, setView] = useState<ViewMode>(
    () => (localStorage.getItem('alaqsa.clientsView') as ViewMode) ?? 'table',
  );
  const [sortBy, setSortBy] = useState('updated_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);

  useEffect(() => { localStorage.setItem('alaqsa.clientsView', view); }, [view]);

  const load = useCallback(async () => {
    setLoading(true);
    const [res, lbl] = await Promise.all([
      window.alaqsa.clients.list({
        search: search || undefined,
        type: typeFilter || undefined,
        statusLabelId: labelFilter || undefined,
        sortBy, sortDir, limit: 500,
      }),
      window.alaqsa.statusLabels.list(),
    ]);
    if (res.ok) {
      setRows(res.data.rows);
      // Branch counts for display.
      const counts: Record<string, number> = {};
      await Promise.all(res.data.rows.map(async (c) => {
        const b = await window.alaqsa.branches.listByClient(c.id);
        counts[c.id] = b.ok ? b.data.length : 0;
      }));
      setBranchCounts(counts);
    }
    if (lbl.ok) setLabels(lbl.data);
    setLoading(false);
  }, [search, typeFilter, labelFilter, sortBy, sortDir]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), 220);
    return () => window.clearTimeout(id);
  }, [load]);

  const labelById = useMemo(
    () => Object.fromEntries(labels.map((l) => [l.id, l])),
    [labels],
  );

  const typeLabel = (v: string) => {
    const item = CLIENT_TYPES.find((x) => x.value === v);
    return item ? (lang === 'ar' ? item.ar : item.en) : v;
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = await window.alaqsa.clients.remove(deleting.id);
    setDeleting(null);
    if (res.ok) { toast.success(t.msg.deleted); void load(); }
    else toast.error(errMsg(res.error));
  };

  const toggleSort = (col: string) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(col); setSortDir('asc'); }
  };

  const sortIcon = (col: string) => (sortBy === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const clearFilters = () => {
    setSearch(''); setTypeFilter(''); setLabelFilter('');
  };
  const hasFilters = !!(search || typeFilter || labelFilter);

  return (
    <div className="col gap-16 fade-in">
      <div className="row between wrap gap-12">
        <div>
          <h1 style={{ fontSize: 22 }}>{t.clients.title}</h1>
          <p className="muted small">
            {t.common.showing} {rows.length} {t.common.results}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
          + {t.clients.newClient}
        </button>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="card-body row gap-10 wrap" style={{ padding: 14 }}>
          <input
            className="input"
            style={{ flex: '2 1 240px' }}
            placeholder={`🔍 ${t.common.search}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div style={{ flex: '1 1 150px' }}>
            <Select
              value={typeFilter}
              onChange={setTypeFilter}
              placeholder={t.clients.clientType}
              options={CLIENT_TYPES.map((c) => ({ value: c.value, label: lang === 'ar' ? c.ar : c.en }))}
            />
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <Select
              value={labelFilter}
              onChange={setLabelFilter}
              placeholder={t.common.status}
              options={labels.map((l) => ({ value: l.id, label: lang === 'ar' ? l.name_ar : l.name_en }))}
            />
          </div>
          {/* The flagged-clients toggle was removed: a flag is a warning that
              belongs on the row itself (red highlight), not a filter people
              had to remember to switch off. Status remains filterable. */}
          {hasFilters && (
            <button className="btn btn-ghost" onClick={clearFilters}>✕ {t.common.clearFilters}</button>
          )}
          <div className="row gap-4" style={{ marginInlineStart: 'auto' }}>
            <button className={`btn btn-sm ${view === 'table' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setView('table')}>▤ {t.clients.viewMode.table}</button>
            <button className={`btn btn-sm ${view === 'cards' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setView('cards')}>▦ {t.clients.viewMode.cards}</button>
          </div>
        </div>
      </div>

      {loading ? <Loading /> : rows.length === 0 ? (
        <EmptyState
          icon="👥"
          title={hasFilters ? t.common.noResults : t.common.noData}
          message={hasFilters ? undefined : t.clients.newClientDesc}
          action={
            <button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
              + {t.clients.newClient}
            </button>
          }
        />
      ) : view === 'table' ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 6, padding: 0 }} />
                <th className="sortable" onClick={() => toggleSort('code')}>{t.clients.code}{sortIcon('code')}</th>
                <th className="sortable" onClick={() => toggleSort('name_ar')}>{t.common.name}{sortIcon('name_ar')}</th>
                <th>{t.common.type}</th>
                <th>{t.common.status}</th>
                <th className="sortable" onClick={() => toggleSort('rating')}>{t.clients.rating}{sortIcon('rating')}</th>
                <th>{t.branches.title}</th>
                <th className="sortable" onClick={() => toggleSort('deal_count')}>{t.clients.dealCount}{sortIcon('deal_count')}</th>
                <th style={{ width: 92 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const label = c.statusLabelId ? labelById[c.statusLabelId] : undefined;
                return (
                  <tr key={c.id} className={`clickable ${c.isFlagged ? 'flagged' : ''}`}
                    onClick={() => navigate({ name: 'client', id: c.id })}>
                    <td style={{ padding: 0, background: label?.color ?? 'transparent' }} />
                    <td className="mono tiny">{c.code}</td>
                    <td>
                      <div className="row gap-6">
                        {c.isFlagged && <span title={c.flagReason}>🔴</span>}
                        <span className="bold">{lang === 'ar' ? c.nameAr : (c.nameEn || c.nameAr)}</span>
                      </div>
                    </td>
                    <td className="small">{typeLabel(c.type)}</td>
                    <td>
                      {label && (
                        <span className="badge" style={{ background: label.color + '22', color: label.color }}>
                          <span className="dot" style={{ background: label.color }} />
                          {lang === 'ar' ? label.name_ar : label.name_en}
                        </span>
                      )}
                    </td>
                    <td><Stars value={c.rating} rated={c.rated} unratedLabel={t.clients.notRated} size={13} /></td>
                    <td className="small">{branchCounts[c.id] ?? 0}</td>
                    <td className="small">{c.dealCount}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="cell-actions">
                        <button className="btn btn-ghost btn-icon btn-sm" title={t.common.edit}
                          onClick={() => { setEditing(c); setFormOpen(true); }}>✏️</button>
                        <button className="btn btn-ghost btn-icon btn-sm" title={t.common.delete}
                          onClick={() => setDeleting(c)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(275px, 1fr))', gap: 14 }}>
          {rows.map((c) => {
            const label = c.statusLabelId ? labelById[c.statusLabelId] : undefined;
            return (
              <div key={c.id} className="card card-hover" style={{ position: 'relative' }}
                onClick={() => navigate({ name: 'client', id: c.id })}>
                <div className="status-strip" style={{ background: label?.color ?? 'var(--border)' }} />
                <div className="card-body col gap-8" style={{ paddingInlineStart: 20 }}>
                  <div className="row between gap-8">
                    <span className="mono tiny faint">{c.code}</span>
                    {c.isFlagged && <Badge kind="danger">🔴 {t.clients.flagged}</Badge>}
                  </div>
                  <div className="bold truncate" style={{ fontSize: 15 }}>
                    {lang === 'ar' ? c.nameAr : (c.nameEn || c.nameAr)}
                  </div>
                  <div className="row between">
                    <span className="small muted">{typeLabel(c.type)}</span>
                    <Stars value={c.rating} rated={c.rated} unratedLabel={t.clients.notRated} size={13} />
                  </div>
                  <div className="row gap-12 tiny muted">
                    <span>🏢 {branchCounts[c.id] ?? 0} {t.branches.title}</span>
                    <span>🔄 {c.dealCount}</span>
                  </div>
                  {label && (
                    <span className="badge" style={{ background: label.color + '22', color: label.color, alignSelf: 'flex-start' }}>
                      {lang === 'ar' ? label.name_ar : label.name_en}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ClientFormModal
        open={formOpen}
        client={editing}
        labels={labels}
        onClose={() => setFormOpen(false)}
        onSaved={(c) => {
          setFormOpen(false);
          void load();
          if (!editing) navigate({ name: 'client', id: c.id });
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        title={t.msg.confirmDelete}
        message={t.clients.deleteConfirm}
        danger
        confirmLabel={t.common.delete}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
