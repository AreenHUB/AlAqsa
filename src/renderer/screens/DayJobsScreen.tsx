// ============================================================================
// AlAqsa — The daily work schedule.
//
// This is the sheet the technicians are handed each morning: where to go, who
// to call, what the work is, and who is going. It is deliberately separate
// from Visits — a visit is what WAS done and is recorded afterwards; a day job
// is what is PLANNED and is printed beforehand.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import {
  Modal, Field, TextInput, TextArea, Select, Loading, EmptyState, Badge,
  ConfirmDialog, useToast, useErrorMessage,
} from '../components/ui';
import type { DayJob, StaffMember, Client, Branch } from '@shared/types';

const STATUS_KIND: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  planned: 'info', in_progress: 'warning', done: 'success',
  cancelled: 'danger', postponed: 'neutral',
};

/** Today in the local timezone, as YYYY-MM-DD. */
function todayIso(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function DayJobsScreen() {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [date, setDate] = useState(todayIso);
  const [jobs, setJobs] = useState<DayJob[]>([]);
  const [counts, setCounts] = useState({ total: 0, done: 0, planned: 0 });
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DayJob | null>(null);
  const [deleting, setDeleting] = useState<DayJob | null>(null);

  const load = useCallback(async () => {
    const [list, c] = await Promise.all([
      window.alaqsa.dayJobs.listByDate(date),
      window.alaqsa.dayJobs.counts(date),
    ]);
    if (list.ok) setJobs(list.data);
    if (c.ok) setCounts(c.data);
    setLoading(false);
  }, [date]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => window.alaqsa.events.onDataChanged((e) => {
    if (e === 'dayJobs') void load();
  }), [load]);

  const printSheet = async () => {
    const res = await window.alaqsa.dayJobs.sheetPdf(date);
    if (!res.ok) return toast.error(errMsg(res.error));
    toast.success(t.reports.generated);
    const p = await window.alaqsa.reports.print(res.data.path);
    if (!p.ok) {
      // Printing can fail for reasons the export itself did not: no printer,
      // no PDF association. The file exists either way, so offer it.
      await window.alaqsa.exports.revealInFolder(res.data.path);
      toast.warning(errMsg(p.error));
    }
  };

  const setStatus = async (job: DayJob, status: string) => {
    const res = await window.alaqsa.dayJobs.setStatus(job.id, status);
    if (!res.ok) return toast.error(errMsg(res.error));
    void load();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = await window.alaqsa.dayJobs.remove(deleting.id);
    setDeleting(null);
    if (res.ok) { toast.success(t.msg.deleted); void load(); }
    else toast.error(errMsg(res.error));
  };

  const isToday = date === todayIso();

  if (loading) return <Loading />;

  return (
    <div className="col gap-16 fade-in">
      <div className="row between wrap gap-12">
        <div>
          <h1 style={{ fontSize: 22 }}>{t.dayJobs.title}</h1>
          <p className="muted small">{t.dayJobs.subtitle}</p>
        </div>
        <div className="row gap-8">
          <button className="btn btn-outline" onClick={printSheet} disabled={!jobs.length}>
            🖨 {t.dayJobs.printSheet}
          </button>
          <button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
            + {t.dayJobs.newJob}
          </button>
        </div>
      </div>

      {/* Date picker with quick steps: the crew almost always wants today or
          tomorrow, so those are one click rather than a calendar. */}
      <div className="card">
        <div className="card-body row gap-10 wrap" style={{ padding: 14 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setDate((d) => shiftDate(d, -1))}>‹</button>
          <input
            className="input"
            style={{ width: 170 }}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || todayIso())}
            dir="ltr"
          />
          <button className="btn btn-ghost btn-sm" onClick={() => setDate((d) => shiftDate(d, 1))}>›</button>
          <button className={`btn btn-sm ${isToday ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setDate(todayIso())}>{t.dayJobs.today}</button>
          <button className="btn btn-outline btn-sm"
            onClick={() => setDate(shiftDate(todayIso(), 1))}>{t.dayJobs.tomorrow}</button>

          <div className="row gap-8" style={{ marginInlineStart: 'auto' }}>
            <Badge kind="info">{t.dayJobs.total}: {counts.total}</Badge>
            <Badge kind="success">{t.dayJobs.done}: {counts.done}</Badge>
            <Badge kind="warning">{t.dayJobs.planned}: {counts.planned}</Badge>
          </div>
        </div>
      </div>

      {jobs.length === 0 ? (
        <EmptyState icon="🗓" title={t.dayJobs.noJobs} message={t.dayJobs.noJobsHint}
          action={
            <button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
              + {t.dayJobs.newJob}
            </button>
          } />
      ) : (
        <div className="col gap-10">
          {jobs.map((j, i) => (
            <div className="card" key={j.id}>
              <div className="card-body col gap-8" style={{ padding: 14 }}>
                <div className="row between wrap gap-8">
                  <div className="row gap-8">
                    <Badge kind={STATUS_KIND[j.status] ?? 'neutral'}>
                      {(t.dayJobs.statuses as Record<string, string>)[j.status] ?? j.status}
                    </Badge>
                    {j.startTime && <Badge kind="neutral">🕐 {j.startTime}</Badge>}
                  </div>
                  <div className="bold" style={{ fontSize: 15 }}>
                    {i + 1}. {j.placeName || j.clientName || '—'}
                  </div>
                </div>

                <div className="row wrap gap-16 small muted">
                  {(j.branchName || j.location) && (
                    <span>📍 {[j.branchName, j.location].filter(Boolean).join(' — ')}</span>
                  )}
                  {j.contactPhone && (
                    <span dir="ltr">📞 {j.contactPhone}{j.contactName ? ` (${j.contactName})` : ''}</span>
                  )}
                  {!!(j.staffNames ?? []).length && <span>👷 {(j.staffNames ?? []).join('، ')}</span>}
                </div>

                {j.workDescription && <div className="small">{j.workDescription}</div>}
                {j.notes && <div className="tiny faint">{j.notes}</div>}

                <div className="row gap-6 wrap">
                  {j.status !== 'done' && (
                    <button className="btn btn-outline btn-sm" onClick={() => setStatus(j, 'done')}>
                      ✓ {t.dayJobs.markDone}
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => { setEditing(j); setFormOpen(true); }}>✏️ {t.common.edit}</button>
                  {j.contactPhone && (
                    <button className="btn btn-ghost btn-sm" onClick={async () => {
                      const r = await window.alaqsa.share.whatsAppText(
                        j.contactPhone!,
                        `${t.dayJobs.title} — ${date}\n${j.workDescription ?? ''}`,
                      );
                      if (!r.ok) toast.error(errMsg(r.error));
                    }}>📱</button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => setDeleting(j)}>🗑</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <DayJobFormModal
        open={formOpen}
        job={editing}
        date={date}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); void load(); }}
      />

      <ConfirmDialog
        open={!!deleting}
        title={t.msg.confirmDelete}
        message={deleting?.placeName ?? deleting?.clientName ?? ''}
        danger
        confirmLabel={t.common.delete}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
function DayJobFormModal({
  open, job, date, onClose, onSaved,
}: {
  open: boolean;
  job: DayJob | null;
  date: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [useClient, setUseClient] = useState(true);
  const [clientId, setClientId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [location, setLocation] = useState('');
  const [work, setWork] = useState('');
  const [startTime, setStartTime] = useState('');
  const [notes, setNotes] = useState('');
  const [staffIds, setStaffIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [clients, setClients] = useState<Client[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);

  useEffect(() => {
    if (!open) return;
    void window.alaqsa.clients.list({ limit: 500 }).then((r) => { if (r.ok) setClients(r.data.rows); });
    void window.alaqsa.staff.list().then((r) => { if (r.ok) setStaff(r.data); });

    setUseClient(!job || !!job.clientId);
    setClientId(job?.clientId ?? '');
    setBranchId(job?.branchId ?? '');
    setPlaceName(job?.placeName ?? '');
    setContactName(job?.contactName ?? '');
    setContactPhone(job?.contactPhone ?? '');
    setLocation(job?.location ?? '');
    setWork(job?.workDescription ?? '');
    setStartTime(job?.startTime ?? '');
    setNotes(job?.notes ?? '');
    setStaffIds(job?.staffIds ?? []);
  }, [open, job]);

  // Branches only matter for a client that actually has more than one.
  useEffect(() => {
    if (!clientId) { setBranches([]); return; }
    void window.alaqsa.branches.listByClient(clientId).then((r) => {
      if (r.ok) setBranches(r.data);
    });
  }, [clientId]);

  const realBranches = useMemo(
    () => branches.filter((b) => !b.isDefault || branches.length > 1),
    [branches],
  );

  /** Copy the address and phone we already hold, so nothing is retyped. */
  const fillFromClient = async () => {
    if (!clientId) return;
    const [cs, bs] = await Promise.all([
      window.alaqsa.clients.contacts(clientId),
      window.alaqsa.branches.listByClient(clientId),
    ]);
    if (cs.ok) {
      const primary = cs.data.find((c) => c.isPrimary) ?? cs.data[0];
      if (primary) {
        setContactName((v) => v || primary.name);
        setContactPhone((v) => v || (primary.phones?.[0] ?? ''));
      }
    }
    if (bs.ok) {
      const b = bs.data.find((x) => x.id === branchId) ?? bs.data[0];
      if (b?.location?.address) setLocation((v) => v || b.location.address!);
    }
    toast.success(t.dayJobs.fromClient);
  };

  const save = async () => {
    setBusy(true);
    const res = await window.alaqsa.dayJobs.save({
      id: job?.id,
      jobDate: date,
      clientId: useClient ? (clientId || undefined) : undefined,
      branchId: useClient ? (branchId || undefined) : undefined,
      placeName: useClient ? undefined : (placeName.trim() || undefined),
      contactName: contactName.trim() || undefined,
      contactPhone: contactPhone.trim() || undefined,
      location: location.trim() || undefined,
      workDescription: work.trim() || undefined,
      startTime: startTime || undefined,
      notes: notes.trim() || undefined,
      staffIds,
    });
    setBusy(false);
    if (!res.ok) return toast.error(errMsg(res.error));
    toast.success(job ? t.msg.updated : t.msg.created);
    onSaved();
  };

  const toggleStaff = (id: string) => {
    setStaffIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <Modal
      open={open}
      title={job ? t.dayJobs.editJob : t.dayJobs.newJob}
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
      <div className="col gap-12">
        {/* A job can be for a registered client or for a place that has not
            been entered yet — the shop books work before the paperwork. */}
        <div className="row gap-8">
          <button className={`btn btn-sm grow ${useClient ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setUseClient(true)}>{t.dayJobs.pickClient}</button>
          <button className={`btn btn-sm grow ${!useClient ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setUseClient(false)}>{t.dayJobs.manualPlace}</button>
        </div>

        {useClient ? (
          <>
            <Field label={t.nav.clients} required>
              <Select
                value={clientId}
                onChange={(v) => { setClientId(v); setBranchId(''); }}
                placeholder={t.dayJobs.pickClient}
                options={clients.map((c) => ({ value: c.id, label: c.nameAr }))}
              />
            </Field>
            {realBranches.length > 1 && (
              <Field label={t.clients.tabs.branches}>
                <Select
                  value={branchId}
                  onChange={setBranchId}
                  placeholder="—"
                  options={realBranches.map((b) => ({ value: b.id, label: b.nameAr }))}
                />
              </Field>
            )}
            {clientId && (
              <button className="btn btn-ghost btn-sm" onClick={fillFromClient}>
                ⤵ {t.dayJobs.fromClient}
              </button>
            )}
          </>
        ) : (
          <Field label={t.dayJobs.place} required hint={t.dayJobs.placeHint}>
            <TextInput value={placeName} onChange={setPlaceName} autoFocus />
          </Field>
        )}

        <div className="form-grid">
          <Field label={t.dayJobs.contactName}>
            <TextInput value={contactName} onChange={setContactName} />
          </Field>
          <Field label={t.dayJobs.contactPhone}>
            <TextInput value={contactPhone} onChange={setContactPhone} dir="ltr" />
          </Field>
          <Field label={t.dayJobs.startTime}>
            <TextInput value={startTime} onChange={setStartTime} type="time" dir="ltr" />
          </Field>
        </div>

        <Field label={t.dayJobs.location}>
          <TextInput value={location} onChange={setLocation} />
        </Field>

        <Field label={t.dayJobs.work}>
          <TextArea value={work} onChange={setWork} rows={2} />
        </Field>

        {/* One technician or several, chosen fresh for each job. */}
        <Field label={t.dayJobs.crew} hint={t.dayJobs.crewHint}>
          <div className="row gap-6 wrap">
            {staff.length === 0 && <span className="tiny faint">{t.staff.noStaff}</span>}
            {staff.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`btn btn-sm ${staffIds.includes(s.id) ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => toggleStaff(s.id)}
              >
                {staffIds.includes(s.id) ? '✓ ' : ''}{s.name}
              </button>
            ))}
          </div>
        </Field>

        <Field label={t.common.notes}>
          <TextArea value={notes} onChange={setNotes} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
