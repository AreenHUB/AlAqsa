// ============================================================================
// AlAqsa — Staff directory management plus a per-technician activity report.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import {
  Modal, Field, TextInput, TextArea, Checkbox, Loading, EmptyState,
  Badge, ConfirmDialog, useToast, useErrorMessage, fmtDate,
} from './ui';
import { isValidPhone, isValidEmail } from '../utils/validation';
import type { StaffMember } from '@shared/types';
import type { StaffActivity } from '@shared/ipc';

export function StaffTab() {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [activity, setActivity] = useState<StaffActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [deleting, setDeleting] = useState<StaffMember | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    const [s, a] = await Promise.all([
      window.alaqsa.staff.list(true),
      window.alaqsa.staff.activity(from || undefined, to || undefined),
    ]);
    if (s.ok) setStaff(s.data);
    if (a.ok) setActivity(a.data);
    setLoading(false);
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = await window.alaqsa.staff.remove(deleting.id);
    setDeleting(null);
    if (res.ok) { toast.success(t.msg.deleted); void load(); }
    else toast.error(errMsg(res.error));
  };

  if (loading) return <Loading />;

  return (
    <div className="col gap-20">
      {/* Directory */}
      <div className="col gap-10">
        <div className="row between wrap gap-8">
          <div className="col">
            <span className="bold">👷 {t.staff.title}</span>
            <span className="tiny muted">{t.staff.subtitle}</span>
          </div>
          <button className="btn btn-primary btn-sm"
            onClick={() => { setEditing(null); setFormOpen(true); }}>
            + {t.staff.newStaff}
          </button>
        </div>

        {staff.length === 0 ? (
          <EmptyState icon="👷" title={t.staff.noStaff}
            action={<button className="btn btn-primary"
              onClick={() => { setEditing(null); setFormOpen(true); }}>+ {t.staff.newStaff}</button>} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.staff.name}</th>
                  <th>{t.staff.role}</th>
                  <th>{t.common.phone}</th>
                  <th>{t.common.status}</th>
                  <th style={{ width: 80 }} />
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id}>
                    <td className="small bold">{s.name}</td>
                    <td className="small">{s.role ?? '—'}</td>
                    <td className="small mono" dir="ltr">{s.phone ?? '—'}</td>
                    <td>
                      <div className="row gap-4">
                        {!s.active && <Badge kind="neutral">✕</Badge>}
                        {s.isTemporary && <Badge kind="warning">{t.staff.temporary}</Badge>}
                        {s.active && !s.isTemporary && <Badge kind="success">✓</Badge>}
                      </div>
                    </td>
                    <td>
                      <div className="cell-actions">
                        <button className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => { setEditing(s); setFormOpen(true); }}>✏️</button>
                        <button className="btn btn-danger btn-icon btn-sm"
                          onClick={() => setDeleting(s)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Activity report */}
      <div className="col gap-10">
        <div className="row between wrap gap-8">
          <span className="bold">📊 {t.staff.activity}</span>
          <div className="row gap-8 wrap">
            <div className="row gap-6" style={{ alignItems: 'center' }}>
              <span className="tiny muted">{t.staff.from}</span>
              <input className="input" style={{ minHeight: 31, width: 145 }} type="date"
                value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="row gap-6" style={{ alignItems: 'center' }}>
              <span className="tiny muted">{t.staff.to}</span>
              <input className="input" style={{ minHeight: 31, width: 145 }} type="date"
                value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            {(from || to) && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setFrom(''); setTo(''); }}>
                ✕ {t.common.clearFilters}
              </button>
            )}
          </div>
        </div>

        {activity.length === 0 ? (
          <EmptyState icon="📊" title={t.common.noData} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.staff.name}</th>
                  <th>{t.staff.totalVisits}</th>
                  <th>{t.visits.title} — {t.reminders.kinds.maintenance_due}</th>
                  <th>{t.reports.title}</th>
                  <th>{t.staff.lastVisit}</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((a) => (
                  <tr key={a.name}>
                    <td className="small bold">{a.name}</td>
                    <td><Badge kind="info">{a.total}</Badge></td>
                    <td className="small">{a.maintenance}</td>
                    <td className="small">{a.installation} / {a.repair}</td>
                    <td className="small">{fmtDate(a.lastVisit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <StaffFormModal
        open={formOpen}
        member={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); void load(); }}
      />

      <ConfirmDialog
        open={!!deleting}
        title={t.msg.confirmDelete}
        message={t.staff.deleteConfirm}
        danger
        confirmLabel={t.common.delete}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function StaffFormModal({
  open, member, onClose, onSaved,
}: {
  open: boolean;
  member: StaffMember | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [active, setActive] = useState(true);
  const [isTemporary, setIsTemporary] = useState(false);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(member?.name ?? '');
    setRole(member?.role ?? '');
    setPhone(member?.phone ?? '');
    setEmail(member?.email ?? '');
    setActive(member?.active ?? true);
    setIsTemporary(member?.isTemporary ?? false);
    setNotes(member?.notes ?? '');
    setErrors({});
  }, [open, member]);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = t.validation.required;
    if (phone.trim() && !isValidPhone(phone)) e.phone = t.validation.invalidPhone;
    if (email.trim() && !isValidEmail(email)) e.email = t.validation.invalidEmail;
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    const res = await window.alaqsa.staff.save({
      id: member?.id, name: name.trim(), role: role.trim() || undefined,
      phone: phone.trim() || undefined, email: email.trim() || undefined,
      active, isTemporary, notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) return toast.error(errMsg(res.error));
    toast.success(member ? t.msg.updated : t.msg.created);
    onSaved();
  };

  return (
    <Modal
      open={open}
      title={member ? t.staff.editStaff : t.staff.newStaff}
      onClose={onClose}
      onSubmit={save}
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
        <Field label={t.staff.name} required error={errors.name}>
          <TextInput value={name} onChange={setName} error={!!errors.name} autoFocus />
        </Field>
        <Field label={t.staff.role} hint={t.staff.rolePlaceholder}>
          <TextInput value={role} onChange={setRole} />
        </Field>
        <Field label={t.common.phone} error={errors.phone}>
          <TextInput value={phone} onChange={setPhone} dir="ltr"
            error={!!errors.phone} placeholder="+9715xxxxxxxx" />
        </Field>
        <Field label={t.common.email} error={errors.email}>
          <TextInput value={email} onChange={setEmail} dir="ltr" error={!!errors.email} />
        </Field>
        <div className="span-all col gap-8">
          <Checkbox checked={active} onChange={setActive} label={t.staff.active} />
          <Checkbox checked={isTemporary} onChange={setIsTemporary} label={t.staff.temporary} />
        </div>
        <Field label={t.common.notes} className="span-all">
          <TextArea value={notes} onChange={setNotes} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
