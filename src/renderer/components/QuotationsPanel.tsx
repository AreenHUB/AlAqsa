// ============================================================================
// AlAqsa — Price quotations for one client.
//
// The step the shop was missing: an offer goes out, the client accepts, and
// the same lines become an invoice without being retyped.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import {
  Modal, Field, TextInput, TextArea, Loading, EmptyState, Badge,
  ConfirmDialog, useToast, useErrorMessage, fmtDate,
} from './ui';
import type { Quotation, QuotationItem, Contact } from '@shared/types';

const STATUS_KIND: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  draft: 'neutral', sent: 'info', accepted: 'success',
  rejected: 'danger', expired: 'warning',
};

export function QuotationsPanel({
  clientId, clientName, contacts,
}: {
  clientId: string;
  clientName: string;
  contacts: Contact[];
}) {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [rows, setRows] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [deleting, setDeleting] = useState<Quotation | null>(null);
  const [converting, setConverting] = useState<Quotation | null>(null);

  const load = useCallback(async () => {
    const res = await window.alaqsa.quotations.listByClient(clientId);
    if (res.ok) setRows(res.data);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const setStatus = async (q: Quotation, status: string) => {
    const res = await window.alaqsa.quotations.setStatus(q.id, status);
    if (!res.ok) return toast.error(errMsg(res.error));
    void load();
  };

  const exportPdf = async (q: Quotation) => {
    const res = await window.alaqsa.quotations.pdf(q.id);
    if (!res.ok) return toast.error(errMsg(res.error));
    toast.success(t.reports.generated);
  };

  const doConvert = async () => {
    if (!converting) return;
    const res = await window.alaqsa.quotations.convertToInvoice(converting.id);
    setConverting(null);
    if (!res.ok) return toast.error(errMsg(res.error));
    toast.success(t.quotations.converted);
    void load();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = await window.alaqsa.quotations.remove(deleting.id);
    setDeleting(null);
    if (res.ok) { toast.success(t.msg.deleted); void load(); }
    else toast.error(errMsg(res.error));
  };

  if (loading) return <Loading />;

  return (
    <div className="col gap-12">
      <div className="row between wrap gap-10">
        <div>
          <h3 style={{ fontSize: 16 }}>{t.quotations.title}</h3>
          <p className="muted small">{t.quotations.subtitle}</p>
        </div>
        <button className="btn btn-primary btn-sm"
          onClick={() => { setEditing(null); setFormOpen(true); }}>
          + {t.quotations.newQuote}
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="📝" title={t.quotations.noQuotes} message={t.quotations.noQuotesHint} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.quotations.number}</th>
                <th>{t.common.date}</th>
                <th>{t.quotations.validUntil}</th>
                <th>{t.quotations.total}</th>
                <th>{t.common.status}</th>
                <th style={{ width: 180 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id}>
                  <td className="small bold mono" dir="ltr">{q.number}</td>
                  <td className="small">{fmtDate(q.date)}</td>
                  <td className="small">{q.validUntil ? fmtDate(q.validUntil) : '—'}</td>
                  <td className="small bold">{q.total.toLocaleString()}</td>
                  <td>
                    <Badge kind={STATUS_KIND[q.status] ?? 'neutral'}>
                      {(t.quotations.statuses as Record<string, string>)[q.status] ?? q.status}
                    </Badge>
                    {q.invoiceId && <span className="tiny faint"> · 🧾</span>}
                  </td>
                  <td>
                    <div className="cell-actions">
                      <button className="btn btn-ghost btn-icon btn-sm" title={t.common.edit}
                        onClick={() => { setEditing(q); setFormOpen(true); }}>✏️</button>
                      <button className="btn btn-ghost btn-icon btn-sm" title={t.quotations.exportPdf}
                        onClick={() => exportPdf(q)}>📄</button>
                      {q.status === 'draft' && (
                        <button className="btn btn-ghost btn-icon btn-sm" title={t.quotations.markSent}
                          onClick={() => setStatus(q, 'sent')}>📤</button>
                      )}
                      {/* Converting is the whole point of quotations, so it is
                          offered until it has actually been done. */}
                      {!q.invoiceId && (
                        <button className="btn btn-ghost btn-icon btn-sm" title={t.quotations.convert}
                          onClick={() => setConverting(q)}>🧾</button>
                      )}
                      <button className="btn btn-ghost btn-icon btn-sm" title={t.common.delete}
                        onClick={() => setDeleting(q)}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QuotationFormModal
        open={formOpen}
        quotation={editing}
        clientId={clientId}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); void load(); }}
      />

      <ConfirmDialog
        open={!!converting}
        title={t.quotations.convert}
        message={t.quotations.convertConfirm}
        confirmLabel={t.quotations.convert}
        onConfirm={doConvert}
        onCancel={() => setConverting(null)}
      />

      <ConfirmDialog
        open={!!deleting}
        title={t.msg.confirmDelete}
        message={deleting?.number ?? ''}
        danger
        confirmLabel={t.common.delete}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
function QuotationFormModal({
  open, quotation, clientId, onClose, onSaved,
}: {
  open: boolean;
  quotation: Quotation | null;
  clientId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [number, setNumber] = useState('');
  const [date, setDate] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [items, setItems] = useState<QuotationItem[]>([]);
  const [taxRate, setTaxRate] = useState('0');
  const [discount, setDiscount] = useState('0');
  const [trn, setTrn] = useState('');
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const today = new Date().toISOString().slice(0, 10);
    if (quotation) {
      setNumber(quotation.number);
      setDate(quotation.date);
      setValidUntil(quotation.validUntil ?? '');
      setItems(quotation.items);
      setTaxRate(String(quotation.taxRate));
      setDiscount(String(quotation.discount));
      setTrn(quotation.trn ?? '');
      setTerms(quotation.terms ?? '');
      setNotes(quotation.notes ?? '');
    } else {
      void window.alaqsa.quotations.nextNumber().then((r) => { if (r.ok) setNumber(r.data); });
      setDate(today);
      // A month is the usual validity; the owner can change it.
      const d = new Date(); d.setMonth(d.getMonth() + 1);
      setValidUntil(d.toISOString().slice(0, 10));
      setItems([{ id: `i${Date.now()}`, description: '', quantity: 1, unitPrice: 0 }]);
      setTaxRate('5');
      setDiscount('0');
      setTrn(''); setTerms(''); setNotes('');
    }
  }, [open, quotation]);

  // Shown live so the owner sees the effect of a discount before saving. The
  // authoritative figures are recomputed in the main process on save.
  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
  const afterDiscount = Math.max(0, subtotal - (Number(discount) || 0));
  const tax = Math.round(afterDiscount * ((Number(taxRate) || 0) / 100) * 100) / 100;
  const total = afterDiscount + tax;

  const setItem = (i: number, patch: Partial<QuotationItem>) => {
    setItems((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };

  const save = async () => {
    const clean = items.filter((i) => i.description.trim());
    if (!clean.length) return toast.error(t.validation.required);
    setBusy(true);
    const res = await window.alaqsa.quotations.save({
      id: quotation?.id,
      clientId,
      number,
      date,
      validUntil: validUntil || undefined,
      items: clean,
      taxRate: Number(taxRate) || 0,
      discount: Number(discount) || 0,
      trn: trn.trim() || undefined,
      terms: terms.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) return toast.error(errMsg(res.error));
    toast.success(quotation ? t.msg.updated : t.msg.created);
    onSaved();
  };

  return (
    <Modal
      open={open}
      title={quotation ? t.quotations.editQuote : t.quotations.newQuote}
      onClose={onClose}
      size="lg"
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
        <div className="form-grid">
          <Field label={t.quotations.number}>
            <TextInput value={number} onChange={setNumber} dir="ltr" />
          </Field>
          <Field label={t.quotations.date}>
            <TextInput value={date} onChange={setDate} type="date" dir="ltr" />
          </Field>
          <Field label={t.quotations.validUntil}>
            <TextInput value={validUntil} onChange={setValidUntil} type="date" dir="ltr" />
          </Field>
        </div>

        <div className="row between">
          <span className="bold small">{t.quotations.items}</span>
          <button className="btn btn-outline btn-sm" onClick={() =>
            setItems((p) => [...p, { id: `i${Date.now()}`, description: '', quantity: 1, unitPrice: 0 }])}>
            + {t.quotations.addItem}
          </button>
        </div>

        <div className="col gap-8">
          {items.map((it, i) => (
            <div className="row gap-8 wrap" key={it.id}>
              <div style={{ flex: '3 1 220px' }}>
                <TextInput value={it.description} placeholder={t.quotations.description}
                  onChange={(v) => setItem(i, { description: v })} />
              </div>
              <div style={{ flex: '0 0 80px' }}>
                <TextInput value={String(it.quantity)} type="number" min={0} dir="ltr"
                  placeholder={t.quotations.quantity}
                  onChange={(v) => setItem(i, { quantity: Number(v) || 0 })} />
              </div>
              <div style={{ flex: '0 0 110px' }}>
                <TextInput value={String(it.unitPrice)} type="number" min={0} step="0.01" dir="ltr"
                  placeholder={t.quotations.unitPrice}
                  onChange={(v) => setItem(i, { unitPrice: Number(v) || 0 })} />
              </div>
              <div className="small bold" style={{ flex: '0 0 90px', paddingTop: 9 }}>
                {((it.quantity || 0) * (it.unitPrice || 0)).toLocaleString()}
              </div>
              <button className="btn btn-ghost btn-icon btn-sm"
                onClick={() => setItems((p) => p.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>

        <div className="form-grid">
          <Field label={t.quotations.discount}>
            <TextInput value={discount} onChange={setDiscount} type="number" min={0} dir="ltr" />
          </Field>
          <Field label={t.quotations.taxRate}>
            <TextInput value={taxRate} onChange={setTaxRate} type="number" min={0} dir="ltr" />
          </Field>
          <Field label={t.quotations.trn}>
            <TextInput value={trn} onChange={setTrn} dir="ltr" />
          </Field>
        </div>

        <div className="card">
          <div className="card-body col gap-4" style={{ padding: 12 }}>
            <div className="row between small"><span>{t.quotations.subtotal}</span><span>{subtotal.toLocaleString()}</span></div>
            {Number(discount) > 0 && (
              <div className="row between small"><span>{t.quotations.discount}</span><span>- {Number(discount).toLocaleString()}</span></div>
            )}
            {Number(taxRate) > 0 && (
              <div className="row between small"><span>{t.quotations.taxAmount}</span><span>{tax.toLocaleString()}</span></div>
            )}
            <div className="row between bold"><span>{t.quotations.total}</span><span>{total.toLocaleString()}</span></div>
          </div>
        </div>

        <Field label={t.quotations.terms}>
          <TextArea value={terms} onChange={setTerms} rows={2} />
        </Field>
        <Field label={t.common.notes}>
          <TextArea value={notes} onChange={setNotes} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
