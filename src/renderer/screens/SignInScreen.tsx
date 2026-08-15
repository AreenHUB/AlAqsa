// ============================================================================
// AlAqsa — "Who are you?" screen.
//
// Shown after the database is unlocked, when the shop has configured users.
// The master password protects the DATA (it is the encryption key); this step
// decides what the person sitting at the machine is allowed to do.
// ============================================================================

import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Field, TextInput, Loading } from '../components/ui';
import { AuthShell } from './AuthShell';
import type { SignInUser } from '@shared/ipc';

const ROLE_ICON: Record<string, string> = {
  admin: '👑',
  technician: '🛠',
  accountant: '💰',
  viewer: '👁',
};

export function SignInScreen({
  onSignedIn, onSkip,
}: {
  onSignedIn: () => void;
  /** Continue without signing in (single-operator mode). */
  onSkip: () => void;
}) {
  const { t } = useI18n();
  const [users, setUsers] = useState<SignInUser[] | null>(null);
  const [selected, setSelected] = useState<SignInUser | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.alaqsa.auth.listUsers().then((res) => {
      const list = res.ok ? res.data : [];
      setUsers(list);
      // Nothing configured: this screen has nothing to ask, so step aside.
      if (list.length === 0) onSkip();
    });
  }, [onSkip]);

  const submit = async () => {
    if (!selected || !password) return;
    setBusy(true);
    setError('');
    const res = await window.alaqsa.auth.signIn(selected.id, password);
    setBusy(false);
    if (!res.ok) {
      setError(
        res.error === 'USER_HAS_NO_PASSWORD' ? t.signIn.noPasswordSet : t.auth.wrongPassword,
      );
      setPassword('');
      return;
    }
    onSignedIn();
  };

  if (users === null) {
    return <AuthShell title={t.common.loading}><Loading /></AuthShell>;
  }

  // ---- Step 2: password for the chosen user -------------------------------
  if (selected) {
    return (
      <AuthShell title={t.signIn.title} subtitle={selected.displayName}>
        <div className="col gap-16">
          <div className="row gap-12" style={{
            padding: 13, background: 'var(--surface-2)',
            borderRadius: 'var(--radius)', border: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 26 }}>{ROLE_ICON[selected.role] ?? '👤'}</span>
            <div className="col">
              <span className="bold">{selected.displayName}</span>
              <span className="tiny muted">{t.settings.roles[selected.role]}</span>
            </div>
          </div>

          <Field label={t.signIn.password} required error={error || undefined}>
            <TextInput
              type="password"
              value={password}
              onChange={(v) => { setPassword(v); setError(''); }}
              error={!!error}
              autoFocus
              placeholder="••••••••"
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            />
          </Field>

          <button className="btn btn-primary btn-lg btn-block"
            onClick={submit} disabled={busy || !password}>
            {busy ? <span className="spinner" /> : t.signIn.enter}
          </button>

          <button className="btn btn-ghost btn-sm"
            onClick={() => { setSelected(null); setPassword(''); setError(''); }}>
            ← {t.signIn.changeUser}
          </button>
        </div>
      </AuthShell>
    );
  }

  // ---- Step 1: pick a user ------------------------------------------------
  return (
    <AuthShell title={t.signIn.title} subtitle={t.signIn.subtitle} wide>
      <div className="col gap-10">
        {users.map((u) => (
          <button
            key={u.id}
            className="row gap-12"
            onClick={() => setSelected(u)}
            style={{
              padding: '13px 15px', width: '100%', textAlign: 'start',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
              background: 'var(--surface)', cursor: 'pointer',
              fontFamily: 'inherit', color: 'var(--text)',
              transition: 'border-color 140ms, background 140ms',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--primary-500)';
              e.currentTarget.style.background = 'var(--surface-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.background = 'var(--surface)';
            }}
          >
            <span style={{ fontSize: 24 }}>{ROLE_ICON[u.role] ?? '👤'}</span>
            <span className="col grow">
              <span className="bold">{u.displayName}</span>
              <span className="tiny muted">{t.settings.roles[u.role]}</span>
            </span>
            <span className="faint">←</span>
          </button>
        ))}

        <hr className="divider" />

        <button className="btn btn-ghost btn-sm" onClick={onSkip}>
          {t.signIn.continueAsOwner}
        </button>
        <p className="tiny faint text-center" style={{ lineHeight: 1.6 }}>
          {t.signIn.ownerHint}
        </p>
      </div>
    </AuthShell>
  );
}
