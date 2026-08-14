// ============================================================================
// AlAqsa — Create/edit a device.
//
// Two requested behaviours are implemented here:
//  1. Barcode/QR capture for the serial number — hardware readers act as a
//     keyboard, so a focused field with fast-typing detection captures them.
//  2. Inventory autocomplete: picking a stock item fills manufacturer/model,
//     while "external" devices are typed freely and never touch inventory.
// ============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Modal, Field, TextInput, TextArea, Select, useToast } from './ui';
import { BarcodeInput } from './BarcodeInput';
import { DEVICE_TYPES } from '@shared/constants';
import { isValidSerial, isValidLabel, isDateOrderValid } from '../utils/validation';
import type { Device, Branch, InventoryItem } from '@shared/types';

export function DeviceFormModal({
  open, device, branchId, branches, onClose, onSaved,
}: {
  open: boolean;
  device: Device | null;
  branchId: string;
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();

  const [targetBranch, setTargetBranch] = useState(branchId);
  const [type, setType] = useState('camera');
  const [label, setLabel] = useState('');
  const [position, setPosition] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [channels, setChannels] = useState('');
  const [capacity, setCapacity] = useState('');
  const [firmware, setFirmware] = useState('');
  const [source, setSource] = useState<'ours' | 'external'>('ours');
  const [installDate, setInstallDate] = useState('');
  const [warrantyExpiry, setWarrantyExpiry] = useState('');
  const [health, setHealth] = useState('');
  const [inventoryItemId, setInventoryItemId] = useState('');
  const [notes, setNotes] = useState('');
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void window.alaqsa.inventory.list().then((r) => { if (r.ok) setInventory(r.data); });

    if (device) {
      setTargetBranch(device.branchId);
      setType(device.type);
      setLabel(device.label ?? '');
      setPosition(device.positionInBranch ?? '');
      setManufacturer(device.manufacturer ?? '');
      setModel(device.model ?? '');
      setSerial(device.serialNumber ?? '');
      setChannels(device.channels?.toString() ?? '');
      setCapacity(device.capacity ?? '');
      setFirmware(device.firmware ?? '');
      setSource(device.source);
      setInstallDate(device.installDate ?? '');
      setWarrantyExpiry(device.warrantyExpiry ?? '');
      setHealth(device.health ?? '');
      setInventoryItemId(device.inventoryItemId ?? '');
      setNotes(device.notes ?? '');
    } else {
      setTargetBranch(branchId);
      setType('camera'); setLabel(''); setPosition(''); setManufacturer('');
      setModel(''); setSerial(''); setChannels(''); setCapacity(''); setFirmware('');
      setSource('ours'); setInstallDate(''); setWarrantyExpiry(''); setHealth('');
      setInventoryItemId(''); setNotes('');
    }
    setErrors({});
  }, [open, device, branchId]);

  /** Stock items matching the selected device type. */
  const matchingStock = useMemo(
    () => inventory.filter((i) => i.type === type),
    [inventory, type],
  );

  const applyStockItem = (id: string) => {
    setInventoryItemId(id);
    const item = inventory.find((i) => i.id === id);
    if (item) {
      if (item.manufacturer) setManufacturer(item.manufacturer);
      if (item.model) setModel(item.model);
      if (item.description && !capacity && type === 'hdd') setCapacity(item.description);
    }
  };

  /** Serial captured from a hardware reader or camera scan. */
  const onScan = async (scanned: string) => {
    setSerial(scanned);
    // Warn immediately if this serial already belongs to another device.
    const res = await window.alaqsa.devices.findBySerial(scanned);
    if (res.ok && res.data && res.data.id !== device?.id) {
      setErrors((e) => ({ ...e, serial: t.devices.duplicateSerial }));
      toast.warning(t.devices.duplicateSerial);
    } else {
      setErrors((e) => { const { serial: _drop, ...rest } = e; return rest; });
    }
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (!targetBranch) e.branch = t.validation.required;
    if (!isValidLabel(label)) e.label = t.validation.maxLength;
    if (!isValidSerial(serial)) e.serial = t.validation.required;
    if (channels && (!Number.isInteger(Number(channels)) || Number(channels) < 0)) {
      e.channels = t.validation.invalidNumber;
    }
    if (!isDateOrderValid(installDate, warrantyExpiry)) e.warrantyExpiry = t.validation.dateOrder;

    // Duplicate serial check (excluding this device).
    if (serial.trim()) {
      const found = await window.alaqsa.devices.findBySerial(serial.trim());
      if (found.ok && found.data && found.data.id !== device?.id) {
        e.serial = t.devices.duplicateSerial;
      }
    }

    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    const payload: Partial<Device> = {
      branchId: targetBranch,
      type: type as Device['type'],
      label: label.trim() || undefined,
      positionInBranch: position.trim() || undefined,
      manufacturer: manufacturer.trim() || undefined,
      model: model.trim() || undefined,
      serialNumber: serial.trim() || undefined,
      channels: channels ? Number(channels) : undefined,
      capacity: capacity.trim() || undefined,
      firmware: firmware.trim() || undefined,
      source,
      installDate: installDate || undefined,
      warrantyExpiry: warrantyExpiry || undefined,
      health: (health || undefined) as Device['health'],
      // Only link to stock when the device came from our shop.
      inventoryItemId: source === 'ours' ? (inventoryItemId || undefined) : undefined,
      notes: notes.trim() || undefined,
    };

    const res = device
      ? await window.alaqsa.devices.update(device.id, payload)
      : await window.alaqsa.devices.create(payload);
    setBusy(false);

    if (!res.ok) return toast.error(res.error);
    toast.success(device ? t.msg.updated : t.msg.created);
    onSaved();
  };

  const isRecorder = type === 'nvr' || type === 'dvr';
  const isDisk = type === 'hdd';

  return (
    <Modal
      open={open}
      title={device ? t.devices.editDevice : t.devices.newDevice}
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
      <div className="col gap-16">
        <div className="form-grid">
          <Field label={t.branches.title} required error={errors.branch}>
            <Select
              value={targetBranch}
              onChange={setTargetBranch}
              placeholder={t.common.selectOption}
              options={branches.map((b) => ({ value: b.id, label: b.nameAr }))}
              error={!!errors.branch}
            />
          </Field>

          <Field label={t.devices.deviceType} required>
            <Select
              value={type}
              onChange={(v) => { setType(v); setInventoryItemId(''); }}
              options={DEVICE_TYPES.map((d) => ({ value: d.value, label: lang === 'ar' ? d.ar : d.en }))}
            />
          </Field>
        </div>

        {/* Source: ours vs external */}
        <div style={{
          padding: 13, borderRadius: 'var(--radius)',
          background: 'var(--surface-2)', border: '1px solid var(--border)',
        }}>
          <div className="field-label mb-8">{t.devices.source}</div>
          <div className="row gap-16 wrap">
            <label className="check">
              <input type="radio" checked={source === 'ours'} onChange={() => setSource('ours')} />
              <span>🏪 {t.devices.sourceOurs}</span>
            </label>
            <label className="check">
              <input type="radio" checked={source === 'external'} onChange={() => { setSource('external'); setInventoryItemId(''); }} />
              <span>🌍 {t.devices.sourceExternal}</span>
            </label>
          </div>
          <div className="field-hint mt-8">{t.devices.sourceHint}</div>

          {source === 'ours' && matchingStock.length > 0 && (
            <div className="mt-16">
              <Field label={t.devices.fromInventory}>
                <Select
                  value={inventoryItemId}
                  onChange={applyStockItem}
                  placeholder={t.common.selectOption}
                  options={matchingStock.map((i) => ({
                    value: i.id,
                    label: `${i.manufacturer ?? ''} ${i.model ?? ''} ${i.description ? `— ${i.description}` : ''}`.trim(),
                  }))}
                />
              </Field>
            </div>
          )}
        </div>

        <div className="form-grid">
          <Field label={t.devices.label} error={errors.label} hint="مثال: CAM-1">
            <TextInput value={label} onChange={setLabel} error={!!errors.label} />
          </Field>
          <Field label={t.devices.positionInBranch} hint="مثال: المدخل الرئيسي">
            <TextInput value={position} onChange={setPosition} />
          </Field>
          <Field label={t.devices.manufacturer}>
            <TextInput value={manufacturer} onChange={setManufacturer} list="mfr-list" />
          </Field>
          <Field label={t.devices.model}>
            <TextInput value={model} onChange={setModel} list="model-list" dir="ltr" />
          </Field>

          <datalist id="mfr-list">
            {[...new Set(inventory.map((i) => i.manufacturer).filter(Boolean))].map((m) => (
              <option key={m} value={m!} />
            ))}
          </datalist>
          <datalist id="model-list">
            {[...new Set(matchingStock.map((i) => i.model).filter(Boolean))].map((m) => (
              <option key={m} value={m!} />
            ))}
          </datalist>

          <Field label={t.devices.serialNumber} error={errors.serial} className="span-2">
            <BarcodeInput value={serial} onChange={setSerial} onScan={onScan} error={!!errors.serial} />
          </Field>

          {isRecorder && (
            <>
              <Field label={t.devices.channels} error={errors.channels}>
                <TextInput value={channels} onChange={setChannels} type="number" min={0}
                  error={!!errors.channels} dir="ltr" />
              </Field>
              <Field label={t.devices.firmware}>
                <TextInput value={firmware} onChange={setFirmware} dir="ltr" />
              </Field>
            </>
          )}

          {isDisk && (
            <Field label={t.devices.capacity} hint="مثال: 4TB">
              <TextInput value={capacity} onChange={setCapacity} dir="ltr" />
            </Field>
          )}

          <Field label={t.devices.installDate}>
            <TextInput value={installDate} onChange={setInstallDate} type="date" />
          </Field>
          <Field label={t.devices.warrantyExpiry} error={errors.warrantyExpiry}>
            <TextInput value={warrantyExpiry} onChange={setWarrantyExpiry} type="date"
              error={!!errors.warrantyExpiry} />
          </Field>
          <Field label={t.devices.health}>
            <Select
              value={health}
              onChange={setHealth}
              placeholder={t.common.selectOption}
              options={[
                { value: 'excellent', label: t.devices.healthExcellent },
                { value: 'good', label: t.devices.healthGood },
                { value: 'warning', label: t.devices.healthWarning },
                { value: 'faulty', label: t.devices.healthFaulty },
              ]}
            />
          </Field>

          <Field label={t.common.notes} className="span-all">
            <TextArea value={notes} onChange={setNotes} rows={2} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
