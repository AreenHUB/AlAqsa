// ============================================================================
// AlAqsa — Shop inventory. Feeds device autocomplete; supports Excel import.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import {
  Modal, Field, TextInput, TextArea, Select, Loading, EmptyState,
  ConfirmDialog, useToast, useErrorMessage, Badge, Tabs,
} from '../components/ui';
import { DEVICE_TYPES } from '@shared/constants';
import { isPositiveNumber } from '../utils/validation';
import type { InventoryItem, StockUnit } from '@shared/types';

export function InventoryScreen() {
  const { t, lang, fmt } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState<InventoryItem | null>(null);

  // Two views of the same stock: by product ("40 of this camera") and by
  // physical unit ("this camera, serial ..."). Scanning works on the latter.
  const [view, setView] = useState<'products' | 'units'>('products');
  const [units, setUnits] = useState<StockUnit[]>([]);
  const [unitTotal, setUnitTotal] = useState(0);
  const [counts, setCounts] = useState({ total: 0, inStock: 0, installed: 0 });
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async () => {
    const res = await window.alaqsa.inventory.list(search || undefined);
    if (res.ok) setItems(res.data);
    setLoading(false);
  }, [search]);

  const loadUnits = useCallback(async () => {
    const [list, c] = await Promise.all([
      window.alaqsa.stock.list({
        search: search || undefined,
        status: statusFilter || undefined,
        limit: 300,
      }),
      window.alaqsa.stock.counts(),
    ]);
    if (list.ok) { setUnits(list.data.rows); setUnitTotal(list.data.total); }
    if (c.ok) setCounts(c.data);
  }, [search, statusFilter]);

  useEffect(() => {
    const id = window.setTimeout(() => { void load(); void loadUnits(); }, 200);
    return () => window.clearTimeout(id);
  }, [load, loadUnits]);

  const typeLabel = (v: string) => {
    const d = DEVICE_TYPES.find((x) => x.value === v);
    return d ? (lang === 'ar' ? d.ar : d.en) : v;
  };

  const importExcel = async () => {
    const picked = await window.alaqsa.files.pickOpen([
      { name: 'Excel', extensions: ['xlsx', 'xls'] },
    ]);
    if (!picked.ok || !picked.data) return;
    const res = await window.alaqsa.inventory.importExcel(picked.data);
    if (!res.ok) return toast.error(errMsg(res.error));
    const { imported, updated, negativeStock, kind, duplicateSerials, productsTouched } = res.data;

    if (kind === 'serials') {
      // The by-serial stock take: report units AND the products they rolled up
      // into, because both views changed.
      toast.success(fmt(t.stock.importedSerials, {
        n: imported, u: updated, p: productsTouched ?? 0,
      }));
      if (duplicateSerials && duplicateSerials > 0) {
        toast.warning(fmt(t.stock.duplicateSerialsWarning, { n: duplicateSerials }));
      }
      setView('units');
    } else {
      toast.success(fmt(t.inventory.imported, { n: imported, u: updated }));
      // Items the source file reported as over-issued were stored as zero; say
      // so rather than letting a wrong stock figure pass unnoticed.
      if (negativeStock > 0) {
        toast.warning(fmt(t.inventory.importNegative, { n: negativeStock }));
      }
    }
    void load();
    void loadUnits();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = await window.alaqsa.inventory.remove(deleting.id);
    setDeleting(null);
    if (res.ok) { toast.success(t.msg.deleted); void load(); }
    else toast.error(errMsg(res.error));
  };

  const shown = typeFilter ? items.filter((i) => i.type === typeFilter) : items;
  const totalValue = shown.reduce((sum, i) => sum + (i.unitPrice ?? 0) * (i.quantity ?? 0), 0);

  if (loading) return <Loading />;

  return (
    <div className="col gap-16 fade-in">
      <div className="row between wrap gap-12">
        <div>
          <h1 style={{ fontSize: 22 }}>{t.inventory.title}</h1>
          <p className="muted small">{t.inventory.subtitle}</p>
        </div>
        <div className="row gap-8">
          <button className="btn btn-outline" onClick={importExcel}>📥 {t.inventory.importExcel}</button>
          <button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
            + {t.inventory.newItem}
          </button>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'products', label: t.inventory.title },
          { id: 'units', label: `${t.stock.title}${counts.total ? ` (${counts.total})` : ''}` },
        ]}
        active={view}
        onChange={(v) => setView(v as 'products' | 'units')}
      />

      {view === 'products' ? (
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">{t.inventory.title}</div>
            <div className="stat-value">{shown.length}</div>
          </div>
          <div className="stat">
            <div className="stat-label">{t.inventory.quantity}</div>
            <div className="stat-value">{shown.reduce((s, i) => s + (i.quantity ?? 0), 0)}</div>
          </div>
          <div className="stat accent-success">
            <div className="stat-label">{t.common.total}</div>
            <div className="stat-value">{totalValue.toLocaleString()}</div>
            <div className="stat-sub">AED</div>
          </div>
        </div>
      ) : (
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">{t.stock.total}</div>
            <div className="stat-value">{counts.total}</div>
          </div>
          <div className="stat accent-success">
            <div className="stat-label">{t.stock.inStock}</div>
            <div className="stat-value">{counts.inStock}</div>
          </div>
          <div className="stat">
            <div className="stat-label">{t.stock.installed}</div>
            <div className="stat-value">{counts.installed}</div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-body row gap-10 wrap" style={{ padding: 14 }}>
          <input
            className="input"
            style={{ flex: '2 1 240px' }}
            placeholder={`🔍 ${t.common.search}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div style={{ flex: '1 1 160px' }}>
            {view === 'products' ? (
              <Select
                value={typeFilter}
                onChange={setTypeFilter}
                placeholder={t.common.type}
                options={DEVICE_TYPES.map((d) => ({ value: d.value, label: lang === 'ar' ? d.ar : d.en }))}
              />
            ) : (
              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                placeholder={t.stock.status}
                options={[
                  { value: 'in_stock', label: t.stock.inStock },
                  { value: 'installed', label: t.stock.installed },
                  { value: 'returned', label: t.stock.returned },
                  { value: 'faulty', label: t.stock.faulty },
                ]}
              />
            )}
          </div>
          <div className="small muted" style={{ marginInlineStart: 'auto', maxWidth: 380 }}>
            ℹ️ {view === 'products' ? t.inventory.importHint : t.stock.subtitle}
          </div>
        </div>
      </div>

      {view === 'units' && (
        units.length === 0 ? (
          <EmptyState icon="🔢" title={t.stock.noUnits}
            action={
              <button className="btn btn-outline" onClick={importExcel}>
                📥 {t.inventory.importExcel}
              </button>
            } />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.stock.serial}</th>
                  <th>{t.stock.item}</th>
                  <th>{t.common.type}</th>
                  <th>{t.inventory.unitPrice}</th>
                  <th>{t.stock.status}</th>
                  <th style={{ width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.id}>
                    <td className="small bold mono" dir="ltr">{u.serialNumber}</td>
                    <td className="small">{u.itemName}</td>
                    <td><Badge kind="info">{typeLabel(u.type)}</Badge></td>
                    <td className="small">{u.unitPrice?.toLocaleString() ?? '—'}</td>
                    <td>
                      <Badge kind={u.status === 'in_stock' ? 'success'
                        : u.status === 'installed' ? 'info' : 'warning'}>
                        {u.status === 'in_stock' ? t.stock.inStock
                          : u.status === 'installed' ? t.stock.installed
                            : u.status === 'returned' ? t.stock.returned : t.stock.faulty}
                      </Badge>
                    </td>
                    <td>
                      {u.status === 'installed' && (
                        <button className="btn btn-ghost btn-sm"
                          title={t.stock.returnToStock}
                          onClick={async () => {
                            const r = await window.alaqsa.stock.returnToStock(u.id);
                            if (r.ok) { toast.success(t.msg.updated); void loadUnits(); void load(); }
                            else toast.error(errMsg(r.error));
                          }}>↩</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {unitTotal > units.length && (
              <div className="small muted" style={{ padding: 10, textAlign: 'center' }}>
                {units.length} / {unitTotal}
              </div>
            )}
          </div>
        )
      )}

      {view === 'products' && (shown.length === 0 ? (
        <EmptyState icon="📦" title={t.inventory.noItems}
          action={
            <div className="row gap-8">
              <button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
                + {t.inventory.newItem}
              </button>
              <button className="btn btn-outline" onClick={importExcel}>📥 {t.inventory.importExcel}</button>
            </div>
          } />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.common.type}</th>
                <th>{t.devices.manufacturer}</th>
                <th>{t.devices.model}</th>
                <th>{t.inventory.description}</th>
                <th>{t.inventory.quantity}</th>
                <th>{t.inventory.unitPrice}</th>
                <th>{t.common.total}</th>
                <th style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id}>
                  <td><Badge kind="info">{typeLabel(i.type)}</Badge></td>
                  <td className="small">{i.manufacturer ?? '—'}</td>
                  <td className="small bold mono" dir="ltr">{i.model ?? '—'}</td>
                  <td className="small">{i.description ?? '—'}</td>
                  <td className="small">
                    <Badge kind={(i.quantity ?? 0) > 0 ? 'success' : 'danger'}>{i.quantity ?? 0}</Badge>
                  </td>
                  <td className="small">{i.unitPrice?.toLocaleString() ?? '—'}</td>
                  <td className="small bold">
                    {((i.unitPrice ?? 0) * (i.quantity ?? 0)).toLocaleString()}
                  </td>
                  <td>
                    <div className="cell-actions">
                      <button className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => { setEditing(i); setFormOpen(true); }}>✏️</button>
                      <button className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => setDeleting(i)}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <InventoryFormModal
        open={formOpen}
        item={editing}
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

function InventoryFormModal({
  open, item, onClose, onSaved,
}: {
  open: boolean;
  item: InventoryItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [type, setType] = useState('camera');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setType(item?.type ?? 'camera');
    setManufacturer(item?.manufacturer ?? '');
    setModel(item?.model ?? '');
    setDescription(item?.description ?? '');
    setQuantity(item?.quantity?.toString() ?? '');
    setUnitPrice(item?.unitPrice?.toString() ?? '');
    setErrors({});
  }, [open, item]);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!model.trim() && !manufacturer.trim()) e.model = t.validation.required;
    if (quantity && !isPositiveNumber(quantity)) e.quantity = t.validation.positiveNumber;
    if (unitPrice && !isPositiveNumber(unitPrice)) e.unitPrice = t.validation.positiveNumber;
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    const res = await window.alaqsa.inventory.upsert({
      id: item?.id,
      type: type as InventoryItem['type'],
      manufacturer: manufacturer.trim() || undefined,
      model: model.trim() || undefined,
      description: description.trim() || undefined,
      quantity: quantity ? Number(quantity) : undefined,
      unitPrice: unitPrice ? Number(unitPrice) : undefined,
    });
    setBusy(false);
    if (!res.ok) return toast.error(errMsg(res.error));
    toast.success(item ? t.msg.updated : t.msg.created);
    onSaved();
  };

  return (
    <Modal
      open={open}
      title={item ? t.inventory.editItem : t.inventory.newItem}
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
        <Field label={t.common.type} required>
          <Select
            value={type}
            onChange={setType}
            options={DEVICE_TYPES.map((d) => ({ value: d.value, label: lang === 'ar' ? d.ar : d.en }))}
          />
        </Field>
        <Field label={t.devices.manufacturer}>
          <TextInput value={manufacturer} onChange={setManufacturer} />
        </Field>
        <Field label={t.devices.model} required error={errors.model}>
          <TextInput value={model} onChange={setModel} error={!!errors.model} dir="ltr" />
        </Field>
        <Field label={t.inventory.description}>
          <TextInput value={description} onChange={setDescription} />
        </Field>
        <Field label={t.inventory.quantity} error={errors.quantity}>
          <TextInput value={quantity} onChange={setQuantity} type="number" min={0}
            error={!!errors.quantity} dir="ltr" />
        </Field>
        <Field label={`${t.inventory.unitPrice} (AED)`} error={errors.unitPrice}>
          <TextInput value={unitPrice} onChange={setUnitPrice} type="number" min={0} step="0.01"
            error={!!errors.unitPrice} dir="ltr" />
        </Field>
      </div>
    </Modal>
  );
}
