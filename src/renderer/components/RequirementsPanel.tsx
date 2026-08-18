// ============================================================================
// AlAqsa — "What do we need for this?" checklists.
//
// The shop keeps repeating the same paperwork conversations: renewing a camera
// licence needs the old licence, screenshots of the recordings, and a fee.
// A TEMPLATE captures that once; a CASE applies it to a client and tracks what
// has actually been collected.
//
// The case copies the template's items rather than pointing at them, so
// editing a template later never rewrites a case already in progress.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import {
  Modal, Field, TextInput, TextArea, Select, Loading, EmptyState, Badge,
  Checkbox, ConfirmDialog, useToast, useErrorMessage, fmtDate,
} from './ui';
import type {
  RequirementTemplate, RequirementCase, RequirementItem,
} from '@shared/types';

export function RequirementsPanel({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [cases, setCases] = useState<RequirementCase[]>([]);
  const [templates, setTemplates] = useState<RequirementTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [startOpen, setStartOpen] = useState(false);
  const [pickedTemplate, setPickedTemplate] = useState('');
  const [deleting, setDeleting] = useState<RequirementCase | null>(null);

  const load = useCallback(async () => {
    const [cs, tp] = await Promise.all([
      window.alaqsa.requirements.listCases(clientId),
      window.alaqsa.requirements.listTemplates(),
    ]);
    if (cs.ok) setCases(cs.data);
    if (tp.ok) setTemplates(tp.data);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const startCase = async () => {
    if (!pickedTemplate) return;
    const res = await window.alaqsa.requirements.createCase(clientId, pickedTemplate);
    setStartOpen(false);
    setPickedTemplate('');
    if (!res.ok) return toast.error(errMsg(res.error));
    toast.success(t.msg.created);
    void load();
  };

  const toggleItem = async (itemId: string, collected: boolean) => {
    const res = await window.alaqsa.requirements.setItemCollected(itemId, collected);
    if (!res.ok) return toast.error(errMsg(res.error));
    void load();
  };

  const closeCase = async (c: RequirementCase) => {
    const res = await window.alaqsa.requirements.saveCase({
      id: c.id, clientId, status: c.status === 'done' ? 'open' : 'done',
    });
    if (!res.ok) return toast.error(errMsg(res.error));
    void load();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = await window.alaqsa.requirements.removeCase(deleting.id);
    setDeleting(null);
    if (res.ok) { toast.success(t.msg.deleted); void load(); }
    else toast.error(errMsg(res.error));
  };

  if (loading) return <Loading />;

  return (
    <div className="col gap-12">
      <div className="row between wrap gap-10">
        <div>
          <h3 style={{ fontSize: 16 }}>{t.requirements.title}</h3>
          <p className="muted small">{t.requirements.subtitle}</p>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setStartOpen(true)}
          disabled={!templates.length}
          title={templates.length ? undefined : t.requirements.noTemplatesHint}
        >
          + {t.requirements.newCase}
        </button>
      </div>

      {!templates.length && (
        <div className="card">
          <div className="card-body small muted" style={{ padding: 14 }}>
            ℹ️ {t.requirements.noTemplatesHint}
          </div>
        </div>
      )}

      {cases.length === 0 ? (
        <EmptyState icon="📑" title={t.requirements.noCases} message={t.requirements.noCasesHint} />
      ) : (
        <div className="col gap-12">
          {cases.map((c) => {
            const done = c.items.filter((i) => i.collected).length;
            const required = c.items.filter((i) => i.required);
            const allRequiredDone = required.every((i) => i.collected);
            return (
              <div className="card" key={c.id}>
                <div className="card-head row between wrap gap-8">
                  <div className="row gap-8">
                    <Badge kind={c.status === 'done' ? 'success' : allRequiredDone ? 'info' : 'warning'}>
                      {(t.requirements.caseStatuses as Record<string, string>)[c.status] ?? c.status}
                    </Badge>
                    <span className="tiny muted">
                      {t.requirements.progress}: {done}/{c.items.length}
                    </span>
                    {c.totalCost != null && (
                      <span className="tiny muted">
                        {t.requirements.totalCost}: {c.totalCost.toLocaleString()}
                      </span>
                    )}
                    {c.dueDate && <span className="tiny muted">📅 {fmtDate(c.dueDate)}</span>}
                  </div>
                  <span className="card-title">{c.title}</span>
                </div>
                <div className="card-body col gap-6">
                  {c.items.map((it) => (
                    <div className="row gap-8" key={it.id}>
                      <Checkbox
                        checked={it.collected}
                        onChange={(v) => toggleItem(it.id, v)}
                        label={it.label}
                      />
                      {!it.required && <span className="tiny faint">({t.requirements.optional})</span>}
                      {it.cost != null && it.cost > 0 && (
                        <span className="tiny muted" style={{ marginInlineStart: 'auto' }}>
                          {it.cost.toLocaleString()}
                        </span>
                      )}
                    </div>
                  ))}
                  <div className="row gap-6 wrap" style={{ marginTop: 6 }}>
                    <button className="btn btn-outline btn-sm" onClick={() => closeCase(c)}>
                      {c.status === 'done' ? t.common.edit : `✓ ${t.requirements.markDone}`}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setDeleting(c)}>🗑</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={startOpen}
        title={t.requirements.newCase}
        onClose={() => setStartOpen(false)}
        size="sm"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setStartOpen(false)}>{t.common.cancel}</button>
            <button className="btn btn-primary" onClick={startCase} disabled={!pickedTemplate}>
              {t.common.save}
            </button>
          </>
        }
      >
        <Field label={t.requirements.pickTemplate} required>
          <Select
            value={pickedTemplate}
            onChange={setPickedTemplate}
            placeholder={t.requirements.pickTemplate}
            options={templates.map((x) => ({
              value: x.id,
              label: x.estimatedCost
                ? `${x.nameAr} — ${x.estimatedCost.toLocaleString()}`
                : x.nameAr,
            }))}
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title={t.msg.confirmDelete}
        message={deleting?.title ?? ''}
        danger
        confirmLabel={t.common.delete}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The template editor lives in Settings: templates are shop-wide, not per
// client, and are set up once rather than during a job.
// ---------------------------------------------------------------------------
export function RequirementTemplatesTab() {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [rows, setRows] = useState<RequirementTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RequirementTemplate | null>(null);
  const [deleting, setDeleting] = useState<RequirementTemplate | null>(null);

  const load = useCallback(async () => {
    const res = await window.alaqsa.requirements.listTemplates(true);
    if (res.ok) setRows(res.data);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = await window.alaqsa.requirements.removeTemplate(deleting.id);
    setDeleting(null);
    if (res.ok) { toast.success(t.msg.deleted); void load(); }
    else toast.error(errMsg(res.error));
  };

  /** Two checklists the shop actually uses, so the feature is usable at once. */
  const seedDefaults = async () => {
    const presets: Partial<RequirementTemplate>[] = [
      {
        nameAr: 'تجديد رخصة الكاميرات',
        nameEn: 'Camera licence renewal',
        estimatedCost: 0,
        items: [
          { label: 'الرخصة القديمة', required: true, sort: 0 },
          { label: 'صور شاشة تعرض تسجيل الكاميرات', required: true, sort: 1 },
          { label: 'صورة الهوية / الرخصة التجارية', required: true, sort: 2 },
          { label: 'رسوم التجديد', required: true, sort: 3 },
        ] as RequirementItem[],
      },
      {
        nameAr: 'شهادة كاميرات جديدة',
        nameEn: 'New camera certificate',
        estimatedCost: 0,
        items: [
          { label: 'الرخصة التجارية', required: true, sort: 0 },
          { label: 'جواز السفر / الهوية', required: true, sort: 1 },
          { label: 'مخطط المبنى', required: true, sort: 2 },
          { label: 'صور المبنى من الخارج', required: true, sort: 3 },
          { label: 'التعهد', required: true, sort: 4 },
          { label: 'رسوم الإصدار', required: true, sort: 5 },
        ] as RequirementItem[],
      },
    ];
    for (const p of presets) {
      const res = await window.alaqsa.requirements.saveTemplate(p);
      if (!res.ok) return toast.error(errMsg(res.error));
    }
    toast.success(t.msg.created);
    void load();
  };

  if (loading) return <Loading />;

  return (
    <div className="col gap-12">
      <div className="row between wrap gap-10">
        <span className="muted small">{t.requirements.subtitle}</span>
        <div className="row gap-8">
          {!rows.length && (
            <button className="btn btn-outline btn-sm" onClick={seedDefaults}>
              ✨ {t.requirements.seedDefaults}
            </button>
          )}
          <button className="btn btn-primary btn-sm"
            onClick={() => { setEditing(null); setFormOpen(true); }}>
            + {t.requirements.newTemplate}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="📋" title={t.requirements.noTemplates}
          message={t.requirements.noTemplatesHint} />
      ) : (
        <div className="col gap-8">
          {rows.map((tp) => (
            <div className="card" key={tp.id}>
              <div className="card-body row between wrap gap-8" style={{ padding: 14 }}>
                <div className="row gap-8">
                  <button className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => { setEditing(tp); setFormOpen(true); }}>✏️</button>
                  <button className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => setDeleting(tp)}>🗑</button>
                </div>
                <div className="col" style={{ textAlign: 'start' }}>
                  <span className="bold">{tp.nameAr}</span>
                  <span className="tiny muted">
                    {tp.items.length} {t.requirements.items}
                    {tp.estimatedCost ? ` · ${tp.estimatedCost.toLocaleString()} ${tp.currency}` : ''}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <TemplateFormModal
        open={formOpen}
        template={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); void load(); }}
      />

      <ConfirmDialog
        open={!!deleting}
        title={t.msg.confirmDelete}
        message={deleting?.nameAr ?? ''}
        danger
        confirmLabel={t.common.delete}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function TemplateFormModal({
  open, template, onClose, onSaved,
}: {
  open: boolean;
  template: RequirementTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [nameAr, setNameAr] = useState('');
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [items, setItems] = useState<RequirementItem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNameAr(template?.nameAr ?? '');
    setDescription(template?.description ?? '');
    setCost(template?.estimatedCost != null ? String(template.estimatedCost) : '');
    setItems(template?.items ?? [
      { id: `n${Date.now()}`, label: '', required: true, sort: 0 } as RequirementItem,
    ]);
  }, [open, template]);

  const setItem = (i: number, patch: Partial<RequirementItem>) => {
    setItems((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };

  const save = async () => {
    if (!nameAr.trim()) return toast.error(t.validation.required);
    const clean = items.filter((i) => i.label.trim());
    setBusy(true);
    const res = await window.alaqsa.requirements.saveTemplate({
      id: template?.id,
      nameAr: nameAr.trim(),
      description: description.trim() || undefined,
      estimatedCost: cost ? Number(cost) : undefined,
      items: clean.map((i, idx) => ({ ...i, sort: idx })),
    });
    setBusy(false);
    if (!res.ok) return toast.error(errMsg(res.error));
    toast.success(template ? t.msg.updated : t.msg.created);
    onSaved();
  };

  return (
    <Modal
      open={open}
      title={template ? t.requirements.editTemplate : t.requirements.newTemplate}
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
        <Field label={t.requirements.templateName} required hint={t.requirements.templateNameHint}>
          <TextInput value={nameAr} onChange={setNameAr} autoFocus />
        </Field>
        <Field label={t.requirements.description}>
          <TextArea value={description} onChange={setDescription} rows={2} />
        </Field>
        <Field label={t.requirements.estimatedCost}>
          <TextInput value={cost} onChange={setCost} type="number" min={0} dir="ltr" />
        </Field>

        <div className="row between">
          <span className="bold small">{t.requirements.items}</span>
          <button className="btn btn-outline btn-sm" onClick={() =>
            setItems((p) => [...p, {
              id: `n${Date.now()}`, label: '', required: true, sort: p.length,
            } as RequirementItem])}>
            + {t.requirements.addItem}
          </button>
        </div>

        <div className="col gap-8">
          {items.map((it, i) => (
            <div className="row gap-8 wrap" key={it.id}>
              <div style={{ flex: '3 1 200px' }}>
                <TextInput value={it.label} placeholder={t.requirements.itemLabel}
                  onChange={(v) => setItem(i, { label: v })} />
              </div>
              <div style={{ flex: '0 0 110px' }}>
                <TextInput value={it.cost != null ? String(it.cost) : ''} type="number" min={0}
                  dir="ltr" placeholder={t.requirements.itemCost}
                  onChange={(v) => setItem(i, { cost: v ? Number(v) : undefined })} />
              </div>
              <Checkbox
                checked={it.required}
                onChange={(v) => setItem(i, { required: v })}
                label={t.requirements.itemRequired}
              />
              <button className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setItems((p) => p.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
