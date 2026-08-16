// ============================================================================
// AlAqsa — Owner-mode indicator.
//
// The shop opens the app with the shared DAILY password. Owner-only settings
// (reset, changing the passwords, making this PC the host) additionally need
// the MASTER password, which only the owner knows.
//
// This badge shows which of the two is in effect, and lets the owner authorise
// himself without locking and reopening the app. It replaces the staff-account
// switcher while user accounts are switched off.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Modal, Field, TextInput, useToast } from './ui';

export function OwnerBadge({ onChanged }: { onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();

  const [isOwner, setIsOwner] = useState(false);
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await window.alaqsa.auth.sessionInfo();
    if (res.ok) setIsOwner(res.data.isOwner);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const elevate = async () => {
    if (!password) return;
    setBusy(true);
    setError('');
    const res = await window.alaqsa.auth.elevate(password);
    setBusy(false);
    if (!res.ok) {
      setError(t.auth.wrongPassword);
      setPassword('');
      return;
    }
    setAsking(false);
    setPassword('');
    await refresh();
    onChanged();
    toast.success(t.session.ownerModeOn);
  };

  const stepDown = async () => {
    await window.alaqsa.auth.dropOwner();
    await refresh();
    onChanged();
    toast.success(t.session.ownerModeOff);
  };

  if (isOwner) {
    return (
      <button
        className="btn btn-ghost btn-sm"
        onClick={stepDown}
        title={t.session.ownerModeHint}
        style={{ color: 'var(--warning-text, inherit)' }}
      >
        👑 <span className="truncate" style={{ maxWidth: 120 }}>{t.session.ownerMode}</span>
      </button>
    );
  }

  return (
    <>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => { setAsking(true); setError(''); }}
        title={t.session.elevateHint}
      >
        🔓 <span className="truncate" style={{ maxWidth: 120 }}>{t.session.dailyMode}</span>
      </button>

      <Modal
        open={asking}
        title={t.session.elevateTitle}
        onClose={() => { setAsking(false); setPassword(''); setError(''); }}
        size="sm"
        onSubmit={elevate}
        footer={
          <>
            <button className="btn btn-outline"
              onClick={() => { setAsking(false); setPassword(''); }}>{t.common.cancel}</button>
            <button className="btn btn-primary" onClick={elevate} disabled={busy || !password}>
              {busy ? <span className="spinner" /> : t.session.elevateConfirm}
            </button>
          </>
        }
      >
        <div className="col gap-12">
          <p className="small muted" style={{ lineHeight: 1.7 }}>{t.session.elevateExplain}</p>
          <Field label={t.auth.masterPassword} required error={error || undefined}>
            <TextInput type="password" value={password}
              onChange={(v) => { setPassword(v); setError(''); }}
              error={!!error} autoFocus placeholder="••••••••" />
          </Field>
        </div>
      </Modal>
    </>
  );
}
