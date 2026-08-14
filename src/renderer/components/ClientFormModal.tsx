// ============================================================================
// AlAqsa — Create/edit client, including multiple contacts with phones/emails.
// ============================================================================

import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import {
  Modal, Field, TextInput, TextArea, Select, Checkbox, Stars, StringList, useToast,
} from './ui';
import { CLIENT_TYPES } from '@shared/constants';
import type { Client, Contact, StatusLabel } from '@shared/types';
import { isValidEmail, isValidPhone } from '../utils/validation';

interface DraftContact {
  id: string;
  name: string;
  role: string;
  phones: string[];
  emails: string[];
  isPrimary: boolean;
}

const emptyContact = (): DraftContact => ({
  id: '', name: '', role: '', phones: [''], emails: [], isPrimary: false,
});

export function ClientFormModal({
  open, client, labels, onClose, onSaved,
}: {
  open: boolean;
  client: Client | null;
  labels: StatusLabel[];
  onClose: () => void;
  onSaved: (c: Client) => void;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();

  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [type, setType] = useState('person');
  const [statusLabelId, setStatusLabelId] = useState('');
  const [rating, setRating] = useState(0);
  const [isFlagged, setIsFlagged] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const [notes, setNotes] = useState('');
  const [contacts, setContacts] = useState<DraftContact[]>([emptyContact()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (client) {
      setNameAr(client.nameAr);
      setNameEn(client.nameEn ?? '');
      setType(client.type);
      setStatusLabelId(client.statusLabelId ?? '');
      setRating(client.rating);
      setIsFlagged(client.isFlagged);
      setFlagReason(client.flagReason ?? '');
      setNotes(client.notes ?? '');
      void window.alaqsa.clients.contacts(client.id).then((res) => {
        if (res.ok && res.data.length) {
          setContacts(res.data.map((c) => ({
            id: c.id, name: c.name, role: c.role ?? '',
            phones: c.phones.length ? c.phones : [''],
            emails: c.emails, isPrimary: c.isPrimary,
          })));
        } else {
          setContacts([emptyContact()]);
        }
      });
    } else {
      setNameAr(''); setNameEn(''); setType('person'); setStatusLabelId('');
      setRating(0); setIsFlagged(false); setFlagReason(''); setNotes('');
      setContacts([{ ...emptyContact(), isPrimary: true }]);
    }
    setErrors({});
  }, [open, client]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!nameAr.trim()) e.nameAr = t.validation.required;
    if (isFlagged && !flagReason.trim()) e.flagReason = t.validation.required;

    contacts.forEach((c, i) => {
      if (!c.name.trim() && (c.phones.some((p) => p.trim()) || c.emails.some((m) => m.trim()))) {
        e[`contact_${i}_name`] = t.validation.required;
      }
      c.phones.forEach((p, pi) => {
        if (p.trim() && !isValidPhone(p)) e[`contact_${i}_phone_${pi}`] = t.validation.invalidPhone;
      });
      c.emails.forEach((m, mi) => {
        if (m.trim() && !isValidEmail(m)) e[`contact_${i}_email_${mi}`] = t.validation.invalidEmail;
      });
    });

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setBusy(true);

    const payload: Partial<Client> = {
      nameAr: nameAr.trim(),
      nameEn: nameEn.trim() || undefined,
      type: type as Client['type'],
      statusLabelId: statusLabelId || undefined,
      rating,
      isFlagged,
      flagReason: isFlagged ? flagReason.trim() : undefined,
      notes: notes.trim() || undefined,
    };

    const res = client
      ? await window.alaqsa.clients.update(client.id, payload)
      : await window.alaqsa.clients.create(payload);

    if (!res.ok) {
      setBusy(false);
      toast.error(res.error);
      return;
    }

    // Persist contacts (drop fully-empty rows).
    const cleaned: Contact[] = contacts
      .filter((c) => c.name.trim() || c.phones.some((p) => p.trim()) || c.emails.some((m) => m.trim()))
      .map((c, i) => ({
        id: c.id || '', clientId: res.data.id, name: c.name.trim(), role: c.role.trim() || undefined,
        phones: c.phones.map((p) => p.trim()).filter(Boolean),
        emails: c.emails.map((m) => m.trim()).filter(Boolean),
        isPrimary: c.isPrimary, order: i,
      }));
    if (cleaned.length && !cleaned.some((c) => c.isPrimary)) cleaned[0].isPrimary = true;
    await window.alaqsa.clients.saveContacts(res.data.id, cleaned);

    setBusy(false);
    toast.success(client ? t.msg.updated : t.msg.created);
    onSaved(res.data);
  };

  const setContact = (i: number, patch: Partial<DraftContact>) => {
    setContacts((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  };

  const setPrimary = (i: number) => {
    setContacts((prev) => prev.map((c, j) => ({ ...c, isPrimary: j === i })));
  };

  return (
    <Modal
      open={open}
      title={client ? t.clients.editClient : t.clients.newClient}
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
          <Field label={t.clients.nameAr} required error={errors.nameAr}>
            <TextInput value={nameAr} onChange={setNameAr} error={!!errors.nameAr} autoFocus />
          </Field>
          <Field label={t.clients.nameEn}>
            <TextInput value={nameEn} onChange={setNameEn} dir="ltr" />
          </Field>
          <Field label={t.clients.clientType} required>
            <Select
              value={type}
              onChange={setType}
              options={CLIENT_TYPES.map((c) => ({ value: c.value, label: lang === 'ar' ? c.ar : c.en }))}
            />
          </Field>
          <Field label={t.common.status}>
            <Select
              value={statusLabelId}
              onChange={setStatusLabelId}
              placeholder={t.common.selectOption}
              options={labels.map((l) => ({ value: l.id, label: lang === 'ar' ? l.name_ar : l.name_en }))}
            />
          </Field>
          <Field label={t.clients.rating}>
            <div style={{ paddingTop: 8 }}><Stars value={rating} onChange={setRating} size={22} /></div>
          </Field>
        </div>

        {/* Flag */}
        <div style={{
          padding: 14, borderRadius: 'var(--radius)',
          background: isFlagged ? 'var(--danger-bg)' : 'var(--surface-2)',
          border: `1px solid ${isFlagged ? 'var(--danger)' : 'var(--border)'}`,
          transition: 'background 160ms',
        }}>
          <Checkbox
            checked={isFlagged}
            onChange={setIsFlagged}
            label={`🔴 ${t.clients.flagged}`}
          />
          {isFlagged && (
            <div className="mt-8">
              <Field error={errors.flagReason} hint={t.clients.flagHint}>
                <TextInput value={flagReason} onChange={setFlagReason} error={!!errors.flagReason} />
              </Field>
            </div>
          )}
        </div>

        {/* Contacts */}
        <div>
          <div className="row between mb-8">
            <span className="form-section-title" style={{ border: 'none', margin: 0, padding: 0 }}>
              {t.clients.contacts}
            </span>
            <button className="btn btn-outline btn-sm"
              onClick={() => setContacts((p) => [...p, emptyContact()])}>
              + {t.clients.addContact}
            </button>
          </div>

          <div className="col gap-12">
            {contacts.map((c, i) => (
              <div key={i} className="card">
                <div className="card-body col gap-10" style={{ padding: 14 }}>
                  <div className="row between gap-8">
                    <Checkbox
                      checked={c.isPrimary}
                      onChange={() => setPrimary(i)}
                      label={t.clients.primaryContact}
                    />
                    {contacts.length > 1 && (
                      <button className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => setContacts((p) => p.filter((_, j) => j !== i))}>✕</button>
                    )}
                  </div>
                  <div className="form-grid">
                    <Field label={t.clients.contactName} error={errors[`contact_${i}_name`]}>
                      <TextInput value={c.name} onChange={(v) => setContact(i, { name: v })}
                        error={!!errors[`contact_${i}_name`]} />
                    </Field>
                    <Field label={t.clients.contactRole}>
                      <TextInput value={c.role} onChange={(v) => setContact(i, { role: v })} />
                    </Field>
                    <Field label={t.clients.phones}
                      error={Object.keys(errors).find((k) => k.startsWith(`contact_${i}_phone`)) ? t.validation.invalidPhone : undefined}>
                      <StringList
                        values={c.phones}
                        onChange={(v) => setContact(i, { phones: v })}
                        addLabel={t.clients.addPhone}
                        placeholder="+9715xxxxxxxx"
                        type="tel"
                      />
                    </Field>
                    <Field label={t.clients.emails}
                      error={Object.keys(errors).find((k) => k.startsWith(`contact_${i}_email`)) ? t.validation.invalidEmail : undefined}>
                      <StringList
                        values={c.emails}
                        onChange={(v) => setContact(i, { emails: v })}
                        addLabel={t.clients.addEmail}
                        placeholder="name@example.com"
                        type="email"
                      />
                    </Field>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Field label={t.common.notes}>
          <TextArea value={notes} onChange={setNotes} rows={3} />
        </Field>
      </div>
    </Modal>
  );
}
