// ============================================================================
// AlAqsa — Invoices and AMC (annual maintenance contract) tracking.
// Overdue invoices are what auto-flag a client red for the team.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import {
  Modal, Field, TextInput, TextArea, EmptyState, Badge, Checkbox,
  ConfirmDialog, useToast, useErrorMessage, Loading, fmtDate, daysUntil,
} from './ui';
import { isDateOrderValid, isPositiveNumber, todayISO } from '../utils/validation';
import type { Invoice, AmcContract, InvoiceItem } from '@shared/types';

export function FinancePanel({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [contracts, setContracts] = useState<AmcContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [invForm, setInvForm] = useState<{ open: boolean; item: Invoice | null }>({ open: false, item: null });
  const [amcForm, setAmcForm] = useState<{ open: boolean; item: AmcContract | null }>({ open: false, item: null });
  const [deleting, setDeleting] = useState<{ kind: 'invoice' | 'amc'; id: string } | null>(null);

  const load = useCallback(async () => {
    const [inv, amc] = await Promise.all([
      window.alaqsa.invoices.listByClient(clientId),
      window.alaqsa.amc.listByClient(clientId),
    ]);
    if (inv.ok) setInvoices(inv.data);
    if (amc.ok) setContracts(amc.data);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  /** Generate the invoice/contract PDF and hand it to the printer. */
  const printInvoice = async (invoiceId: string) => {
    const res = await window.alaqsa.reports.invoicePdf(invoiceId);
    if (!res.ok) return toast.error(errMsg(res.error));
    toast.success(t.reports.generated);
    await window.alaqsa.reports.print(res.data.path);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = deleting.kind === 'invoice'
      ? await window.alaqsa.invoices.remove(deleting.id)
      : await window.alaqsa.amc.remove(deleting.id);
    setDeleting(null);
    if (res.ok) { toast.success(t.msg.deleted); void load(); }
    else toast.error(errMsg(res.error));
  };

  const statusBadge = (v: Invoice) => {
    if (v.status === 'paid') return <Badge kind="success">{t.finance.paid}</Badge>;
    const overdue = v.dueDate && (daysUntil(v.dueDate) ?? 0) < 0;
    if (overdue) return <Badge kind="danger">⚠ {t.reminders.overdue}</Badge>;
    return <Badge kind="warning">{v.status === 'partial' ? t.finance.partial : t.finance.unpaid}</Badge>;
  };

  const totals = invoices.reduce(
    (acc, v) => ({ total: acc.total + v.total, paid: acc.paid + v.paid }),
    { total: 0, paid: 0 },
  );

  if (loading) return <Loading />;

  return (
    <div className="col gap-20">
      {/* Summary */}
      {invoices.length > 0 && (
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">{t.finance.totalAmount}</div>
            <div className="stat-value">{totals.total.toLocaleString()}</div>
            <div className="stat-sub">{t.finance.currency}</div>
          </div>
          <div className="stat accent-success">
            <div className="stat-label">{t.finance.paidAmount}</div>
            <div className="stat-value">{totals.paid.toLocaleString()}</div>
            <div className="stat-sub">{t.finance.currency}</div>
          </div>
          <div className={`stat ${totals.total - totals.paid > 0 ? 'accent-danger' : ''}`}>
            <div className="stat-label">{t.finance.remaining}</div>
            <div className="stat-value">{(totals.total - totals.paid).toLocaleString()}</div>
            <div className="stat-sub">{t.finance.currency}</div>
          </div>
        </div>
      )}

      {/* Invoices */}
      <div className="col gap-10">
        <div className="row between">
          <span className="bold">💰 {t.finance.invoices}</span>
          <button className="btn btn-primary btn-sm"
            onClick={() => setInvForm({ open: true, item: null })}>+ {t.finance.newInvoice}</button>
        </div>
        {invoices.length === 0 ? (
          <EmptyState icon="🧾" title={t.common.noData} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.finance.invoiceNumber}</th>
                  <th>{t.common.date}</th>
                  <th>{t.finance.dueDate}</th>
                  <th>{t.finance.totalAmount}</th>
                  <th>{t.finance.paidAmount}</th>
                  <th>{t.finance.remaining}</th>
                  <th>{t.common.status}</th>
                  <th style={{ width: 80 }} />
                </tr>
              </thead>
              <tbody>
                {invoices.map((v) => (
                  <tr key={v.id}>
                    <td className="mono small" dir="ltr">{v.number}</td>
                    <td className="small">{fmtDate(v.date)}</td>
                    <td className="small">{fmtDate(v.dueDate)}</td>
                    <td className="small bold">{v.total.toLocaleString()}</td>
                    <td className="small">{v.paid.toLocaleString()}</td>
                    <td className="small bold" style={{ color: v.total - v.paid > 0 ? 'var(--danger)' : undefined }}>
                      {(v.total - v.paid).toLocaleString()}
                    </td>
                    <td>{statusBadge(v)}</td>
                    <td>
                      <div className="cell-actions">
                        <button className="btn btn-outline btn-sm" title={t.finance.printInvoice}
                          onClick={() => printInvoice(v.id)}>🖨</button>
                        <button className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => setInvForm({ open: true, item: v })}>✏️</button>
                        <button className="btn btn-danger btn-icon btn-sm"
                          onClick={() => setDeleting({ kind: 'invoice', id: v.id })}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* AMC contracts */}
      <div className="col gap-10">
        <div className="row between">
          <span className="bold">📑 {t.finance.amc}</span>
          <button className="btn btn-primary btn-sm"
            onClick={() => setAmcForm({ open: true, item: null })}>+ {t.finance.newAmc}</button>
        </div>
        {contracts.length === 0 ? (
          <EmptyState icon="📑" title={t.common.noData} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: 12 }}>
            {contracts.map((c) => {
              const remaining = c.totalVisits - c.usedVisits;
              const days = daysUntil(c.endDate);
              return (
                <div key={c.id} className="card">
                  <div className="card-body col gap-8" style={{ padding: 15 }}>
                    <div className="row between">
                      <span className="small bold">{fmtDate(c.startDate)} → {fmtDate(c.endDate)}</span>
                      <div className="row gap-4">
                        <button className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => setAmcForm({ open: true, item: c })}>✏️</button>
                        <button className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => setDeleting({ kind: 'amc', id: c.id })}>🗑</button>
                      </div>
                    </div>
                    <div className="row between small">
                      <span className="muted">{t.finance.remainingVisits}</span>
                      {c.unlimitedVisits ? (
                        <Badge kind="info">∞ {t.finance.unlimited} · {c.usedVisits}</Badge>
                      ) : (
                        <Badge kind={remaining > 0 ? 'success' : 'warning'}>
                          {remaining} / {c.totalVisits}
                        </Badge>
                      )}
                    </div>
                    {/* Exceeding the agreed count is allowed but flagged, since
                        refusing to record real work would be worse. */}
                    {!c.unlimitedVisits && remaining < 0 && (
                      <Badge kind="warning">⚠ {t.finance.overUsed} ({Math.abs(remaining)})</Badge>
                    )}
                    {c.amount != null && (
                      <div className="row between small">
                        <span className="muted">{t.finance.amount}</span>
                        <span className="bold">{c.amount.toLocaleString()} {t.finance.currency}</span>
                      </div>
                    )}
                    {days !== null && days < 30 && (
                      <Badge kind={days < 0 ? 'danger' : 'warning'}>
                        {days < 0 ? t.licenses.expired : `${days} ${t.common.days}`}
                      </Badge>
                    )}
                    {c.notes && <div className="tiny muted">{c.notes}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <InvoiceFormModal
        open={invForm.open}
        clientId={clientId}
        invoice={invForm.item}
        onClose={() => setInvForm({ open: false, item: null })}
        onSaved={() => { setInvForm({ open: false, item: null }); void load(); }}
      />

      <AmcFormModal
        open={amcForm.open}
        clientId={clientId}
        contract={amcForm.item}
        onClose={() => setAmcForm({ open: false, item: null })}
        onSaved={() => { setAmcForm({ open: false, item: null }); void load(); }}
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

function InvoiceFormModal({
  open, clientId, invoice, onClose, onSaved,
}: {
  open: boolean;
  clientId: string;
  invoice: Invoice | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [number, setNumber] = useState('');
  const [date, setDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState('');
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [taxRate, setTaxRate] = useState('5');
  const [trn, setTrn] = useState('');
  const [terms, setTerms] = useState('');
  const [paid, setPaid] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNumber(invoice?.number ?? `INV-${new Date().getFullYear()}-`);
    setDate(invoice?.date ?? todayISO());
    setDueDate(invoice?.dueDate ?? '');
    setItems(invoice?.items?.length
      ? invoice.items
      : [{ id: `i${Date.now()}`, description: '', quantity: 1, unitPrice: 0 }]);
    setTaxRate(invoice ? String(invoice.taxRate ?? 0) : '5');
    setTrn(invoice?.trn ?? '');
    setTerms(invoice?.terms ?? '');
    setPaid(invoice?.paid?.toString() ?? '0');
    setNotes(invoice?.notes ?? '');
    setErrors({});
  }, [open, invoice]);

  // Totals are computed live so what the user sees matches the printed PDF.
  const subtotal = items.reduce(
    (s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0,
  );
  const taxAmount = Math.round(subtotal * ((Number(taxRate) || 0) / 100) * 100) / 100;
  const grandTotal = Math.round((subtotal + taxAmount) * 100) / 100;

  const setItem = (i: number, patch: Partial<InvoiceItem>) => {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (!number.trim()) e.number = t.validation.required;
    if (!isPositiveNumber(paid)) e.paid = t.validation.positiveNumber;
    if (Number(paid) > grandTotal) e.paid = t.validation.invalidNumber;
    if (!isDateOrderValid(date, dueDate)) e.dueDate = t.validation.dateOrder;
    if (!items.some((i) => i.description.trim())) e.items = t.validation.required;
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    const res = await window.alaqsa.invoices.save({
      id: invoice?.id, clientId,
      number: number.trim(), date,
      dueDate: dueDate || undefined,
      items: items.filter((i) => i.description.trim()),
      taxRate: Number(taxRate) || 0,
      trn: trn.trim() || undefined,
      terms: terms.trim() || undefined,
      paid: Number(paid) || 0,
      notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) return toast.error(errMsg(res.error));
    toast.success(invoice ? t.msg.updated : t.msg.created);
    onSaved();
  };

  return (
    <Modal
      open={open}
      title={invoice ? t.common.edit : t.finance.newInvoice}
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
      <div className="col gap-16">
        <div className="form-grid">
          <Field label={t.finance.invoiceNumber} required error={errors.number}>
            <TextInput value={number} onChange={setNumber} error={!!errors.number} dir="ltr" />
          </Field>
          <Field label={t.common.date} required>
            <TextInput value={date} onChange={setDate} type="date" />
          </Field>
          <Field label={t.finance.dueDate} error={errors.dueDate}>
            <TextInput value={dueDate} onChange={setDueDate} type="date" error={!!errors.dueDate} />
          </Field>
          <Field label={t.finance.trn} hint="TRN">
            <TextInput value={trn} onChange={setTrn} dir="ltr" />
          </Field>
        </div>

        {/* Line items */}
        <div>
          <div className="row between mb-8">
            <span className="bold small">{t.finance.items}</span>
            <button className="btn btn-outline btn-sm" onClick={() => setItems((p) => [
              ...p, { id: `i${Date.now()}`, description: '', quantity: 1, unitPrice: 0 },
            ])}>+ {t.finance.addItem}</button>
          </div>
          {errors.items && <div className="field-error mb-8">⚠ {errors.items}</div>}
          <div className="col gap-8">
            {items.map((it, i) => (
              <div key={it.id} className="row gap-6 wrap" style={{ alignItems: 'flex-end' }}>
                <div style={{ flex: '3 1 200px' }}>
                  <TextInput value={it.description}
                    onChange={(v) => setItem(i, { description: v })}
                    placeholder={t.finance.itemDescription} />
                </div>
                <div style={{ flex: '0 1 80px' }}>
                  <TextInput value={String(it.quantity)} type="number" min={0} dir="ltr"
                    onChange={(v) => setItem(i, { quantity: Number(v) || 0 })}
                    placeholder={t.finance.itemQty} />
                </div>
                <div style={{ flex: '1 1 110px' }}>
                  <TextInput value={String(it.unitPrice)} type="number" min={0} step="0.01" dir="ltr"
                    onChange={(v) => setItem(i, { unitPrice: Number(v) || 0 })}
                    placeholder={t.finance.itemPrice} />
                </div>
                <div className="small bold" style={{ minWidth: 78, textAlign: 'end' }}>
                  {((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)).toFixed(2)}
                </div>
                {items.length > 1 && (
                  <button className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => setItems((p) => p.filter((_, j) => j !== i))}>✕</button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Totals */}
        <div style={{
          padding: 13, background: 'var(--surface-2)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        }}>
          <div className="row between small mb-8">
            <span className="muted">{t.finance.subtotal}</span>
            <span className="bold mono">{subtotal.toFixed(2)}</span>
          </div>
          <div className="row between small mb-8" style={{ alignItems: 'center' }}>
            <span className="muted">{t.finance.taxRate}</span>
            <div className="row gap-8">
              <input className="input" style={{ width: 74, minHeight: 30 }} type="number"
                min={0} max={100} step="0.5" dir="ltr" value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)} />
              <span className="bold mono" style={{ minWidth: 70, textAlign: 'end' }}>
                {taxAmount.toFixed(2)}
              </span>
            </div>
          </div>
          <div className="row between mb-8" style={{
            paddingTop: 8, borderTop: '1px solid var(--border)',
          }}>
            <span className="bold">{t.common.total}</span>
            <span className="bold mono" style={{ fontSize: 16, color: 'var(--primary-700)' }}>
              {grandTotal.toFixed(2)} {t.finance.currency}
            </span>
          </div>
          <Field label={`${t.finance.paidAmount} (${t.finance.currency})`} error={errors.paid}>
            <TextInput value={paid} onChange={setPaid} type="number" min={0} step="0.01"
              error={!!errors.paid} dir="ltr" />
          </Field>
        </div>

        <Field label={t.finance.terms}>
          <TextArea value={terms} onChange={setTerms} rows={2} />
        </Field>
        <Field label={t.common.notes}>
          <TextArea value={notes} onChange={setNotes} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

function AmcFormModal({
  open, clientId, contract, onClose, onSaved,
}: {
  open: boolean;
  clientId: string;
  contract: AmcContract | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState('');
  const [totalVisits, setTotalVisits] = useState('4');
  const [unlimited, setUnlimited] = useState(false);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStartDate(contract?.startDate ?? todayISO());
    setEndDate(contract?.endDate ?? '');
    setTotalVisits(contract?.totalVisits?.toString() ?? '4');
    setUnlimited(contract?.unlimitedVisits ?? false);
    setAmount(contract?.amount?.toString() ?? '');
    setNotes(contract?.notes ?? '');
    setErrors({});
  }, [open, contract]);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!endDate) e.endDate = t.validation.required;
    if (!isDateOrderValid(startDate, endDate)) e.endDate = t.validation.dateOrder;
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    // usedVisits is derived from linked visits, so it is not sent here.
    const res = await window.alaqsa.amc.save({
      id: contract?.id, clientId,
      startDate, endDate,
      totalVisits: unlimited ? 0 : (Number(totalVisits) || 0),
      unlimitedVisits: unlimited,
      amount: amount ? Number(amount) : undefined,
      notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) return toast.error(errMsg(res.error));
    toast.success(contract ? t.msg.updated : t.msg.created);
    onSaved();
  };

  return (
    <Modal
      open={open}
      title={contract ? t.common.edit : t.finance.newAmc}
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
        <Field label={t.finance.startDate} required>
          <TextInput value={startDate} onChange={setStartDate} type="date" />
        </Field>
        <Field label={t.finance.endDate} required error={errors.endDate}>
          <TextInput value={endDate} onChange={setEndDate} type="date" error={!!errors.endDate} />
        </Field>
        <div className="span-all">
          <Checkbox checked={unlimited} onChange={setUnlimited} label={t.finance.unlimitedVisits} />
          <div className="field-hint">{t.finance.unlimitedHint}</div>
        </div>
        {!unlimited && (
          <Field label={t.finance.totalVisits}>
            <TextInput value={totalVisits} onChange={setTotalVisits} type="number" min={0} dir="ltr" />
          </Field>
        )}
        {contract && (
          <Field label={t.finance.usedVisits}>
            <div className="row gap-8" style={{ paddingTop: 8 }}>
              <Badge kind="info">{contract.usedVisits}</Badge>
              <span className="tiny muted">{t.visits.countsHint}</span>
            </div>
          </Field>
        )}
        <Field label={`${t.finance.amount} (${t.finance.currency})`}>
          <TextInput value={amount} onChange={setAmount} type="number" min={0} step="0.01" dir="ltr" />
        </Field>
        <Field label={t.common.notes} className="span-all">
          <TextArea value={notes} onChange={setNotes} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
