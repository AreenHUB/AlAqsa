// ============================================================================
// AlAqsa — Invoices and AMC (annual maintenance contract) tracking.
// Overdue invoices are what auto-flag a client red for the team.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import {
  Modal, Field, TextInput, TextArea, EmptyState, Badge,
  ConfirmDialog, useToast, Loading, fmtDate, daysUntil,
} from './ui';
import { isDateOrderValid, isPositiveNumber, todayISO } from '../utils/validation';
import type { Invoice, AmcContract } from '@shared/types';

export function FinancePanel({ clientId }: { clientId: string }) {
  const { t } = useI18n();
  const toast = useToast();

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

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = deleting.kind === 'invoice'
      ? await window.alaqsa.invoices.remove(deleting.id)
      : await window.alaqsa.amc.remove(deleting.id);
    setDeleting(null);
    if (res.ok) { toast.success(t.msg.deleted); void load(); }
    else toast.error(res.error);
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
                        <button className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => setInvForm({ open: true, item: v })}>✏️</button>
                        <button className="btn btn-ghost btn-icon btn-sm"
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
                      <Badge kind={remaining > 0 ? 'success' : 'danger'}>
                        {remaining} / {c.totalVisits}
                      </Badge>
                    </div>
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

  const [number, setNumber] = useState('');
  const [date, setDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState('');
  const [total, setTotal] = useState('');
  const [paid, setPaid] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNumber(invoice?.number ?? `INV-${new Date().getFullYear()}-`);
    setDate(invoice?.date ?? todayISO());
    setDueDate(invoice?.dueDate ?? '');
    setTotal(invoice?.total?.toString() ?? '');
    setPaid(invoice?.paid?.toString() ?? '0');
    setNotes(invoice?.notes ?? '');
    setErrors({});
  }, [open, invoice]);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!number.trim()) e.number = t.validation.required;
    if (!isPositiveNumber(total)) e.total = t.validation.positiveNumber;
    if (!isPositiveNumber(paid)) e.paid = t.validation.positiveNumber;
    if (Number(paid) > Number(total)) e.paid = t.validation.invalidNumber;
    if (!isDateOrderValid(date, dueDate)) e.dueDate = t.validation.dateOrder;
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    const res = await window.alaqsa.invoices.save({
      id: invoice?.id, clientId,
      number: number.trim(), date,
      dueDate: dueDate || undefined,
      total: Number(total), paid: Number(paid) || 0,
      notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
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
        <Field label={`${t.finance.totalAmount} (${t.finance.currency})`} required error={errors.total}>
          <TextInput value={total} onChange={setTotal} type="number" min={0} step="0.01"
            error={!!errors.total} dir="ltr" />
        </Field>
        <Field label={`${t.finance.paidAmount} (${t.finance.currency})`} error={errors.paid}>
          <TextInput value={paid} onChange={setPaid} type="number" min={0} step="0.01"
            error={!!errors.paid} dir="ltr" />
        </Field>
        <Field label={t.common.notes} className="span-all">
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

  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState('');
  const [totalVisits, setTotalVisits] = useState('4');
  const [usedVisits, setUsedVisits] = useState('0');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStartDate(contract?.startDate ?? todayISO());
    setEndDate(contract?.endDate ?? '');
    setTotalVisits(contract?.totalVisits?.toString() ?? '4');
    setUsedVisits(contract?.usedVisits?.toString() ?? '0');
    setAmount(contract?.amount?.toString() ?? '');
    setNotes(contract?.notes ?? '');
    setErrors({});
  }, [open, contract]);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!endDate) e.endDate = t.validation.required;
    if (!isDateOrderValid(startDate, endDate)) e.endDate = t.validation.dateOrder;
    if (Number(usedVisits) > Number(totalVisits)) e.usedVisits = t.validation.invalidNumber;
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    const res = await window.alaqsa.amc.save({
      id: contract?.id, clientId,
      startDate, endDate,
      totalVisits: Number(totalVisits) || 0,
      usedVisits: Number(usedVisits) || 0,
      amount: amount ? Number(amount) : undefined,
      notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
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
        <Field label={t.finance.totalVisits}>
          <TextInput value={totalVisits} onChange={setTotalVisits} type="number" min={0} dir="ltr" />
        </Field>
        <Field label={t.finance.usedVisits} error={errors.usedVisits}>
          <TextInput value={usedVisits} onChange={setUsedVisits} type="number" min={0}
            error={!!errors.usedVisits} dir="ltr" />
        </Field>
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
