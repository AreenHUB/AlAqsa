// ============================================================================
// AlAqsa — Reminders: maintenance due, warranty/licence expiry, overdue money.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import {
  Modal, Field, TextInput, Select, Loading, EmptyState, Badge,
  ConfirmDialog, useToast, fmtDate, daysUntil,
} from '../components/ui';
import { todayISO } from '../utils/validation';
import type { Route } from '../Shell';
import type { Reminder, Client } from '@shared/types';

export function RemindersScreen({ navigate }: { navigate: (r: Route) => void }) {
  const { t, fmt } = useI18n();
  const toast = useToast();

  const [items, setItems] = useState<Reminder[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [deleting, setDeleting] = useState<Reminder | null>(null);

  const load = useCallback(async () => {
    const [r, c] = await Promise.all([
      window.alaqsa.reminders.all(),
      window.alaqsa.clients.list({ limit: 500 }),
    ]);
    if (r.ok) setItems(r.data);
    if (c.ok) setClients(c.data.rows);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(
    () => items.filter((r) => (showDone ? true : !r.done))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [items, showDone],
  );

  const clientName = (id?: string) => clients.find((c) => c.id === id)?.nameAr;

  const markDone = async (id: string) => {
    const res = await window.alaqsa.reminders.markDone(id);
    if (res.ok) { toast.success(t.msg.updated); void load(); }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = await window.alaqsa.reminders.remove(deleting.id);
    setDeleting(null);
    if (res.ok) { toast.success(t.msg.deleted); void load(); }
  };

  const tone = (r: Reminder): 'danger' | 'warning' | 'info' | 'neutral' => {
    if (r.done) return 'neutral';
    const d = daysUntil(r.dueDate);
    if (d === null) return 'info';
    if (d < 0) return 'danger';
    if (d <= 7) return 'warning';
    return 'info';
  };

  const toneText = (r: Reminder): string => {
    if (r.done) return '✓';
    const d = daysUntil(r.dueDate);
    if (d === null) return '';
    if (d < 0) return `${t.reminders.overdue} (${Math.abs(d)} ${t.common.days})`;
    if (d === 0) return t.reminders.dueToday;
    return fmt(t.reminders.inDays, { n: d });
  };

  const kindIcon: Record<string, string> = {
    maintenance_due: '🛠', warranty_expiry: '🛡', license_expiry: '📋',
    amc_expiry: '📑', invoice_overdue: '💰', custom: '🔔',
  };

  const overdueCount = items.filter((r) => !r.done && (daysUntil(r.dueDate) ?? 0) < 0).length;
  const soonCount = items.filter((r) => {
    const d = daysUntil(r.dueDate);
    return !r.done && d !== null && d >= 0 && d <= 7;
  }).length;

  if (loading) return <Loading />;

  return (
    <div className="col gap-16 fade-in">
      <div className="row between wrap gap-12">
        <div>
          <h1 style={{ fontSize: 22 }}>{t.reminders.title}</h1>
          <p className="muted small">{visible.length} {t.common.results}</p>
        </div>
        <div className="row gap-8">
          <button className={`btn ${showDone ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setShowDone((v) => !v)}>
            {showDone ? '✓' : '○'} {t.reminders.markDone}
          </button>
          <button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
            + {t.reminders.newReminder}
          </button>
        </div>
      </div>

      <div className="stat-grid">
        <div className={`stat ${overdueCount ? 'accent-danger' : ''}`}>
          <span className="stat-icon">⚠️</span>
          <div className="stat-label">{t.reminders.overdue}</div>
          <div className="stat-value">{overdueCount}</div>
        </div>
        <div className={`stat ${soonCount ? 'accent-warning' : ''}`}>
          <span className="stat-icon">⏳</span>
          <div className="stat-label">7 {t.common.days}</div>
          <div className="stat-value">{soonCount}</div>
        </div>
        <div className="stat">
          <span className="stat-icon">🔔</span>
          <div className="stat-label">{t.common.all}</div>
          <div className="stat-value">{items.filter((r) => !r.done).length}</div>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState icon="🔔" title={t.reminders.noReminders}
          action={<button className="btn btn-primary"
            onClick={() => { setEditing(null); setFormOpen(true); }}>+ {t.reminders.newReminder}</button>} />
      ) : (
        <div className="col gap-8">
          {visible.map((r) => (
            <div key={r.id} className="card" style={{ opacity: r.done ? 0.55 : 1 }}>
              <div className="card-body row between wrap gap-12" style={{ padding: 14 }}>
                <div className="row gap-12" style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 20 }}>{kindIcon[r.kind] ?? '🔔'}</span>
                  <div className="col" style={{ minWidth: 0 }}>
                    <span className="bold truncate" style={{ fontSize: 13.5 }}>{r.title}</span>
                    <div className="row gap-10 tiny muted wrap">
                      <span>📅 {fmtDate(r.dueDate)}</span>
                      <span>{t.reminders.kinds[r.kind as keyof typeof t.reminders.kinds]}</span>
                      {clientName(r.clientId) && <span>👤 {clientName(r.clientId)}</span>}
                    </div>
                  </div>
                </div>
                <div className="row gap-6">
                  <Badge kind={tone(r)}>{toneText(r)}</Badge>
                  {r.clientId && (
                    <button className="btn btn-ghost btn-icon btn-sm" title={t.common.view}
                      onClick={() => navigate({ name: 'client', id: r.clientId! })}>👁</button>
                  )}
                  {!r.done && (
                    <button className="btn btn-success btn-sm" onClick={() => markDone(r.id)}>
                      ✓ {t.reminders.markDone}
                    </button>
                  )}
                  <button className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => { setEditing(r); setFormOpen(true); }}>✏️</button>
                  <button className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => setDeleting(r)}>🗑</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ReminderFormModal
        open={formOpen}
        reminder={editing}
        clients={clients}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); void load(); }}
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

function ReminderFormModal({
  open, reminder, clients, onClose, onSaved,
}: {
  open: boolean;
  reminder: Reminder | null;
  clients: Client[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('custom');
  const [clientId, setClientId] = useState('');
  const [dueDate, setDueDate] = useState(todayISO());
  const [leadDays, setLeadDays] = useState('7');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(reminder?.title ?? '');
    setKind(reminder?.kind ?? 'custom');
    setClientId(reminder?.clientId ?? '');
    setDueDate(reminder?.dueDate ?? todayISO());
    setLeadDays(reminder?.leadDays?.toString() ?? '7');
    setErrors({});
  }, [open, reminder]);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = t.validation.required;
    if (!dueDate) e.dueDate = t.validation.required;
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    const res = await window.alaqsa.reminders.save({
      id: reminder?.id,
      kind: kind as Reminder['kind'],
      clientId: clientId || undefined,
      title: title.trim(),
      dueDate,
      leadDays: Number(leadDays) || 7,
      done: reminder?.done ?? false,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(reminder ? t.msg.updated : t.msg.created);
    onSaved();
  };

  return (
    <Modal
      open={open}
      title={reminder ? t.common.edit : t.reminders.newReminder}
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
        <Field label={t.reminders.reminderTitle} required error={errors.title} className="span-all">
          <TextInput value={title} onChange={setTitle} error={!!errors.title} autoFocus />
        </Field>
        <Field label={t.common.type}>
          <Select
            value={kind}
            onChange={setKind}
            options={Object.entries(t.reminders.kinds).map(([k, v]) => ({ value: k, label: v as string }))}
          />
        </Field>
        <Field label={t.nav.clients}>
          <Select
            value={clientId}
            onChange={setClientId}
            placeholder={t.common.none}
            options={clients.map((c) => ({ value: c.id, label: c.nameAr }))}
          />
        </Field>
        <Field label={t.reminders.dueDate} required error={errors.dueDate}>
          <TextInput value={dueDate} onChange={setDueDate} type="date" error={!!errors.dueDate} />
        </Field>
        <Field label={t.reminders.leadDays}>
          <TextInput value={leadDays} onChange={setLeadDays} type="number" min={0} dir="ltr" />
        </Field>
      </div>
    </Modal>
  );
}
