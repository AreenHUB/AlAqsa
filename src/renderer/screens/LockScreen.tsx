// ============================================================================
// AlAqsa — Unlock screen. Supports the master password and, as a fallback,
// the recovery key (the revocable "always works" path).
// ============================================================================

import React, { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Field, TextInput } from '../components/ui';
import { AuthShell } from './AuthShell';

export function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'password' | 'recovery'>('password');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!value.trim()) return;
    setBusy(true);
    setError('');

    const res = mode === 'password'
      ? await window.alaqsa.auth.unlock(value)
      : await window.alaqsa.auth.unlockWithRecovery(value);

    setBusy(false);

    if (!res.ok) {
      setError(mode === 'password' ? t.auth.wrongPassword : t.auth.wrongRecoveryKey);
      setValue('');
      return;
    }
    onUnlocked();
  };

  const switchMode = (next: 'password' | 'recovery') => {
    setMode(next);
    setValue('');
    setError('');
  };

  return (
    <AuthShell title={t.auth.unlockTitle} subtitle={t.auth.unlockIntro}>
      <div className="col gap-16">
        {/* Either the daily or the master password opens the app, so the field
            is labelled neutrally — staff must not be told to enter the
            owner's secret. */}
        <Field
          label={mode === 'password' ? t.auth.password : t.auth.recoveryKey}
          error={error || undefined}
        >
          <TextInput
            type={mode === 'password' ? 'password' : 'text'}
            value={value}
            onChange={(v) => { setValue(v); setError(''); }}
            autoFocus
            error={!!error}
            placeholder={mode === 'password' ? '••••••••' : 'ALQ-XXXX-XXXX-XXXX-XXXX-XXXX'}
            dir={mode === 'recovery' ? 'ltr' : undefined}
            className={`input ${mode === 'recovery' ? 'mono' : ''} ${error ? 'invalid' : ''}`}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          />
        </Field>

        <button className="btn btn-primary btn-lg btn-block" onClick={submit} disabled={busy || !value.trim()}>
          {busy ? <span className="spinner" /> : `🔓 ${t.auth.unlock}`}
        </button>

        <div className="text-center">
          {mode === 'password' ? (
            <button className="btn btn-ghost btn-sm" onClick={() => switchMode('recovery')}>
              {t.auth.forgotPassword} {t.auth.useRecoveryKey}
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => switchMode('password')}>
              ← {t.auth.usePassword}
            </button>
          )}
        </div>
      </div>
    </AuthShell>
  );
}
