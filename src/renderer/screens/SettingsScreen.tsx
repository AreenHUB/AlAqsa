// ============================================================================
// AlAqsa — Settings: appearance, security, status colors, LAN sharing, backup,
// demo data, factory reset, users and the audit log.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import {
  Modal, Field, TextInput, Select, Tabs, Loading, Badge,
  ConfirmDialog, useToast, EmptyState, fmtDate,
} from '../components/ui';
import type { StatusLabel, AppUser, AuditEntry } from '@shared/types';

export function SettingsScreen({ onLock }: { onLock: () => void }) {
  const { t, lang, setLang } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState('general');

  const tabs = [
    { id: 'general', label: t.settings.general },
    { id: 'security', label: t.settings.security },
    { id: 'labels', label: t.settings.statusLabels },
    { id: 'network', label: t.settings.network },
    { id: 'data', label: t.settings.dataManagement },
    { id: 'users', label: t.settings.users },
    { id: 'audit', label: t.settings.auditLog },
  ];

  return (
    <div className="col gap-16 fade-in">
      <div>
        <h1 style={{ fontSize: 22 }}>{t.settings.title}</h1>
      </div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'general' && <GeneralTab />}
      {tab === 'security' && <SecurityTab onLock={onLock} />}
      {tab === 'labels' && <LabelsTab />}
      {tab === 'network' && <NetworkTab />}
      {tab === 'data' && <DataTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
function GeneralTab() {
  const { t, lang, setLang } = useI18n();
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('alaqsa.theme') as 'light' | 'dark') ?? 'light',
  );

  const applyTheme = (next: 'light' | 'dark') => {
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('alaqsa.theme', next);
    void window.alaqsa.settings.setTheme(next);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
      <div className="card">
        <div className="card-head"><span className="card-title">🌐 {t.settings.language}</span></div>
        <div className="card-body row gap-8">
          <button className={`btn grow ${lang === 'ar' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setLang('ar')}>العربية</button>
          <button className={`btn grow ${lang === 'en' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setLang('en')}>English</button>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><span className="card-title">🎨 {t.settings.theme}</span></div>
        <div className="card-body row gap-8">
          <button className={`btn grow ${theme === 'light' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => applyTheme('light')}>☀️ {t.settings.light}</button>
          <button className={`btn grow ${theme === 'dark' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => applyTheme('dark')}>🌙 {t.settings.dark}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function SecurityTab({ onLock }: { onLock: () => void }) {
  const { t } = useI18n();
  const toast = useToast();

  const [pwOpen, setPwOpen] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [recPassword, setRecPassword] = useState('');
  const [newRecoveryKey, setNewRecoveryKey] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const changePassword = async () => {
    const e: Record<string, string> = {};
    if (newPw.length < 6) e.newPw = t.auth.passwordTooShort;
    if (newPw !== confirmPw) e.confirmPw = t.auth.passwordMismatch;
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    const res = await window.alaqsa.auth.changePassword(oldPw, newPw);
    setBusy(false);
    if (!res.ok) return setErrors({ oldPw: t.auth.wrongPassword });
    toast.success(t.msg.updated);
    setPwOpen(false);
    setOldPw(''); setNewPw(''); setConfirmPw('');
  };

  const regenerate = async () => {
    setBusy(true);
    const res = await window.alaqsa.auth.regenerateRecoveryKey(recPassword);
    setBusy(false);
    if (!res.ok) return setErrors({ recPassword: t.auth.wrongPassword });
    setNewRecoveryKey(res.data.recoveryKey);
    setRecPassword('');
  };

  return (
    <div className="col gap-16">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <div className="card">
          <div className="card-head"><span className="card-title">🔑 {t.auth.changePassword}</span></div>
          <div className="card-body col gap-10">
            <p className="small muted">{t.auth.firstRunIntro}</p>
            <button className="btn btn-primary" onClick={() => { setErrors({}); setPwOpen(true); }}>
              {t.auth.changePassword}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><span className="card-title">🗝 {t.auth.recoveryKey}</span></div>
          <div className="card-body col gap-10">
            <p className="small muted">{t.auth.regenerateWarning}</p>
            <button className="btn btn-outline" onClick={() => { setErrors({}); setNewRecoveryKey(''); setRecOpen(true); }}>
              {t.auth.regenerateRecovery}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><span className="card-title">🔒 {t.auth.lock}</span></div>
          <div className="card-body col gap-10">
            <p className="small muted">Ctrl+L</p>
            <button className="btn btn-outline" onClick={async () => {
              await window.alaqsa.auth.lock();
              onLock();
            }}>{t.auth.lock}</button>
          </div>
        </div>
      </div>

      <Modal
        open={pwOpen}
        title={t.auth.changePassword}
        onClose={() => setPwOpen(false)}
        size="sm"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setPwOpen(false)}>{t.common.cancel}</button>
            <button className="btn btn-primary" onClick={changePassword} disabled={busy}>
              {busy ? <span className="spinner" /> : t.common.save}
            </button>
          </>
        }
      >
        <div className="col gap-12">
          <Field label={t.auth.currentPassword} required error={errors.oldPw}>
            <TextInput type="password" value={oldPw} onChange={setOldPw} error={!!errors.oldPw} />
          </Field>
          <Field label={t.auth.newPassword} required error={errors.newPw}>
            <TextInput type="password" value={newPw} onChange={setNewPw} error={!!errors.newPw} />
          </Field>
          <Field label={t.auth.confirmPassword} required error={errors.confirmPw}>
            <TextInput type="password" value={confirmPw} onChange={setConfirmPw} error={!!errors.confirmPw} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={recOpen}
        title={t.auth.regenerateRecovery}
        onClose={() => { setRecOpen(false); setNewRecoveryKey(''); }}
        size="sm"
        footer={
          newRecoveryKey ? (
            <button className="btn btn-primary" onClick={() => { setRecOpen(false); setNewRecoveryKey(''); }}>
              {t.common.close}
            </button>
          ) : (
            <>
              <button className="btn btn-outline" onClick={() => setRecOpen(false)}>{t.common.cancel}</button>
              <button className="btn btn-primary" onClick={regenerate} disabled={busy || !recPassword}>
                {busy ? <span className="spinner" /> : t.common.confirm}
              </button>
            </>
          )
        }
      >
        {newRecoveryKey ? (
          <div className="col gap-12">
            <div style={{
              padding: '12px 14px', borderRadius: 'var(--radius)',
              background: 'var(--danger-bg)', color: '#b91c1c',
              fontSize: 12.5, lineHeight: 1.7, fontWeight: 600,
            }}>
              ⚠ {t.auth.recoveryKeyWarning}
            </div>
            <div className="mono" style={{
              padding: 16, border: '2px dashed var(--primary-500)',
              borderRadius: 'var(--radius-lg)', background: 'var(--primary-50)',
              fontSize: 17, letterSpacing: 1.5, textAlign: 'center',
              color: 'var(--primary-700)', direction: 'ltr', fontWeight: 700,
              userSelect: 'all', wordBreak: 'break-all',
            }}>{newRecoveryKey}</div>
            <button className="btn btn-outline" onClick={async () => {
              await navigator.clipboard.writeText(newRecoveryKey);
              toast.success(t.common.copied);
            }}>📋 {t.common.copy}</button>
          </div>
        ) : (
          <div className="col gap-12">
            <div style={{
              padding: '11px 13px', borderRadius: 'var(--radius)',
              background: 'var(--warning-bg)', color: '#b45309', fontSize: 12.5, lineHeight: 1.65,
            }}>
              ⚠ {t.auth.regenerateWarning}
            </div>
            <Field label={t.auth.masterPassword} required error={errors.recPassword}>
              <TextInput type="password" value={recPassword} onChange={setRecPassword}
                error={!!errors.recPassword} autoFocus />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
function LabelsTab() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [labels, setLabels] = useState<StatusLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<StatusLabel | null>(null);
  const [open, setOpen] = useState(false);
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [color, setColor] = useState('#1E88E5');

  const load = useCallback(async () => {
    const res = await window.alaqsa.statusLabels.list();
    if (res.ok) setLabels(res.data);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openForm = (l: StatusLabel | null) => {
    setEditing(l);
    setNameAr(l?.name_ar ?? '');
    setNameEn(l?.name_en ?? '');
    setColor(l?.color ?? '#1E88E5');
    setOpen(true);
  };

  const save = async () => {
    if (!nameAr.trim()) return toast.warning(t.validation.required);
    const res = await window.alaqsa.statusLabels.save({
      id: editing?.id, name_ar: nameAr.trim(), name_en: nameEn.trim() || nameAr.trim(), color,
    });
    if (!res.ok) return toast.error(res.error);
    toast.success(t.msg.saved);
    setOpen(false);
    void load();
  };

  const remove = async (l: StatusLabel) => {
    const res = await window.alaqsa.statusLabels.remove(l.id);
    if (res.ok) { toast.success(t.msg.deleted); void load(); }
  };

  if (loading) return <Loading />;

  return (
    <div className="col gap-12">
      <div className="row between">
        <span className="muted small">{labels.length} {t.settings.statusLabels}</span>
        <button className="btn btn-primary btn-sm" onClick={() => openForm(null)}>
          + {t.settings.newLabel}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
        {labels.map((l) => (
          <div key={l.id} className="card" style={{ position: 'relative' }}>
            <div className="status-strip" style={{ background: l.color }} />
            <div className="card-body row between gap-8" style={{ paddingInlineStart: 18 }}>
              <div className="col">
                <span className="bold">{lang === 'ar' ? l.name_ar : l.name_en}</span>
                <span className="tiny muted mono" dir="ltr">{l.color}</span>
                {l.isSystem && <span className="tiny faint">{t.settings.systemLabel}</span>}
              </div>
              <div className="row gap-4">
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => openForm(l)}>✏️</button>
                {!l.isSystem && (
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(l)}>🗑</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={open}
        title={editing ? t.common.edit : t.settings.newLabel}
        onClose={() => setOpen(false)}
        size="sm"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setOpen(false)}>{t.common.cancel}</button>
            <button className="btn btn-primary" onClick={save}>{t.common.save}</button>
          </>
        }
      >
        <div className="col gap-12">
          <Field label={t.settings.labelNameAr} required>
            <TextInput value={nameAr} onChange={setNameAr} autoFocus />
          </Field>
          <Field label={t.settings.labelNameEn}>
            <TextInput value={nameEn} onChange={setNameEn} dir="ltr" />
          </Field>
          <Field label={t.settings.color}>
            <div className="row gap-8">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                style={{ width: 52, height: 38, border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer' }} />
              <TextInput value={color} onChange={setColor} dir="ltr" />
            </div>
          </Field>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
function NetworkTab() {
  const { t } = useI18n();
  const toast = useToast();
  const [mode, setMode] = useState<'standalone' | 'host' | 'client'>('standalone');
  const [hostAddress, setHostAddress] = useState<string | undefined>();
  const [hosts, setHosts] = useState<{ name: string; address: string; port: number }[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    const res = await window.alaqsa.network.getMode();
    if (res.ok) { setMode(res.data.mode); setHostAddress(res.data.hostAddress); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const makeHost = async () => {
    const res = await window.alaqsa.network.setHost();
    if (!res.ok) return toast.error(res.error);
    toast.success(t.msg.saved);
    void load();
  };

  const discover = async () => {
    setSearching(true);
    setHosts([]);
    const res = await window.alaqsa.network.discover();
    setSearching(false);
    if (!res.ok) return toast.error(res.error);
    setHosts(res.data);
    if (res.data.length === 0) toast.warning(t.settings.noHostsFound);
  };

  const connect = async (address: string, port: number) => {
    const res = await window.alaqsa.network.connect(address, port);
    if (!res.ok) return toast.error(res.error);
    toast.success(t.settings.connected);
    void load();
  };

  const disconnect = async () => {
    const res = await window.alaqsa.network.disconnect();
    if (!res.ok) return toast.error(res.error);
    toast.success(t.msg.saved);
    void load();
  };

  return (
    <div className="col gap-16">
      <div className="card">
        <div className="card-head">
          <span className="card-title">🖧 {t.settings.networkMode}</span>
          <Badge kind={mode === 'standalone' ? 'neutral' : 'success'}>
            {mode === 'standalone' ? t.settings.standalone
              : mode === 'host' ? t.settings.host : t.settings.client}
          </Badge>
        </div>
        <div className="card-body col gap-12">
          <p className="small muted">{t.settings.networkHint}</p>
          {hostAddress && mode === 'client' && (
            <div className="small mono" dir="ltr">🔗 {hostAddress}</div>
          )}
          <div className="row gap-8 wrap">
            {mode !== 'host' && (
              <button className="btn btn-primary" onClick={makeHost}>
                🖥 {t.settings.makeThisHost}
              </button>
            )}
            {mode !== 'client' && (
              <button className="btn btn-outline" onClick={discover} disabled={searching}>
                {searching ? <span className="spinner" /> : `🔍 ${t.settings.discoverHosts}`}
              </button>
            )}
            {mode !== 'standalone' && (
              <button className="btn btn-outline" onClick={disconnect}>
                ✕ {t.settings.disconnect}
              </button>
            )}
          </div>

          {hosts.length > 0 && (
            <div className="col gap-6 mt-8">
              {hosts.map((h) => (
                <div key={`${h.address}:${h.port}`} className="row between"
                  style={{ padding: 10, background: 'var(--surface-2)', borderRadius: 'var(--radius)' }}>
                  <div className="col">
                    <span className="small bold">{h.name}</span>
                    <span className="tiny mono muted" dir="ltr">{h.address}:{h.port}</span>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={() => connect(h.address, h.port)}>
                    {t.settings.connect}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function DataTab() {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState('');

  const backupNow = async () => {
    setBusy('backup');
    const res = await window.alaqsa.backup.now();
    setBusy('');
    if (!res.ok) return toast.error(res.error);
    toast.success(`${t.settings.backupCreated}: ${res.data.path}`);
  };

  const exportBackup = async () => {
    setBusy('export');
    const res = await window.alaqsa.backup.exportEncrypted();
    setBusy('');
    if (!res.ok) { if (res.error !== 'CANCELLED') toast.error(res.error); return; }
    toast.success(`${t.settings.backupCreated}: ${res.data.path}`);
  };

  const restore = async () => {
    const picked = await window.alaqsa.files.pickOpen([{ name: 'AlAqsa Backup', extensions: ['db'] }]);
    if (!picked.ok || !picked.data) return;
    setBusy('restore');
    const res = await window.alaqsa.backup.restore(picked.data);
    setBusy('');
    if (!res.ok) return toast.error(res.error);
    toast.success(t.msg.updated);
  };

  const seedDemo = async () => {
    setBusy('seed');
    const res = await window.alaqsa.app.seedDemoData();
    setBusy('');
    if (!res.ok) return toast.error(res.error);
    toast.success(res.data.clients > 0 ? t.settings.seedDone : t.settings.seedSkipped);
  };

  const factoryReset = async () => {
    if (!resetPassword) return setResetError(t.validation.required);
    setBusy('reset');
    const res = await window.alaqsa.backup.factoryReset(resetPassword);
    setBusy('');
    if (!res.ok) {
      setResetError(res.error === 'WRONG_PASSWORD' ? t.auth.wrongPassword : res.error);
      return;
    }
    setResetOpen(false);
    setResetPassword('');
    toast.success(t.settings.factoryResetDone);
  };

  return (
    <div className="col gap-16">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <div className="card">
          <div className="card-head"><span className="card-title">💾 {t.settings.backup}</span></div>
          <div className="card-body col gap-8">
            <button className="btn btn-primary" onClick={backupNow} disabled={!!busy}>
              {busy === 'backup' ? <span className="spinner" /> : `💾 ${t.settings.backupNow}`}
            </button>
            <button className="btn btn-outline" onClick={exportBackup} disabled={!!busy}>
              📤 {t.settings.exportBackup}
            </button>
            <button className="btn btn-outline" onClick={restore} disabled={!!busy}>
              📥 {t.settings.restoreBackup}
            </button>
            <p className="tiny muted">{t.settings.restoreWarning}</p>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><span className="card-title">🧪 {t.settings.seedDemo}</span></div>
          <div className="card-body col gap-8">
            <p className="small muted">{t.settings.seedDemoHint}</p>
            <button className="btn btn-outline" onClick={seedDemo} disabled={!!busy}>
              {busy === 'seed' ? <span className="spinner" /> : `+ ${t.settings.seedDemo}`}
            </button>
          </div>
        </div>

        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <div className="card-head" style={{ background: 'var(--danger-bg)' }}>
            <span className="card-title" style={{ color: '#b91c1c' }}>⚠️ {t.settings.factoryReset}</span>
          </div>
          <div className="card-body col gap-8">
            <p className="small muted">{t.settings.factoryResetHint}</p>
            <button className="btn btn-danger" onClick={() => { setResetError(''); setResetOpen(true); }}>
              🗑 {t.settings.factoryReset}
            </button>
          </div>
        </div>
      </div>

      <Modal
        open={resetOpen}
        title={t.settings.factoryReset}
        onClose={() => { setResetOpen(false); setResetPassword(''); }}
        size="sm"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => { setResetOpen(false); setResetPassword(''); }}>
              {t.common.cancel}
            </button>
            <button className="btn btn-danger" onClick={factoryReset} disabled={busy === 'reset'}>
              {busy === 'reset' ? <span className="spinner" /> : `🗑 ${t.common.delete}`}
            </button>
          </>
        }
      >
        <div className="col gap-14">
          <div style={{
            padding: '13px 15px', borderRadius: 'var(--radius)',
            background: 'var(--danger-bg)', color: '#b91c1c',
            fontSize: 13, lineHeight: 1.75, fontWeight: 700,
          }}>
            ⚠️ {t.settings.factoryResetWarning}
          </div>
          <p className="small muted" style={{ lineHeight: 1.7 }}>{t.settings.factoryResetConfirm}</p>
          <Field label={t.auth.masterPassword} required error={resetError || undefined}>
            <TextInput type="password" value={resetPassword}
              onChange={(v) => { setResetPassword(v); setResetError(''); }}
              error={!!resetError} autoFocus />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
function UsersTab() {
  const { t } = useI18n();
  const toast = useToast();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('viewer');
  const [password, setPassword] = useState('');

  const load = useCallback(async () => {
    const res = await window.alaqsa.users.list();
    if (res.ok) setUsers(res.data);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openForm = (u: AppUser | null) => {
    setEditing(u);
    setUsername(u?.username ?? '');
    setDisplayName(u?.displayName ?? '');
    setRole(u?.role ?? 'viewer');
    setPassword('');
    setOpen(true);
  };

  const save = async () => {
    if (!username.trim() || !displayName.trim()) return toast.warning(t.validation.required);
    const res = await window.alaqsa.users.save(
      { id: editing?.id, username: username.trim(), displayName: displayName.trim(), role: role as AppUser['role'], active: true },
      password || undefined,
    );
    if (!res.ok) return toast.error(res.error);
    toast.success(t.msg.saved);
    setOpen(false);
    void load();
  };

  const remove = async (u: AppUser) => {
    const res = await window.alaqsa.users.remove(u.id);
    if (res.ok) { toast.success(t.msg.deleted); void load(); }
  };

  if (loading) return <Loading />;

  return (
    <div className="col gap-12">
      <div className="row between">
        <span className="muted small">{users.length} {t.settings.users}</span>
        <button className="btn btn-primary btn-sm" onClick={() => openForm(null)}>
          + {t.settings.newUser}
        </button>
      </div>

      {users.length === 0 ? (
        <EmptyState icon="👤" title={t.common.noData}
          action={<button className="btn btn-primary" onClick={() => openForm(null)}>
            + {t.settings.newUser}</button>} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.settings.username}</th>
                <th>{t.settings.displayName}</th>
                <th>{t.settings.role}</th>
                <th>{t.settings.active}</th>
                <th style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="mono small" dir="ltr">{u.username}</td>
                  <td className="small bold">{u.displayName}</td>
                  <td><Badge kind="info">{t.settings.roles[u.role]}</Badge></td>
                  <td>{u.active ? '✓' : '✕'}</td>
                  <td>
                    <div className="cell-actions">
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => openForm(u)}>✏️</button>
                      <button className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(u)}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        title={editing ? t.common.edit : t.settings.newUser}
        onClose={() => setOpen(false)}
        size="sm"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setOpen(false)}>{t.common.cancel}</button>
            <button className="btn btn-primary" onClick={save}>{t.common.save}</button>
          </>
        }
      >
        <div className="col gap-12">
          <Field label={t.settings.username} required>
            <TextInput value={username} onChange={setUsername} dir="ltr" autoFocus />
          </Field>
          <Field label={t.settings.displayName} required>
            <TextInput value={displayName} onChange={setDisplayName} />
          </Field>
          <Field label={t.settings.role}>
            <Select
              value={role}
              onChange={setRole}
              options={Object.entries(t.settings.roles).map(([k, v]) => ({ value: k, label: v as string }))}
            />
          </Field>
          <Field label={t.auth.masterPassword} hint={editing ? t.common.optional : undefined}>
            <TextInput type="password" value={password} onChange={setPassword} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
function AuditTab() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void window.alaqsa.audit.recent(300).then((res) => {
      if (res.ok) setEntries(res.data);
      setLoading(false);
    });
  }, []);

  if (loading) return <Loading />;

  return (
    <div className="col gap-12">
      <p className="small muted">{t.settings.auditHint}</p>
      {entries.length === 0 ? (
        <EmptyState icon="📋" title={t.common.noData} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.common.date}</th>
                <th>{t.common.actions}</th>
                <th>{t.common.type}</th>
                <th>{t.common.details}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="tiny mono nowrap" dir="ltr">{e.at.slice(0, 19).replace('T', ' ')}</td>
                  <td className="small bold">{e.action}</td>
                  <td className="small">{e.entity}</td>
                  <td className="small muted truncate" style={{ maxWidth: 380 }}>{e.summary ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
