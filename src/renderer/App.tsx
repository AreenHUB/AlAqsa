// ============================================================================
// AlAqsa — Root component. Gates the app behind: license -> unlock -> shell.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { I18nProvider, useI18n } from './i18n/I18nContext';
import { ToastProvider } from './components/ui';
import { LockScreen } from './screens/LockScreen';
import { FirstRunScreen } from './screens/FirstRunScreen';
import { LicenseScreen } from './screens/LicenseScreen';
import { Shell } from './Shell';
import type { AuthStatus } from '@shared/ipc';
import type { Lang } from './i18n/translations';

function Root() {
  const { lang, setLang } = useI18n();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [booted, setBooted] = useState(false);

  const refresh = useCallback(async () => {
    const s = await window.alaqsa.auth.status();
    setStatus(s);
    if (s.language !== lang) setLang(s.language);
    setBooted(true);
  }, [lang, setLang]);

  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply stored theme on boot.
  useEffect(() => {
    const stored = localStorage.getItem('alaqsa.theme');
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  }, []);

  // Re-lock when the main process says so.
  useEffect(() => {
    return window.alaqsa.events.onLocked(() => {
      setStatus((prev) => (prev ? { ...prev, unlocked: false } : prev));
    });
  }, []);

  if (!booted || !status) {
    return (
      <div className="row center" style={{ height: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  const ls = status.licenseState;
  if (ls.status === 'expired' || ls.status === 'revoked' || ls.status === 'missing') {
    return <LicenseScreen state={ls} onActivated={refresh} />;
  }

  if (!status.initialized) return <FirstRunScreen onDone={refresh} />;
  if (!status.unlocked) return <LockScreen onUnlocked={refresh} />;

  return <Shell onLock={refresh} />;
}

export function App() {
  const [initialLang, setInitialLang] = useState<Lang | null>(null);

  useEffect(() => {
    void window.alaqsa.auth.status().then((s) => setInitialLang(s.language ?? 'ar'));
  }, []);

  if (!initialLang) {
    return (
      <div className="row center" style={{ height: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <I18nProvider initialLang={initialLang}>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </I18nProvider>
  );
}
