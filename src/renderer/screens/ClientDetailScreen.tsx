// ============================================================================
// AlAqsa — Client detail: overview + tabs for branches, devices, visits,
// documents, camera licenses, finance and notes.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import {
  Loading, EmptyState, Badge, Stars, Tabs, ConfirmDialog, useToast, fmtDate, daysUntil,
} from '../components/ui';
import { ClientFormModal } from '../components/ClientFormModal';
import { BranchFormModal } from '../components/BranchFormModal';
import { DeviceFormModal } from '../components/DeviceFormModal';
import { VisitFormModal } from '../components/VisitFormModal';
import { DocumentsPanel } from '../components/DocumentsPanel';
import { LicensesPanel } from '../components/LicensesPanel';
import { FinancePanel } from '../components/FinancePanel';
import { NotesPanel } from '../components/NotesPanel';
import { DeviceQrModal } from '../components/DeviceQrModal';
import { ShareReportModal } from '../components/ShareReportModal';
import type { Route } from '../Shell';
import type { Client, Branch, Device, Visit, Contact, StatusLabel } from '@shared/types';
import { CLIENT_TYPES, DEVICE_TYPES, VISIT_TYPES } from '@shared/constants';

export function ClientDetailScreen({
  clientId, initialTab, navigate,
}: {
  clientId: string;
  initialTab?: string;
  navigate: (r: Route) => void;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();

  const [client, setClient] = useState<Client | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [labels, setLabels] = useState<StatusLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(initialTab ?? 'overview');

  const [editClient, setEditClient] = useState(false);
  const [branchForm, setBranchForm] = useState<{ open: boolean; branch: Branch | null }>({ open: false, branch: null });
  const [deviceForm, setDeviceForm] = useState<{ open: boolean; device: Device | null; branchId: string }>(
    { open: false, device: null, branchId: '' },
  );
  const [visitForm, setVisitForm] = useState<{ open: boolean; visit: Visit | null }>({ open: false, visit: null });
  const [qrDevice, setQrDevice] = useState<Device | null>(null);
  const [shareTarget, setShareTarget] = useState<{ path: string } | null>(null);
  const [deleting, setDeleting] = useState<{ kind: 'branch' | 'device' | 'visit'; id: string } | null>(null);
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null);

  /** Refresh data in place. The active tab is React state and is intentionally
   *  left untouched, so saving or deleting never bounces the user back to
   *  "Overview" mid-task. */
  const load = useCallback(async () => {
    const [c, ct, b, d, v, l] = await Promise.all([
      window.alaqsa.clients.get(clientId),
      window.alaqsa.clients.contacts(clientId),
      window.alaqsa.branches.listByClient(clientId),
      window.alaqsa.devices.listByClient(clientId),
      window.alaqsa.visits.listByClient(clientId),
      window.alaqsa.statusLabels.list(),
    ]);
    if (c.ok) setClient(c.data);
    if (ct.ok) setContacts(ct.data);
    if (b.ok) setBranches(b.data);
    if (d.ok) setDevices(d.data);
    if (v.ok) setVisits(v.data);
    if (l.ok) setLabels(l.data);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Loading />;
  if (!client) return <EmptyState icon="❓" title={t.common.noResults} />;

  const label = labels.find((l) => l.id === client.statusLabelId);
  const typeLabel = CLIENT_TYPES.find((x) => x.value === client.type);
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];
  const cameras = devices.filter((d) => d.type === 'camera');

  const branchName = (id: string) => branches.find((b) => b.id === id)?.nameAr ?? '—';
  const devicesOf = (branchId: string) => devices.filter((d) => d.branchId === branchId);

  const confirmDelete = async () => {
    if (!deleting) return;
    const api = deleting.kind === 'branch' ? window.alaqsa.branches
      : deleting.kind === 'device' ? window.alaqsa.devices : window.alaqsa.visits;
    const res = await api.remove(deleting.id);
    setDeleting(null);
    if (res.ok) { toast.success(t.msg.deleted); void load(); }
    else toast.error(res.error);
  };

  const generateVisitReport = async (visitId: string) => {
    const res = await window.alaqsa.reports.visitPdf(visitId);
    if (!res.ok) return toast.error(res.error);
    toast.success(t.reports.generated);
    setShareTarget({ path: res.data.path });
  };

  const generateAgreement = async () => {
    const res = await window.alaqsa.reports.agreementPdf(clientId);
    if (!res.ok) return toast.error(res.error);
    toast.success(t.reports.generated);
    setShareTarget({ path: res.data.path });
  };

  const exportExcel = async () => {
    const res = await window.alaqsa.reports.exportClientExcel(clientId);
    if (!res.ok) return toast.error(res.error);
    toast.success(`${t.reports.generated}: ${res.data.path}`);
  };

  const tabs = [
    { id: 'overview', label: t.clients.tabs.overview },
    { id: 'branches', label: t.clients.tabs.branches, badge: branches.length },
    { id: 'devices', label: t.clients.tabs.devices, badge: devices.length },
    { id: 'visits', label: t.clients.tabs.visits, badge: visits.length },
    { id: 'documents', label: t.clients.tabs.documents },
    { id: 'licenses', label: t.clients.tabs.licenses },
    { id: 'finance', label: t.clients.tabs.finance },
    { id: 'notes', label: t.notesLog.title },
  ];

  const deviceTypeLabel = (v: string) => {
    const d = DEVICE_TYPES.find((x) => x.value === v);
    return d ? (lang === 'ar' ? d.ar : d.en) : v;
  };

  const healthBadge = (h?: string) => {
    if (!h) return null;
    const map: Record<string, { kind: 'success' | 'warning' | 'danger' | 'info'; text: string }> = {
      excellent: { kind: 'success', text: t.devices.healthExcellent },
      good: { kind: 'info', text: t.devices.healthGood },
      warning: { kind: 'warning', text: t.devices.healthWarning },
      faulty: { kind: 'danger', text: t.devices.healthFaulty },
    };
    const m = map[h];
    return m ? <Badge kind={m.kind}>{m.text}</Badge> : null;
  };

  const warrantyBadge = (d: Device) => {
    const days = daysUntil(d.warrantyExpiry);
    if (days === null) return null;
    if (days < 0) return <Badge kind="danger">{t.licenses.expired}</Badge>;
    if (days <= 30) return <Badge kind="warning">{days} {t.common.days}</Badge>;
    return null;
  };

  return (
    <div className="col gap-16 fade-in">
      {/* Header */}
      <div className="row gap-8">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate({ name: 'clients' })}>
          {lang === 'ar' ? '→' : '←'} {t.common.back}
        </button>
      </div>

      <div className="card" style={{ position: 'relative' }}>
        <div className="status-strip" style={{ background: label?.color ?? 'var(--border)' }} />
        <div className="card-body col gap-12" style={{ paddingInlineStart: 22 }}>
          <div className="row between wrap gap-12">
            <div className="col gap-4" style={{ minWidth: 0 }}>
              <div className="row gap-8 wrap">
                <span className="mono tiny faint">{client.code}</span>
                {typeLabel && <Badge kind="neutral">{lang === 'ar' ? typeLabel.ar : typeLabel.en}</Badge>}
                {label && (
                  <span className="badge" style={{ background: label.color + '22', color: label.color }}>
                    <span className="dot" style={{ background: label.color }} />
                    {lang === 'ar' ? label.name_ar : label.name_en}
                  </span>
                )}
              </div>
              <h1 style={{ fontSize: 21 }}>{lang === 'ar' ? client.nameAr : (client.nameEn || client.nameAr)}</h1>
              <div className="row gap-12 wrap small muted">
                <Stars value={client.rating} size={14} />
                <span>🔄 {t.clients.dealCount}: {client.dealCount}</span>
                <span>🏢 {branches.length}</span>
                <span>📷 {cameras.length}</span>
              </div>
            </div>

            <div className="row gap-6 wrap">
              <button className="btn btn-outline btn-sm" onClick={generateAgreement}>📄 {t.reports.agreementReport}</button>
              <button className="btn btn-outline btn-sm" onClick={exportExcel}>📊 {t.common.export}</button>
              <button className="btn btn-primary btn-sm" onClick={() => setEditClient(true)}>✏️ {t.common.edit}</button>
            </div>
          </div>

          {client.isFlagged && (
            <div style={{
              padding: '11px 14px', borderRadius: 'var(--radius)',
              background: 'var(--danger-bg)', color: '#b91c1c',
              fontSize: 13, fontWeight: 600, lineHeight: 1.6,
            }}>
              🔴 <strong>{t.clients.flagged}:</strong> {client.flagReason}
            </div>
          )}
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {/* ---- Overview ---- */}
      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <div className="card">
            <div className="card-head"><span className="card-title">📞 {t.clients.contacts}</span></div>
            <div className="card-body col gap-12">
              {contacts.length === 0 ? (
                <span className="small muted">{t.common.noData}</span>
              ) : contacts.map((c) => (
                <div key={c.id} className="col gap-3" style={{
                  paddingBottom: 10, borderBottom: '1px solid var(--border)',
                }}>
                  <div className="row gap-8">
                    <span className="bold">{c.name}</span>
                    {c.isPrimary && <Badge kind="info">{t.clients.primaryContact}</Badge>}
                  </div>
                  {c.role && <span className="tiny muted">{c.role}</span>}
                  {c.phones.map((p) => (
                    <a key={p} href={`tel:${p}`} className="small mono" dir="ltr">📱 {p}</a>
                  ))}
                  {c.emails.map((m) => (
                    <a key={m} href={`mailto:${m}`} className="small mono" dir="ltr">✉️ {m}</a>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><span className="card-title">📊 {t.common.details}</span></div>
            <div className="card-body col gap-8 small">
              <div className="row between"><span className="muted">{t.branches.title}</span><span className="bold">{branches.length}</span></div>
              <div className="row between"><span className="muted">{t.dashboard.cameras}</span><span className="bold">{cameras.length}</span></div>
              <div className="row between"><span className="muted">{t.devices.title}</span><span className="bold">{devices.length}</span></div>
              <div className="row between"><span className="muted">{t.visits.title}</span><span className="bold">{visits.length}</span></div>
              {visits[0] && (
                <div className="row between">
                  <span className="muted">{t.visits.visitDate}</span>
                  <span className="bold">{fmtDate(visits[0].visitDate)}</span>
                </div>
              )}
              {visits[0]?.nextVisitDate && (
                <div className="row between">
                  <span className="muted">{t.visits.nextVisitDate}</span>
                  <span className="bold">{fmtDate(visits[0].nextVisitDate)}</span>
                </div>
              )}
            </div>
          </div>

          {client.notes && (
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <div className="card-head"><span className="card-title">📝 {t.common.notes}</span></div>
              <div className="card-body" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{client.notes}</div>
            </div>
          )}
        </div>
      )}

      {/* ---- Branches ---- */}
      {tab === 'branches' && (
        <div className="col gap-12">
          <div className="row between">
            <span className="muted small">{branches.length} {t.branches.title}</span>
            <button className="btn btn-primary btn-sm"
              onClick={() => setBranchForm({ open: true, branch: null })}>
              + {t.branches.newBranch}
            </button>
          </div>

          {branches.length === 0 ? (
            <EmptyState icon="🏢" title={t.branches.noBranches}
              action={<button className="btn btn-primary"
                onClick={() => setBranchForm({ open: true, branch: null })}>+ {t.branches.newBranch}</button>} />
          ) : (
            <div className="col gap-10">
              {branches.map((b) => {
                const bd = devicesOf(b.id);
                const bLabel = labels.find((l) => l.id === b.statusLabelId);
                const isOpen = expandedBranch === b.id;
                return (
                  <div key={b.id} className="card" style={{ position: 'relative' }}>
                    <div className="status-strip" style={{ background: bLabel?.color ?? 'var(--border)' }} />
                    <div className="card-body col gap-10" style={{ paddingInlineStart: 20 }}>
                      <div className="row between wrap gap-10">
                        <div className="col gap-3" style={{ minWidth: 0 }}>
                          <div className="row gap-8 wrap">
                            <span className="bold" style={{ fontSize: 15 }}>{b.nameAr}</span>
                            {bLabel && (
                              <span className="badge" style={{ background: bLabel.color + '22', color: bLabel.color }}>
                                {lang === 'ar' ? bLabel.name_ar : bLabel.name_en}
                              </span>
                            )}
                          </div>
                          {b.location.address && <span className="small muted">📍 {b.location.address}</span>}
                          {b.managerContact && <span className="tiny muted mono" dir="ltr">📱 {b.managerContact}</span>}
                        </div>
                        <div className="row gap-6 wrap">
                          <Badge kind="info">📟 {bd.length}</Badge>
                          <Badge kind="neutral">📷 {bd.filter((d) => d.type === 'camera').length}</Badge>
                          {b.location.lat != null && b.location.lng != null && (
                            <button className="btn btn-ghost btn-icon btn-sm" title={t.common.location}
                              onClick={() => window.open(`https://www.google.com/maps?q=${b.location.lat},${b.location.lng}`, '_blank')}>
                              🗺
                            </button>
                          )}
                          <button className="btn btn-ghost btn-icon btn-sm" title={t.common.edit}
                            onClick={() => setBranchForm({ open: true, branch: b })}>✏️</button>
                          <button className="btn btn-ghost btn-icon btn-sm" title={t.common.delete}
                            onClick={() => setDeleting({ kind: 'branch', id: b.id })}>🗑</button>
                          <button className="btn btn-outline btn-sm"
                            onClick={() => setExpandedBranch(isOpen ? null : b.id)}>
                            {isOpen ? '▲' : '▼'} {t.devices.title}
                          </button>
                        </div>
                      </div>

                      {isOpen && (
                        <div className="col gap-8" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                          <div className="row between">
                            <span className="tiny muted">{bd.length} {t.devices.title}</span>
                            <button className="btn btn-outline btn-sm"
                              onClick={() => setDeviceForm({ open: true, device: null, branchId: b.id })}>
                              + {t.devices.newDevice}
                            </button>
                          </div>
                          {bd.length === 0 ? (
                            <span className="small muted text-center" style={{ padding: 12 }}>{t.devices.noDevices}</span>
                          ) : (
                            <div className="table-wrap">
                              <table className="table">
                                <thead>
                                  <tr>
                                    <th>{t.common.type}</th>
                                    <th>{t.devices.label}</th>
                                    <th>{t.devices.model}</th>
                                    <th>{t.devices.serialNumber}</th>
                                    <th>{t.devices.health}</th>
                                    <th>{t.devices.warrantyExpiry}</th>
                                    <th style={{ width: 100 }} />
                                  </tr>
                                </thead>
                                <tbody>
                                  {bd.map((d) => (
                                    <tr key={d.id}>
                                      <td className="small">{deviceTypeLabel(d.type)}</td>
                                      <td className="small bold">{d.label ?? '—'}</td>
                                      <td className="small">{d.model ?? '—'}</td>
                                      <td className="mono tiny" dir="ltr">{d.serialNumber ?? '—'}</td>
                                      <td>{healthBadge(d.health)}</td>
                                      <td className="small">
                                        <div className="row gap-6">
                                          {fmtDate(d.warrantyExpiry)}
                                          {warrantyBadge(d)}
                                        </div>
                                      </td>
                                      <td>
                                        <div className="cell-actions">
                                          <button className="btn btn-ghost btn-icon btn-sm" title={t.devices.qrLabel}
                                            onClick={() => setQrDevice(d)}>🏷</button>
                                          <button className="btn btn-ghost btn-icon btn-sm" title={t.common.edit}
                                            onClick={() => setDeviceForm({ open: true, device: d, branchId: b.id })}>✏️</button>
                                          <button className="btn btn-ghost btn-icon btn-sm" title={t.common.delete}
                                            onClick={() => setDeleting({ kind: 'device', id: d.id })}>🗑</button>
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ---- Devices (flat, all branches) ---- */}
      {tab === 'devices' && (
        <div className="col gap-12">
          <div className="row between">
            <span className="muted small">{devices.length} {t.devices.title}</span>
            {branches.length > 0 && (
              <button className="btn btn-primary btn-sm"
                onClick={() => setDeviceForm({ open: true, device: null, branchId: branches[0].id })}>
                + {t.devices.newDevice}
              </button>
            )}
          </div>
          {devices.length === 0 ? (
            <EmptyState icon="📟" title={t.devices.noDevices}
              message={branches.length === 0 ? t.branches.noBranches : undefined} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.branches.title}</th>
                    <th>{t.common.type}</th>
                    <th>{t.devices.label}</th>
                    <th>{t.devices.positionInBranch}</th>
                    <th>{t.devices.model}</th>
                    <th>{t.devices.serialNumber}</th>
                    <th>{t.devices.source}</th>
                    <th>{t.devices.health}</th>
                    <th style={{ width: 100 }} />
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => (
                    <tr key={d.id}>
                      <td className="small">{branchName(d.branchId)}</td>
                      <td className="small">{deviceTypeLabel(d.type)}</td>
                      <td className="small bold">{d.label ?? '—'}</td>
                      <td className="small">{d.positionInBranch ?? '—'}</td>
                      <td className="small">{d.model ?? '—'}</td>
                      <td className="mono tiny" dir="ltr">{d.serialNumber ?? '—'}</td>
                      <td>
                        <Badge kind={d.source === 'ours' ? 'success' : d.source === 'mixed' ? 'info' : 'neutral'}>
                          {d.source === 'ours' ? t.devices.sourceOurs
                            : d.source === 'mixed' ? t.devices.sourceMixed
                            : t.devices.sourceExisting}
                        </Badge>
                      </td>
                      <td>{healthBadge(d.health)}</td>
                      <td>
                        <div className="cell-actions">
                          <button className="btn btn-ghost btn-icon btn-sm" title={t.devices.qrLabel}
                            onClick={() => setQrDevice(d)}>🏷</button>
                          <button className="btn btn-ghost btn-icon btn-sm" title={t.common.edit}
                            onClick={() => setDeviceForm({ open: true, device: d, branchId: d.branchId })}>✏️</button>
                          <button className="btn btn-ghost btn-icon btn-sm" title={t.common.delete}
                            onClick={() => setDeleting({ kind: 'device', id: d.id })}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ---- Visits ---- */}
      {tab === 'visits' && (
        <div className="col gap-12">
          <div className="row between">
            <span className="muted small">{visits.length} {t.visits.title}</span>
            {branches.length > 0 && (
              <button className="btn btn-primary btn-sm" onClick={() => setVisitForm({ open: true, visit: null })}>
                + {t.visits.newVisit}
              </button>
            )}
          </div>
          {visits.length === 0 ? (
            <EmptyState icon="🛠" title={t.visits.noVisits}
              message={branches.length === 0 ? t.branches.noBranches : undefined} />
          ) : (
            <div className="col gap-10">
              {visits.map((v) => {
                const vt = VISIT_TYPES.find((x) => x.value === v.type);
                const done = Object.values(v.checklist).filter(Boolean).length;
                return (
                  <div key={v.id} className="card">
                    <div className="card-body col gap-8">
                      <div className="row between wrap gap-10">
                        <div className="col gap-3">
                          <div className="row gap-8 wrap">
                            <span className="bold">{fmtDate(v.visitDate)}</span>
                            <Badge kind="info">{vt ? (lang === 'ar' ? vt.ar : vt.en) : v.type}</Badge>
                            {v.technician && <span className="small muted">👷 {v.technician}</span>}
                          </div>
                          <span className="small muted">🏢 {branchName(v.branchId)}</span>
                        </div>
                        <div className="row gap-6 wrap">
                          <Badge kind={done === 9 ? 'success' : 'warning'}>✓ {done}/9</Badge>
                          {v.replacedParts.length > 0 && <Badge kind="warning">🔧 {v.replacedParts.length}</Badge>}
                          {v.nextVisitDate && <Badge kind="neutral">📅 {fmtDate(v.nextVisitDate)}</Badge>}
                          <button className="btn btn-outline btn-sm" onClick={() => generateVisitReport(v.id)}>
                            📄 {t.reports.visitReport}
                          </button>
                          <button className="btn btn-ghost btn-icon btn-sm" title={t.common.edit}
                            onClick={() => setVisitForm({ open: true, visit: v })}>✏️</button>
                          <button className="btn btn-ghost btn-icon btn-sm" title={t.common.delete}
                            onClick={() => setDeleting({ kind: 'visit', id: v.id })}>🗑</button>
                        </div>
                      </div>
                      {(v.faultsFound || v.actionsTaken) && (
                        <div className="col gap-4 small" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                          {v.faultsFound && <div><span className="muted">{t.visits.faultsFound}: </span>{v.faultsFound}</div>}
                          {v.actionsTaken && <div><span className="muted">{t.visits.actionsTaken}: </span>{v.actionsTaken}</div>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'documents' && <DocumentsPanel clientId={clientId} branches={branches} onChanged={load} />}
      {tab === 'licenses' && <LicensesPanel clientId={clientId} branches={branches} onChanged={load} />}
      {tab === 'finance' && <FinancePanel clientId={clientId} />}
      {tab === 'notes' && (
        <NotesPanel clientId={clientId} clientName={client.nameAr} branches={branches} />
      )}

      {/* ---- Modals ---- */}
      <ClientFormModal
        open={editClient}
        client={client}
        labels={labels}
        onClose={() => setEditClient(false)}
        onSaved={() => { setEditClient(false); void load(); }}
      />

      <BranchFormModal
        open={branchForm.open}
        clientId={clientId}
        branch={branchForm.branch}
        labels={labels}
        onClose={() => setBranchForm({ open: false, branch: null })}
        onSaved={() => { setBranchForm({ open: false, branch: null }); void load(); }}
      />

      <DeviceFormModal
        open={deviceForm.open}
        device={deviceForm.device}
        branchId={deviceForm.branchId}
        branches={branches}
        onClose={() => setDeviceForm({ open: false, device: null, branchId: '' })}
        onSaved={() => { setDeviceForm({ open: false, device: null, branchId: '' }); void load(); }}
      />

      <VisitFormModal
        open={visitForm.open}
        clientId={clientId}
        visit={visitForm.visit}
        branches={branches}
        devices={devices}
        onClose={() => setVisitForm({ open: false, visit: null })}
        onSaved={() => { setVisitForm({ open: false, visit: null }); void load(); }}
      />

      <DeviceQrModal device={qrDevice} onClose={() => setQrDevice(null)} />

      <ShareReportModal
        open={!!shareTarget}
        pdfPath={shareTarget?.path ?? ''}
        contacts={contacts}
        clientName={client.nameAr}
        onClose={() => setShareTarget(null)}
      />

      <ConfirmDialog
        open={!!deleting}
        title={t.msg.confirmDelete}
        message={
          deleting?.kind === 'branch' ? t.branches.deleteConfirm
          : deleting?.kind === 'device' ? t.devices.deleteConfirm
          : t.visits.deleteConfirm
        }
        danger
        confirmLabel={t.common.delete}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
