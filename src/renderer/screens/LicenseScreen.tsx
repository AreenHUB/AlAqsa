// ============================================================================
// AlAqsa — License gate. Shown when the license is expired/revoked/missing.
// Data is never deleted — the app simply locks until a valid key is entered.
// ============================================================================

import React, { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Field, TextInput, useToast } from '../components/ui';
import { AuthShell } from './AuthShell';
import { AUTHOR } from '@shared/constants';
import type { LicenseState } from '@shared/ipc';

export function LicenseScreen({
  state, onActivated,
}: {
  state: LicenseState;
  onActivated: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const title =
    state.status === 'expired' ? t.license.expired
    : state.status === 'revoked' ? t.license.revoked
    : t.license.missing;

  const activate = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setError('');
    const res = await window.alaqsa.license.activate(key.trim());
    setBusy(false);
    if (!res.ok) {
      setError(t.license.invalidLicense);
      return;
    }
    toast.success(t.license.activated);
    onActivated();
  };

  return (
    <AuthShell title={title}>
      <div className="col gap-16">
        <div style={{
          padding: '14px 16px', borderRadius: 'var(--radius)',
          background: 'var(--warning-bg)', color: '#b45309',
          fontSize: 13, lineHeight: 1.75,
        }}>
          🔒 {t.license.expiredMsg}
        </div>

        <div>
          <p className="small muted mb-8">{t.license.contactDeveloper}</p>
          <div className="col gap-4 small" style={{
            padding: '12px 14px', background: 'var(--surface-2)',
            borderRadius: 'var(--radius)', border: '1px solid var(--border)',
          }}>
            <div className="row gap-8"><span>👤</span><span className="bold">{AUTHOR.name}</span></div>
            <div className="row gap-8"><span>📱</span><span className="mono" dir="ltr">{AUTHOR.phone}</span></div>
            <div className="row gap-8"><span>✉️</span><span className="mono" dir="ltr">{AUTHOR.email}</span></div>
          </div>
        </div>

        <Field label={t.license.enterLicense} error={error || undefined}>
          <TextInput
            value={key}
            onChange={(v) => { setKey(v); setError(''); }}
            error={!!error}
            dir="ltr"
            placeholder="eyJwYXlsb2FkIjp7..."
            onKeyDown={(e) => { if (e.key === 'Enter') void activate(); }}
          />
        </Field>

        <button className="btn btn-primary btn-lg btn-block" onClick={activate} disabled={busy || !key.trim()}>
          {busy ? <span className="spinner" /> : t.license.activate}
        </button>
      </div>
    </AuthShell>
  );
}
