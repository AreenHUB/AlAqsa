// ============================================================================
// AlAqsa — Create/edit a branch, including its map location.
// ============================================================================

import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Modal, Field, TextInput, TextArea, Select, useToast } from './ui';
import { isValidLat, isValidLng, isValidUrl, isValidPhone } from '../utils/validation';
import type { Branch, StatusLabel } from '@shared/types';

export function BranchFormModal({
  open, clientId, branch, labels, onClose, onSaved,
}: {
  open: boolean;
  clientId: string;
  branch: Branch | null;
  labels: StatusLabel[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();

  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [mapUrl, setMapUrl] = useState('');
  const [statusLabelId, setStatusLabelId] = useState('');
  const [managerContact, setManagerContact] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (branch) {
      setNameAr(branch.nameAr);
      setNameEn(branch.nameEn ?? '');
      setAddress(branch.location.address ?? '');
      setLat(branch.location.lat?.toString() ?? '');
      setLng(branch.location.lng?.toString() ?? '');
      setMapUrl(branch.location.mapUrl ?? '');
      setStatusLabelId(branch.statusLabelId ?? '');
      setManagerContact(branch.managerContact ?? '');
      setNotes(branch.notes ?? '');
    } else {
      setNameAr(''); setNameEn(''); setAddress(''); setLat(''); setLng('');
      setMapUrl(''); setStatusLabelId(''); setManagerContact(''); setNotes('');
    }
    setErrors({});
  }, [open, branch]);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!nameAr.trim()) e.nameAr = t.validation.required;
    if (!isValidLat(lat)) e.lat = t.validation.invalidNumber;
    if (!isValidLng(lng)) e.lng = t.validation.invalidNumber;
    if (mapUrl && !isValidUrl(mapUrl)) e.mapUrl = t.validation.invalidNumber;
    if (managerContact.trim() && !isValidPhone(managerContact)) e.managerContact = t.validation.invalidPhone;
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    const payload: Partial<Branch> = {
      clientId,
      nameAr: nameAr.trim(),
      nameEn: nameEn.trim() || undefined,
      location: {
        address: address.trim() || undefined,
        lat: lat.trim() ? Number(lat) : undefined,
        lng: lng.trim() ? Number(lng) : undefined,
        mapUrl: mapUrl.trim() || undefined,
      },
      statusLabelId: statusLabelId || undefined,
      managerContact: managerContact.trim() || undefined,
      notes: notes.trim() || undefined,
    };

    const res = branch
      ? await window.alaqsa.branches.update(branch.id, payload)
      : await window.alaqsa.branches.create(payload);
    setBusy(false);

    if (!res.ok) return toast.error(res.error);
    toast.success(branch ? t.msg.updated : t.msg.created);
    onSaved();
  };

  /** Extract lat/lng from a pasted Google Maps URL when possible. */
  const parseMapUrl = (url: string) => {
    setMapUrl(url);
    const m = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(url) ?? /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/.exec(url);
    if (m) { setLat(m[1]); setLng(m[2]); }
  };

  return (
    <Modal
      open={open}
      title={branch ? t.branches.editBranch : t.branches.newBranch}
      onSubmit={save}
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
        <Field label={t.branches.branchName} required error={errors.nameAr}>
          <TextInput value={nameAr} onChange={setNameAr} error={!!errors.nameAr} autoFocus />
        </Field>
        <Field label={t.clients.nameEn}>
          <TextInput value={nameEn} onChange={setNameEn} dir="ltr" />
        </Field>

        <Field label={t.common.address} className="span-all">
          <TextInput value={address} onChange={setAddress} />
        </Field>

        <Field label={t.branches.manager} error={errors.managerContact}>
          <TextInput value={managerContact} onChange={setManagerContact}
            error={!!errors.managerContact} dir="ltr" placeholder="+9715xxxxxxxx" />
        </Field>
        <Field label={t.common.status}>
          <Select
            value={statusLabelId}
            onChange={setStatusLabelId}
            placeholder={t.common.selectOption}
            options={labels.map((l) => ({ value: l.id, label: lang === 'ar' ? l.name_ar : l.name_en }))}
          />
        </Field>

        <Field label={t.branches.mapUrl} className="span-all" error={errors.mapUrl}
          hint="الصق رابط الخريطة وسيتم استخراج الإحداثيات تلقائياً">
          <TextInput value={mapUrl} onChange={parseMapUrl} error={!!errors.mapUrl}
            dir="ltr" placeholder="https://maps.google.com/..." />
        </Field>

        <Field label={t.branches.latitude} error={errors.lat}>
          <TextInput value={lat} onChange={setLat} error={!!errors.lat} dir="ltr" placeholder="25.2769" />
        </Field>
        <Field label={t.branches.longitude} error={errors.lng}>
          <TextInput value={lng} onChange={setLng} error={!!errors.lng} dir="ltr" placeholder="55.3800" />
        </Field>

        <Field label={t.common.notes} className="span-all">
          <TextArea value={notes} onChange={setNotes} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
