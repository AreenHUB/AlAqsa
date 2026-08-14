// ============================================================================
// AlAqsa — Client documents: passports, IDs, trade licences, pledges, building
// plans/photos, contracts. Files are stored encrypted; only paths live in DB.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import {
  Modal, Field, TextInput, TextArea, Select, EmptyState, Badge,
  ConfirmDialog, useToast, useErrorMessage, Loading, fmtDate, daysUntil,
} from './ui';
import { DOCUMENT_KINDS } from '@shared/constants';
import type { DocumentRecord, Branch } from '@shared/types';

export function DocumentsPanel({
  clientId, branches, onChanged,
}: {
  clientId: string;
  branches: Branch[];
  onChanged: () => void;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<DocumentRecord | null>(null);

  const load = useCallback(async () => {
    const res = await window.alaqsa.documents.listByClient(clientId);
    if (res.ok) setDocs(res.data);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const kindLabel = (v: string) => {
    const k = DOCUMENT_KINDS.find((x) => x.value === v);
    return k ? (lang === 'ar' ? k.ar : k.en) : v;
  };

  const openDoc = async (id: string) => {
    const res = await window.alaqsa.documents.open(id);
    if (!res.ok) toast.error(errMsg(res.error));
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = await window.alaqsa.documents.remove(deleting.id);
    setDeleting(null);
    if (res.ok) { toast.success(t.msg.deleted); void load(); onChanged(); }
    else toast.error(errMsg(res.error));
  };

  const expiryBadge = (d: DocumentRecord) => {
    const days = daysUntil(d.expiryDate);
    if (days === null) return null;
    if (days < 0) return <Badge kind="danger">{t.licenses.expired}</Badge>;
    if (days <= 30) return <Badge kind="warning">{days} {t.common.days}</Badge>;
    return <Badge kind="success">{t.licenses.valid}</Badge>;
  };

  const fileIcon = (mime: string) => {
    if (mime.startsWith('image/')) return '🖼';
    if (mime.includes('pdf')) return '📕';
    if (mime.includes('word')) return '📘';
    if (mime.includes('sheet') || mime.includes('excel')) return '📗';
    if (mime.includes('presentation') || mime.includes('powerpoint')) return '📙';
    return '📄';
  };

  if (loading) return <Loading />;

  return (
    <div className="col gap-12">
      <div className="row between">
        <span className="muted small">
          {docs.length} {t.documents.title} · 🔒 {t.documents.encrypted}
        </span>
        <button className="btn btn-primary btn-sm" onClick={() => setFormOpen(true)}>
          + {t.documents.addDocument}
        </button>
      </div>

      {docs.length === 0 ? (
        <EmptyState icon="📁" title={t.documents.noDocuments}
          message={t.documents.fileTypes}
          action={<button className="btn btn-primary" onClick={() => setFormOpen(true)}>
            + {t.documents.addDocument}</button>} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(255px, 1fr))', gap: 12 }}>
          {docs.map((d) => (
            <div key={d.id} className="card card-hover" onClick={() => openDoc(d.id)}>
              <div className="card-body col gap-8" style={{ padding: 14 }}>
                <div className="row between gap-8">
                  <span style={{ fontSize: 26 }}>{fileIcon(d.media.mimeType)}</span>
                  <div className="row gap-4">
                    {expiryBadge(d)}
                    <button
                      className="btn btn-danger btn-icon btn-sm"
                      title={t.common.delete}
                      aria-label={t.common.delete}
                      onClick={(e) => { e.stopPropagation(); setDeleting(d); }}
                    >🗑</button>
                  </div>
                </div>
                <div className="bold truncate" style={{ fontSize: 13.5 }}>{d.title}</div>
                <Badge kind="info">{kindLabel(d.kind)}</Badge>
                <div className="tiny muted truncate">{d.media.fileName}</div>
                {d.expiryDate && (
                  <div className="tiny muted">{t.documents.expiryDate}: {fmtDate(d.expiryDate)}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <DocumentFormModal
        open={formOpen}
        clientId={clientId}
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

function DocumentFormModal({
  open, clientId, branches, onClose, onSaved,
}: {
  open: boolean;
  clientId: string;
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [kind, setKind] = useState('passport');
  const [title, setTitle] = useState('');
  const [branchId, setBranchId] = useState('');
  const [filePath, setFilePath] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setKind('passport'); setTitle(''); setBranchId(''); setFilePath(''); setErrors({});
  }, [open]);

  const pickFile = async () => {
    const res = await window.alaqsa.files.pickOpen();
    if (res.ok && res.data) {
      setFilePath(res.data);
      if (!title.trim()) {
        const base = res.data.split(/[\\/]/).pop() ?? '';
        setTitle(base.replace(/\.[^.]+$/, ''));
      }
    }
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (!filePath) e.file = t.validation.required;
    if (!title.trim()) e.title = t.validation.required;
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    const res = await window.alaqsa.documents.add(
      clientId, branchId || null, kind, title.trim(), filePath,
    );
    setBusy(false);
    if (!res.ok) return toast.error(errMsg(res.error));
    toast.success(t.msg.created);
    onSaved();
  };

  return (
    <Modal
      open={open}
      title={t.documents.addDocument}
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
        <Field label={t.documents.chooseFile} required error={errors.file} hint={t.documents.fileTypes}>
          <div className="row gap-8">
            <input className="input" value={filePath} readOnly dir="ltr"
              placeholder={t.documents.chooseFile} />
            <button className="btn btn-outline" onClick={pickFile}>📎</button>
          </div>
        </Field>

        <div className="form-grid">
          <Field label={t.documents.documentKind} required>
            <Select
              value={kind}
              onChange={setKind}
              options={DOCUMENT_KINDS.map((k) => ({ value: k.value, label: lang === 'ar' ? k.ar : k.en }))}
            />
          </Field>
          <Field label={t.documents.documentTitle} required error={errors.title}>
            <TextInput value={title} onChange={setTitle} error={!!errors.title} />
          </Field>
          {branches.length > 0 && (
            <Field label={t.branches.title} className="span-all">
              <Select
                value={branchId}
                onChange={setBranchId}
                placeholder={t.common.all}
                options={branches.map((b) => ({ value: b.id, label: b.nameAr }))}
              />
            </Field>
          )}
        </div>

        <div className="small muted" style={{
          padding: '10px 12px', background: 'var(--info-bg)',
          borderRadius: 'var(--radius)', lineHeight: 1.6,
        }}>
          🔒 سيتم تشفير هذا الملف وحفظه داخل قاعدة بيانات التطبيق الآمنة.
        </div>
      </div>
    </Modal>
  );
}
