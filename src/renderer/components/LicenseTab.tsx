// ============================================================================
// AlAqsa — Licence tab in Settings.
//
// Until now a licence key could only be entered on the lock screen, i.e. only
// AFTER the licence had already expired. That made it impossible to upgrade a
// time-limited licence to a perpetual one while the app was still working —
// which is exactly what happens when a customer pays the balance early.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Field, TextInput, Badge, Loading, useToast } from './ui';
import { AUTHOR } from '@shared/constants';
import type { LicenseState } from '@shared/ipc';

export function LicenseTab() {
  const { t } = useI18n();
  const toast = useToast();

  const [state, setState] = useState<LicenseState | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await window.alaqsa.license.state();
    if (res.ok) setState(res.data);
  }, []);

  useEffect(() => { void load(); }, [load]);

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
    setKey('');
    toast.success(t.license.activated);
    void load();
  };

  if (!state) return <Loading />;

  const daysLeft = state.status === 'valid' && !state.perpetual && state.expiresAt
    ? Math.ceil((new Date(state.expiresAt).getTime() - Date.now()) / 86400000)
    : null;

  const badge = () => {
    if (state.status !== 'valid') {
      return <Badge kind="danger">
        {state.status === 'expired' ? t.license.expired
          : state.status === 'revoked' ? t.license.revoked : t.license.missing}
      </Badge>;
    }
    if (state.perpetual) return <Badge kind="success">✓ {t.license.perpetual}</Badge>;
    return <Badge kind={daysLeft !== null && daysLeft <= 7 ? 'warning' : 'info'}>
      {daysLeft} {t.common.days}
    </Badge>;
  };

  const isDevBuild = state.status === 'valid' && state.unlicensedDevBuild === true;

  return (
    <div className="col gap-16">
      {/* A build with no embedded public key grants everyone a perpetual
          licence. That is fine while developing and disastrous if shipped, so
          it is called out unmissably rather than left to be discovered later. */}
      {isDevBuild && (
        <div style={{
          padding: '14px 16px', borderRadius: 'var(--radius-lg)',
          background: 'var(--danger-bg)', border: '2px solid var(--danger)',
          color: '#b91c1c', lineHeight: 1.75,
        }}>
          <div className="bold" style={{ fontSize: 14.5, marginBottom: 6 }}>
            ⚠️ {t.license.devBuildTitle}
          </div>
          <div style={{ fontSize: 13 }}>{t.license.devBuildBody}</div>
          <div className="mono" style={{
            marginTop: 10, padding: '8px 10px', background: 'rgba(0,0,0,.06)',
            borderRadius: 'var(--radius-sm)', fontSize: 11.5, direction: 'ltr',
          }}>
            set ALAQSA_LICENSE_PUBKEY=&lt;public key&gt;<br />npm run package
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        {/* Current status */}
        <div className="card">
          <div className="card-head">
            <span className="card-title">📜 {t.license.currentStatus}</span>
            {badge()}
          </div>
          <div className="card-body col gap-10 small">
            <div className="row between">
              <span className="muted">{t.common.status}</span>
              <span className="bold">
                {state.status === 'valid'
                  ? (state.perpetual ? t.license.perpetual : t.license.timeLimited)
                  : t.license.notActive}
              </span>
            </div>
            {state.status === 'valid' && !state.perpetual && state.expiresAt && (
              <div className="row between">
                <span className="muted">{t.license.validUntil}</span>
                <span className="bold mono">{state.expiresAt.slice(0, 10)}</span>
              </div>
            )}
            {state.status === 'valid' && state.perpetual && (
              <div style={{
                padding: '10px 12px', background: 'var(--success-bg)',
                color: '#15803d', borderRadius: 'var(--radius)', lineHeight: 1.6,
              }}>
                ✅ {t.license.perpetualNote}
              </div>
            )}
            {daysLeft !== null && daysLeft <= 14 && (
              <div style={{
                padding: '10px 12px', background: 'var(--warning-bg)',
                color: '#b45309', borderRadius: 'var(--radius)', lineHeight: 1.6,
              }}>
                ⏳ {t.license.expiringSoonNote}
              </div>
            )}
          </div>
        </div>

        {/* Enter / upgrade a key */}
        <div className="card">
          <div className="card-head"><span className="card-title">🔑 {t.license.enterLicense}</span></div>
          <div className="card-body col gap-12">
            <p className="small muted" style={{ lineHeight: 1.7 }}>{t.license.upgradeHint}</p>
            <Field error={error || undefined}>
              <TextInput
                value={key}
                onChange={(v) => { setKey(v); setError(''); }}
                error={!!error}
                dir="ltr"
                placeholder="eyJwYXlsb2FkIjp7..."
                onKeyDown={(e) => { if (e.key === 'Enter') void activate(); }}
              />
            </Field>
            <button className="btn btn-primary" onClick={activate} disabled={busy || !key.trim()}>
              {busy ? <span className="spinner" /> : t.license.activate}
            </button>
          </div>
        </div>
      </div>

      {/* Developer contact */}
      <div className="card">
        <div className="card-head"><span className="card-title">📞 {t.license.contactDeveloper}</span></div>
        <div className="card-body col gap-6 small">
          <div className="row gap-8"><span>👤</span><span className="bold">{AUTHOR.nameAr}</span></div>
          <div className="row gap-8"><span>📱</span><span className="mono" dir="ltr">{AUTHOR.phone}</span></div>
          <div className="row gap-8"><span>✉️</span><span className="mono" dir="ltr">{AUTHOR.email}</span></div>
        </div>
      </div>
    </div>
  );
}
