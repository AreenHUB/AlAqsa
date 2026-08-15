// ============================================================================
// AlAqsa — Current session indicator + user switcher.
//
// The owner unlocks the machine once with the master password. Staff then
// switch to their own account from here using only THEIR password — they are
// never asked for the master password, which stays with the owner.
// ============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Modal, Field, TextInput, useToast } from './ui';
import type { SignInUser } from '@shared/ipc';

const ROLE_ICON: Record<string, string> = {
  admin: '👑', technician: '🛠', accountant: '💰', viewer: '👁',
};

export function SessionMenu({ onChanged }: { onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();

  const [current, setCurrent] = useState<(SignInUser & { isOwner?: boolean }) | null>(null);
  const [users, setUsers] = useState<SignInUser[]>([]);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState<SignInUser | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const [c, u] = await Promise.all([
      window.alaqsa.auth.currentUser(),
      window.alaqsa.auth.listUsers(),
    ]);
    if (c.ok) setCurrent(c.data as never);
    if (u.ok) setUsers(u.data);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const onOutside = (e: Event) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onOutside);
    return () => document.removeEventListener('click', onOutside);
  }, []);

  const signIn = async () => {
    if (!picking || !password) return;
    setBusy(true);
    setError('');
    const res = await window.alaqsa.auth.signIn(picking.id, password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error === 'USER_HAS_NO_PASSWORD' ? t.signIn.noPasswordSet : t.auth.wrongPassword);
      setPassword('');
      return;
    }
    setPicking(null);
    setPassword('');
    await refresh();
    onChanged();
    toast.success(`${t.signIn.signedInAs}: ${res.data.displayName}`);
  };

  const signOut = async () => {
    await window.alaqsa.auth.signOut();
    setOpen(false);
    await refresh();
    onChanged();
    toast.success(t.signIn.backToOwner);
  };

  const label = current?.isOwner ? t.signIn.owner : (current?.displayName ?? '—');
  const icon = current?.isOwner ? '👑' : (ROLE_ICON[current?.role ?? ''] ?? '👤');

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => setOpen((v) => !v)}
        title={t.signIn.signedInAs}
      >
        {icon} <span className="truncate" style={{ maxWidth: 110 }}>{label}</span>
      </button>

      {open && (
        <div className="menubar-dropdown" style={{ insetInlineStart: 'auto', insetInlineEnd: 0, minWidth: 240 }}>
          <div className="tiny muted" style={{ padding: '6px 11px' }}>
            {t.signIn.signedInAs}: <span className="bold">{label}</span>
          </div>
          <div className="menubar-sep" />

          {users.length === 0 ? (
            <div className="tiny faint" style={{ padding: '8px 11px', lineHeight: 1.6 }}>
              {t.signIn.noStaffYet}
            </div>
          ) : (
            users.map((u) => (
              <button
                key={u.id}
                className="menubar-item"
                onClick={() => { setOpen(false); setPicking(u); setError(''); }}
                disabled={current?.id === u.id}
              >
                <span>{ROLE_ICON[u.role] ?? '👤'} {u.displayName}</span>
                <span className="menubar-shortcut">{t.settings.roles[u.role]}</span>
              </button>
            ))
          )}

          {!current?.isOwner && (
            <>
              <div className="menubar-sep" />
              <button className="menubar-item" onClick={signOut}>
                <span>👑 {t.signIn.backToOwner}</span>
              </button>
            </>
          )}
        </div>
      )}

      <Modal
        open={!!picking}
        title={picking?.displayName ?? ''}
        onClose={() => { setPicking(null); setPassword(''); setError(''); }}
        size="sm"
        onSubmit={signIn}
        footer={
          <>
            <button className="btn btn-outline"
              onClick={() => { setPicking(null); setPassword(''); }}>{t.common.cancel}</button>
            <button className="btn btn-primary" onClick={signIn} disabled={busy || !password}>
              {busy ? <span className="spinner" /> : t.signIn.enter}
            </button>
          </>
        }
      >
        <div className="col gap-12">
          <div className="row gap-10" style={{
            padding: 12, background: 'var(--surface-2)',
            borderRadius: 'var(--radius)', border: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 22 }}>{ROLE_ICON[picking?.role ?? ''] ?? '👤'}</span>
            <div className="col">
              <span className="bold">{picking?.displayName}</span>
              <span className="tiny muted">{picking && t.settings.roles[picking.role]}</span>
            </div>
          </div>
          <Field label={t.signIn.password} required error={error || undefined}>
            <TextInput type="password" value={password}
              onChange={(v) => { setPassword(v); setError(''); }}
              error={!!error} autoFocus placeholder="••••••••" />
          </Field>
          <p className="tiny faint" style={{ lineHeight: 1.6 }}>{t.signIn.staffPasswordHint}</p>
        </div>
      </Modal>
    </div>
  );
}
