// ============================================================================
// AlAqsa — First-run setup: create the master password, then show the recovery
// key exactly once. The user must confirm they saved it before continuing.
// ============================================================================

import React, { useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Field, TextInput, Checkbox, useToast } from '../components/ui';
import { AuthShell } from './AuthShell';

export function FirstRunScreen({ onDone }: { onDone: () => void }) {
  const { t, lang, setLang } = useI18n();
  const toast = useToast();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const submit = async () => {
    setError('');
    if (password.length < 6) return setError(t.auth.passwordTooShort);
    if (password !== confirm) return setError(t.auth.passwordMismatch);

    setBusy(true);
    const res = await window.alaqsa.auth.firstRunSetup(password, lang);
    setBusy(false);

    if (!res.ok) {
      setError(res.error === 'PASSWORD_TOO_SHORT' ? t.auth.passwordTooShort : res.error);
      return;
    }
    setRecoveryKey(res.data.recoveryKey);
  };

  const copyKey = async () => {
    if (!recoveryKey) return;
    await navigator.clipboard.writeText(recoveryKey);
    toast.success(t.common.copied);
  };

  const printKey = () => {
    if (!recoveryKey) return;
    const w = window.open('', '_blank', 'width=620,height=460');
    if (!w) return;
    w.document.write(`
      <html dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><title>${t.auth.recoveryKey}</title>
      <style>
        body { font-family: Tahoma, Arial, sans-serif; padding: 40px; }
        h1 { color: #0B4F8A; font-size: 20px; }
        .key { font-family: Consolas, monospace; font-size: 22px; letter-spacing: 2px;
               padding: 20px; border: 2px dashed #0B4F8A; border-radius: 10px;
               text-align: center; margin: 24px 0; direction: ltr; }
        .warn { background: #fdecec; color: #b91c1c; padding: 14px; border-radius: 8px;
                font-size: 13px; line-height: 1.7; }
        .meta { color: #666; font-size: 12px; margin-top: 24px; }
      </style></head><body>
      <h1>${t.appName} — ${t.auth.recoveryKeyTitle}</h1>
      <div class="key">${recoveryKey}</div>
      <div class="warn">${t.auth.recoveryKeyWarning}</div>
      <div class="meta">${new Date().toLocaleString()}</div>
      </body></html>`);
    w.document.close();
    w.print();
  };

  // ---- Step 2: show the recovery key -------------------------------------
  if (recoveryKey) {
    return (
      <AuthShell title={t.auth.recoveryKeyTitle}>
        <div className="col gap-16">
          <div style={{
            padding: '14px 16px', borderRadius: 'var(--radius)',
            background: 'var(--danger-bg)', color: '#b91c1c',
            fontSize: 13, lineHeight: 1.75, fontWeight: 600,
          }}>
            ⚠ {t.auth.recoveryKeyWarning}
          </div>

          <div className="mono" style={{
            padding: '20px 16px', border: '2px dashed var(--primary-500)',
            borderRadius: 'var(--radius-lg)', background: 'var(--primary-50)',
            fontSize: 20, letterSpacing: 2, textAlign: 'center',
            color: 'var(--primary-700)', direction: 'ltr', fontWeight: 700,
            userSelect: 'all', wordBreak: 'break-all',
          }}>
            {recoveryKey}
          </div>

          <div className="row gap-8">
            <button className="btn btn-outline grow" onClick={copyKey}>📋 {t.common.copy}</button>
            <button className="btn btn-outline grow" onClick={printKey}>🖨 {t.auth.printKey}</button>
          </div>

          <Checkbox
            checked={acknowledged}
            onChange={setAcknowledged}
            label={t.auth.recoveryKeySaved}
          />

          <button
            className="btn btn-primary btn-lg btn-block"
            disabled={!acknowledged}
            onClick={onDone}
          >
            {t.auth.continue} →
          </button>
        </div>
      </AuthShell>
    );
  }

  // ---- Step 1: create the master password ---------------------------------
  return (
    <AuthShell title={t.auth.firstRunTitle} subtitle={t.auth.firstRunIntro}>
      <div className="col gap-16">
        <Field label={t.auth.masterPassword} required>
          <TextInput
            type="password"
            value={password}
            onChange={setPassword}
            autoFocus
            placeholder="••••••••"
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          />
        </Field>

        <Field label={t.auth.confirmPassword} required error={error || undefined}>
          <TextInput
            type="password"
            value={confirm}
            onChange={setConfirm}
            placeholder="••••••••"
            error={!!error}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          />
        </Field>

        <button className="btn btn-primary btn-lg btn-block" onClick={submit} disabled={busy}>
          {busy ? <span className="spinner" /> : t.auth.createAndStart}
        </button>

        <div className="row center gap-8 small">
          <button className="btn btn-ghost btn-sm" onClick={() => setLang('ar')}
            style={{ fontWeight: lang === 'ar' ? 800 : 500 }}>العربية</button>
          <span className="faint">|</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setLang('en')}
            style={{ fontWeight: lang === 'en' ? 800 : 500 }}>English</button>
        </div>
      </div>
    </AuthShell>
  );
}
