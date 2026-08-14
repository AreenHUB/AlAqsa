// ============================================================================
// AlAqsa — UAE camera licences per client/branch, with renewal tracking.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import {
  Modal, Field, TextInput, TextArea, Select, EmptyState, Badge,
  ConfirmDialog, useToast, Loading, fmtDate, daysUntil,
} from './ui';
import { isDateOrderValid } from '../utils/validation';
import type { CameraLicense, Branch } from '@shared/types';

export function LicensesPanel({
  clientId, branches, onChanged,
}: {
  clientId: string;
  branches: Branch[];
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();

  const [items, setItems] = useState<CameraLicense[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CameraLicense | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<CameraLicense | null>(null);

  const load = useCallback(async () => {
    const res = await window.alaqsa.licenses.listByClient(clientId);
    if (res.ok) setItems(res.data);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = await window.alaqsa.licenses.remove(deleting.id);
    setDeleting(null);
    if (res.ok) { toast.success(t.msg.deleted); void load(); onChanged(); }
    else toast.error(res.error);
  };

  const statusBadge = (l: CameraLicense) => {
    const days = daysUntil(l.expiryDate);
    if (days === null) return null;
    if (days < 0) return <Badge kind="danger">⚠ {t.licenses.expired}</Badge>;
    if (days <= 60) return <Badge kind="warning">⏳ {t.licenses.expiringSoon} ({days} {t.common.days})</Badge>;
    return <Badge kind="success">✓ {t.licenses.valid}</Badge>;
  };

  const branchName = (id?: string) =>
    id ? (branches.find((b) => b.id === id)?.nameAr ?? '—') : t.common.all;

  if (loading) return <Loading />;

  return (
    <div className="col gap-12">
      <div className="row between">
        <span className="muted small">{items.length} {t.licenses.title}</span>
        <button className="btn btn-primary btn-sm"
          onClick={() => { setEditing(null); setFormOpen(true); }}>
          + {t.licenses.newLicense}
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon="📋" title={t.licenses.noLicenses}
          action={<button className="btn btn-primary"
            onClick={() => { setEditing(null); setFormOpen(true); }}>+ {t.licenses.newLicense}</button>} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.licenses.licenseNumber}</th>
                <th>{t.branches.title}</th>
                <th>{t.licenses.issueDate}</th>
                <th>{t.licenses.renewalDate}</th>
                <th>{t.licenses.expiryDate}</th>
                <th>{t.common.status}</th>
                <th style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id}>
                  <td className="mono small" dir="ltr">{l.licenseNumber ?? '—'}</td>
                  <td className="small">{branchName(l.branchId)}</td>
                  <td className="small">{fmtDate(l.issueDate)}</td>
                  <td className="small">{fmtDate(l.renewalDate)}</td>
                  <td className="small bold">{fmtDate(l.expiryDate)}</td>
                  <td>{statusBadge(l)}</td>
                  <td>
                    <div className="cell-actions">
                      <button className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => { setEditing(l); setFormOpen(true); }}>✏️</button>
                      <button className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => setDeleting(l)}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <LicenseFormModal
        open={formOpen}
        clientId={clientId}
        license={editing}
        branches={branches}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); void load(); onChanged(); }}
      />

      <ConfirmDialog
        open={!!deleting}
        title={t.msg.confirmDelete}
        message={t.documents.deleteConfirm}
        danger
        confirmLabel={t.common.delete}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function LicenseFormModal({
  open, clientId, license, branches, onClose, onSaved,
}: {
  open: boolean;
  clientId: string;
  license: CameraLicense | null;
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();

  const [number, setNumber] = useState('');
  const [branchId, setBranchId] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [renewalDate, setRenewalDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNumber(license?.licenseNumber ?? '');
    setBranchId(license?.branchId ?? '');
    setIssueDate(license?.issueDate ?? '');
    setRenewalDate(license?.renewalDate ?? '');
    setExpiryDate(license?.expiryDate ?? '');
    setNotes(license?.notes ?? '');
    setErrors({});
  }, [open, license]);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!isDateOrderValid(issueDate, expiryDate)) e.expiryDate = t.validation.dateOrder;
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    const res = await window.alaqsa.licenses.save({
      id: license?.id,
      clientId,
      branchId: branchId || undefined,
      licenseNumber: number.trim() || undefined,
      issueDate: issueDate || undefined,
      renewalDate: renewalDate || undefined,
      expiryDate: expiryDate || undefined,
      notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(license ? t.msg.updated : t.msg.created);
    onSaved();
  };

  return (
    <Modal
      open={open}
      title={license ? t.common.edit : t.licenses.newLicense}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>{t.common.cancel}</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? <span className="spinner" /> : t.common.save}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t.licenses.licenseNumber}>
          <TextInput value={number} onChange={setNumber} dir="ltr" />
        </Field>
        <Field label={t.branches.title}>
          <Select
            value={branchId}
            onChange={setBranchId}
            placeholder={t.common.all}
            options={branches.map((b) => ({ value: b.id, label: b.nameAr }))}
          />
        </Field>
        <Field label={t.licenses.issueDate}>
          <TextInput value={issueDate} onChange={setIssueDate} type="date" />
        </Field>
        <Field label={t.licenses.renewalDate}>
          <TextInput value={renewalDate} onChange={setRenewalDate} type="date" />
        </Field>
        <Field label={t.licenses.expiryDate} error={errors.expiryDate}>
          <TextInput value={expiryDate} onChange={setExpiryDate} type="date" error={!!errors.expiryDate} />
        </Field>
        <Field label={t.common.notes} className="span-all">
          <TextArea value={notes} onChange={setNotes} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
