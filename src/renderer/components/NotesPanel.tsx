// ============================================================================
// AlAqsa — Dated notes log for a client, with one-tap sharing to the team.
//
// This is the "things worth remembering" log: access quirks, disputes, agreed
// arrangements. Any note (and the branch location) can be pushed straight to a
// team member over WhatsApp so the person heading out knows before arriving.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import {
  Modal, Field, TextArea, TextInput, Select, EmptyState, Badge,
  ConfirmDialog, useToast, useErrorMessage, Loading, Checkbox,
} from './ui';
import type { NoteEntry, Branch, StaffMember } from '@shared/types';

export function NotesPanel({
  clientId, clientName, branches,
}: {
  clientId: string;
  clientName: string;
  branches: Branch[];
}) {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<NoteEntry | null>(null);
  const [deleting, setDeleting] = useState<NoteEntry | null>(null);
  const [sharing, setSharing] = useState<{ message: string } | null>(null);

  const load = useCallback(async () => {
    const [n, s] = await Promise.all([
      window.alaqsa.notes.listByClient(clientId),
      window.alaqsa.staff.list(),
    ]);
    if (n.ok) setNotes(n.data);
    if (s.ok) setStaff(s.data);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = await window.alaqsa.notes.remove(deleting.id);
    setDeleting(null);
    if (res.ok) { toast.success(t.msg.deleted); void load(); }
    else toast.error(errMsg(res.error));
  };

  const shareNote = (note: NoteEntry) => {
    const branch = branches.find((b) => b.id === note.branchId);
    const header = branch ? `${clientName} — ${branch.nameAr}` : clientName;
    setSharing({ message: `📌 ${header}\n\n${note.body}` });
  };

  const shareLocation = async (branch: Branch) => {
    // Delegate to the main process so the maps link is built consistently.
    setSharing({ message: `__LOCATION__${branch.id}` });
  };

  if (loading) return <Loading />;

  return (
    <div className="col gap-12">
      <div className="row between wrap gap-8">
        <div className="col">
          <span className="muted small">{t.notesLog.subtitle}</span>
        </div>
        <div className="row gap-8">
          {branches.length > 0 && (
            <Select
              value=""
              onChange={(id) => { const b = branches.find((x) => x.id === id); if (b) void shareLocation(b); }}
              placeholder={`📍 ${t.notesLog.shareLocation}`}
              options={branches.map((b) => ({ value: b.id, label: b.nameAr }))}
            />
          )}
          <button className="btn btn-primary btn-sm"
            onClick={() => { setEditing(null); setFormOpen(true); }}>
            + {t.notesLog.add}
          </button>
        </div>
      </div>

      {notes.length === 0 ? (
        <EmptyState icon="📝" title={t.notesLog.noNotes} message={t.notesLog.bodyHint}
          action={<button className="btn btn-primary"
            onClick={() => { setEditing(null); setFormOpen(true); }}>+ {t.notesLog.add}</button>} />
      ) : (
        <div className="col gap-8">
          {notes.map((n) => {
            const branch = branches.find((b) => b.id === n.branchId);
            return (
              <div key={n.id} className="card" style={{
                borderInlineStartWidth: n.pinned ? 4 : 1,
                borderInlineStartColor: n.pinned ? 'var(--warning)' : 'var(--border)',
              }}>
                <div className="card-body col gap-8" style={{ padding: 14 }}>
                  <div className="row between gap-8 wrap">
                    <div className="row gap-8 wrap">
                      {n.pinned && <Badge kind="warning">📌 {t.notesLog.pinned}</Badge>}
                      {branch && <Badge kind="info">🏢 {branch.nameAr}</Badge>}
                      <span className="tiny muted">{n.createdAt.slice(0, 16).replace('T', ' ')}</span>
                      {n.author && <span className="tiny muted">— {n.author}</span>}
                    </div>
                    <div className="row gap-4">
                      <button className="btn btn-outline btn-sm" onClick={() => shareNote(n)}>
                        💬 {t.notesLog.shareTeam}
                      </button>
                      <button className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => { setEditing(n); setFormOpen(true); }}>✏️</button>
                      <button className="btn btn-danger btn-icon btn-sm"
                        title={t.common.delete}
                        onClick={() => setDeleting(n)}>🗑</button>
                    </div>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: 13.5 }}>{n.body}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NoteFormModal
        open={formOpen}
        clientId={clientId}
        note={editing}
        branches={branches}
        staff={staff}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); void load(); }}
      />

      <ShareToTeamModal
        open={!!sharing}
        message={sharing?.message ?? ''}
        staff={staff}
        onClose={() => setSharing(null)}
      />

      <ConfirmDialog
        open={!!deleting}
        title={t.msg.confirmDelete}
        message={t.notesLog.deleteConfirm}
        danger
        confirmLabel={t.common.delete}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function NoteFormModal({
  open, clientId, note, branches, staff, onClose, onSaved,
}: {
  open: boolean;
  clientId: string;
  note: NoteEntry | null;
  branches: Branch[];
  staff: StaffMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();
  const [body, setBody] = useState('');
  const [branchId, setBranchId] = useState('');
  const [author, setAuthor] = useState('');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setBody(note?.body ?? '');
    setBranchId(note?.branchId ?? '');
    setAuthor(note?.author ?? '');
    setPinned(note?.pinned ?? false);
    setError('');
  }, [open, note]);

  const save = async () => {
    if (!body.trim()) return setError(t.validation.required);
    setBusy(true);
    const res = await window.alaqsa.notes.save({
      id: note?.id, clientId,
      branchId: branchId || undefined,
      body: body.trim(),
      author: author.trim() || undefined,
      pinned,
    });
    setBusy(false);
    if (!res.ok) return toast.error(errMsg(res.error));
    toast.success(note ? t.msg.updated : t.msg.created);
    onSaved();
  };

  return (
    <Modal
      open={open}
      title={note ? t.common.edit : t.notesLog.add}
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
      <div className="col gap-14">
        <Field label={t.notesLog.body} required error={error || undefined} hint={t.notesLog.bodyHint}>
          <TextArea value={body} onChange={(v) => { setBody(v); setError(''); }}
            rows={5} error={!!error} autoFocus />
        </Field>
        <div className="form-grid">
          {branches.length > 0 && (
            <Field label={t.branches.title}>
              <Select
                value={branchId}
                onChange={setBranchId}
                placeholder={t.common.all}
                options={branches.map((b) => ({ value: b.id, label: b.nameAr }))}
              />
            </Field>
          )}
          <Field label={t.notesLog.author}>
            <TextInput value={author} onChange={setAuthor} list="staff-names" />
          </Field>
          <datalist id="staff-names">
            {staff.map((s) => <option key={s.id} value={s.name} />)}
          </datalist>
        </div>
        <Checkbox checked={pinned} onChange={setPinned} label={`📌 ${t.notesLog.pin}`} />
      </div>
    </Modal>
  );
}

/** Sends a note or a branch location to a team member over WhatsApp. */
function ShareToTeamModal({
  open, message, staff, onClose,
}: {
  open: boolean;
  message: string;
  staff: StaffMember[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();
  const [phone, setPhone] = useState('');
  const [text, setText] = useState('');

  const isLocation = message.startsWith('__LOCATION__');
  const branchId = isLocation ? message.replace('__LOCATION__', '') : '';

  useEffect(() => {
    if (!open) return;
    setPhone(staff.find((s) => s.phone)?.phone ?? '');
    setText(isLocation ? '' : message);
  }, [open, message, staff, isLocation]);

  const send = async () => {
    if (!phone.trim()) return toast.warning(t.notesLog.phoneNumber);
    const res = isLocation
      ? await window.alaqsa.share.branchLocation(branchId, phone.trim())
      : await window.alaqsa.share.whatsAppText(phone.trim(), text);
    if (!res.ok) {
      toast.error(res.error === 'NO_LOCATION' ? t.branches.noBranches : res.error);
      return;
    }
    onClose();
  };

  const withPhone = staff.filter((s) => s.phone);

  return (
    <Modal
      open={open}
      title={isLocation ? t.notesLog.shareLocation : t.notesLog.shareTeam}
      onClose={onClose}
      size="sm"
      onSubmit={send}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>{t.common.cancel}</button>
          <button className="btn btn-success" onClick={send}>💬 {t.common.share}</button>
        </>
      }
    >
      <div className="col gap-14">
        {withPhone.length > 0 && (
          <Field label={t.notesLog.sendTo} hint={t.notesLog.teamHint}>
            <Select
              value={phone}
              onChange={setPhone}
              placeholder={t.common.selectOption}
              options={withPhone.map((s) => ({ value: s.phone!, label: `${s.name} — ${s.phone}` }))}
            />
          </Field>
        )}
        <Field label={t.notesLog.phoneNumber}>
          <TextInput value={phone} onChange={setPhone} dir="ltr" placeholder="+9715xxxxxxxx" />
        </Field>
        {!isLocation && (
          <Field label={t.reports.messageText}>
            <TextArea value={text} onChange={setText} rows={5} />
          </Field>
        )}
        {isLocation && (
          <div className="small muted" style={{
            padding: '10px 12px', background: 'var(--info-bg)',
            borderRadius: 'var(--radius)', lineHeight: 1.6,
          }}>
            📍 سيتم إرسال اسم الفرع والعنوان ورابط الخريطة.
          </div>
        )}
      </div>
    </Modal>
  );
}
