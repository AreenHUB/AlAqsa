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
import { Modal, Field, TextInput, TextArea, Select, useToast , useErrorMessage } from './ui';
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
  const errMsg = useErrorMessage();

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
  const [source, setSource] = useState<'ours' | 'existing' | 'mixed'>('ours');
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

  /**
   * Serial captured from a hardware reader or camera scan.
   *
   * If the serial is already registered, the known details are copied into the
   * form immediately so the technician does not retype them; otherwise we fall
   * back to matching the shop inventory by model/serial prefix. This is the
   * "scan and it fills itself" behaviour requested for field work.
   */
  const onScan = async (scanned: string) => {
    const code = scanned.trim();
    setSerial(code);
    if (!code) return;

    // One lookup answers both questions: is this unit sitting in the shop, and
    // is this serial already recorded on a device somewhere?
    const res = await window.alaqsa.stock.lookupSerial(code);
    if (!res.ok || !res.data) {
      setErrors((e) => { const { serial: _drop, ...rest } = e; return rest; });
      toast.warning(t.devices.serialNotFound);
      return;
    }

    const { unit, device: found, clientName, branchName } = res.data;

    // An installed device wins: its details are the most specific, and the
    // technician needs to be told the serial is already in use elsewhere.
    if (found && found.id !== device?.id) {
      setErrors((e) => ({ ...e, serial: t.devices.duplicateSerial }));
      toast.warning(
        clientName
          ? `${t.devices.serialAlreadyAt} ${clientName}${branchName ? ` — ${branchName}` : ''}`
          : t.devices.duplicateSerial,
      );
    } else {
      setErrors((e) => { const { serial: _drop, ...rest } = e; return rest; });
    }

    if (found) {
      if (found.type) setType(found.type);
      if (found.manufacturer) setManufacturer(found.manufacturer);
      if (found.model) setModel(found.model);
      if (found.label && !label) setLabel(found.label);
      if (found.channels) setChannels(String(found.channels));
      if (found.capacity) setCapacity(found.capacity);
      if (found.firmware) setFirmware(found.firmware);
      if (!unit) { toast.success(t.devices.autofilledFromDevice); return; }
    }

    // Fill from the shop unit: this is the "scan a box and the form completes
    // itself" case the owner asked for.
    if (unit) {
      if (unit.type) setType(unit.type);
      if (unit.manufacturer) setManufacturer(unit.manufacturer);
      // The stock take carries one descriptive name per product; it is the
      // most useful thing to put in the model field.
      if (unit.itemName) setModel(unit.itemName);
      if (unit.inventoryItemId) setInventoryItemId(unit.inventoryItemId);
      // Everything the shop supplies is ours, by definition.
      setSource('ours');
      if (unit.status === 'installed' && !found) {
        toast.warning(t.devices.unitAlreadyInstalled);
      } else {
        toast.success(t.devices.autofilledFromStock);
      }
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
      // Equipment the client already owned is never linked to our stock.
      inventoryItemId: source === 'existing' ? undefined : (inventoryItemId || undefined),
      notes: notes.trim() || undefined,
    };

    const res = device
      ? await window.alaqsa.devices.update(device.id, payload)
      : await window.alaqsa.devices.create(payload);
    setBusy(false);

    if (!res.ok) return toast.error(errMsg(res.error));
    toast.success(device ? t.msg.updated : t.msg.created);
    onSaved();
  };

  const isRecorder = type === 'nvr' || type === 'dvr';
  const isDisk = type === 'hdd';

  return (
    <Modal
      open={open}
      title={device ? t.devices.editDevice : t.devices.newDevice}
      onSubmit={save}
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

        {/* Where the device came from. "Existing" equipment often arrives with
            unknown details (imported by the client), so nothing is mandatory. */}
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
              <input type="radio" checked={source === 'existing'}
                onChange={() => { setSource('existing'); setInventoryItemId(''); }} />
              <span>📦 {t.devices.sourceExisting}</span>
            </label>
            <label className="check">
              <input type="radio" checked={source === 'mixed'} onChange={() => setSource('mixed')} />
              <span>🔀 {t.devices.sourceMixed}</span>
            </label>
          </div>
          <div className="field-hint mt-8">
            {source === 'existing' ? t.devices.sourceExistingHint
              : source === 'mixed' ? t.devices.sourceMixedHint
              : t.devices.sourceHint}
          </div>

          {source !== 'existing' && matchingStock.length > 0 && (
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

          {source === 'existing' && (
            <div className="mt-8 small" style={{
              padding: '9px 11px', background: 'var(--info-bg)',
              borderRadius: 'var(--radius)', lineHeight: 1.6,
            }}>
              ℹ️ {t.devices.existingNotice}
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
