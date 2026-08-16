// ============================================================================
// AlAqsa — Main application shell: sidebar, header, routing, global search.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from './i18n/I18nContext';
import { useToast } from './components/ui';
import { GlobalSearch } from './components/GlobalSearch';
import { AppMenuBar } from './components/AppMenuBar';
import { SessionMenu } from './components/SessionMenu';
import { OwnerBadge } from './components/OwnerBadge';
import { USER_ACCOUNTS_ENABLED } from '@shared/featureFlags';
import { DashboardScreen } from './screens/DashboardScreen';
import { ClientsScreen } from './screens/ClientsScreen';
import { ClientDetailScreen } from './screens/ClientDetailScreen';
import { VisitsScreen } from './screens/VisitsScreen';
import { InventoryScreen } from './screens/InventoryScreen';
import { RemindersScreen } from './screens/RemindersScreen';
import { ReportsScreen } from './screens/ReportsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AboutScreen } from './screens/AboutScreen';
import type { Reminder } from '@shared/types';

export type Route =
  | { name: 'dashboard' }
  | { name: 'clients' }
  | { name: 'client'; id: string; tab?: string }
  | { name: 'visits' }
  | { name: 'inventory' }
  | { name: 'reminders' }
  | { name: 'reports' }
  | { name: 'settings' }
  | { name: 'about' };

export function Shell({ onLock }: { onLock: () => void }) {
  const { t, lang, setLang } = useI18n();
  const toast = useToast();

  const [route, setRoute] = useState<Route>({ name: 'dashboard' });
  const [searchOpen, setSearchOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('alaqsa.theme') as 'light' | 'dark') ?? 'light',
  );
  const [collapsed, setCollapsed] = useState(false);
  // Bumped when the signed-in user changes, so screens refetch under the new
  // role (a technician must stop seeing what an admin could).
  const [sessionVersion, setSessionVersion] = useState(0);

  // Apply + persist theme.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('alaqsa.theme', theme);
    void window.alaqsa.settings.setTheme(theme);
  }, [theme]);

  // Global shortcuts: Ctrl+K search, Ctrl+L lock.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        void lock();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // If the licence lapses while the app is open, every data call starts
  // failing with LICENSE_INVALID. Rather than let the user hit silent errors
  // on every screen, send them back to the licence gate immediately.
  useEffect(() => {
    let stopped = false;
    const probe = async () => {
      const res = await window.alaqsa.dashboard.stats();
      if (!stopped && !res.ok && res.error === 'LICENSE_INVALID') onLock();
    };
    void probe();
    const id = window.setInterval(probe, 60_000);
    return () => { stopped = true; window.clearInterval(id); };
  }, [onLock]);

  // Reminder notifications from the main process.
  useEffect(() => {
    return window.alaqsa.events.onReminderDue((r: Reminder) => {
      toast.warning(`🔔 ${r.title}`);
    });
  }, [toast]);

  const lock = useCallback(async () => {
    await window.alaqsa.auth.lock();
    onLock();
  }, [onLock]);

  const navigate = useCallback((r: Route) => {
    setRoute(r);
    setSearchOpen(false);
  }, []);

  const navItems: { id: Route['name']; icon: string; label: string }[] = [
    { id: 'dashboard', icon: '🏠', label: t.nav.dashboard },
    { id: 'clients', icon: '👥', label: t.nav.clients },
    { id: 'visits', icon: '🛠', label: t.nav.visits },
    { id: 'inventory', icon: '📦', label: t.nav.inventory },
    { id: 'reminders', icon: '🔔', label: t.nav.reminders },
    { id: 'reports', icon: '📄', label: t.nav.reports },
    { id: 'settings', icon: '⚙️', label: t.nav.settings },
    { id: 'about', icon: 'ℹ️', label: t.nav.about },
  ];

  const isActive = (id: Route['name']) =>
    route.name === id || (id === 'clients' && route.name === 'client');

  const sidebarW = collapsed ? 66 : 260;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* ---- Sidebar ---- */}
      <aside className="app-sidebar" style={{
        width: sidebarW,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 180ms cubic-bezier(.4,0,.2,1)',
      }}>
        <div className="row gap-8" style={{
          height: 62, padding: collapsed ? '0 14px' : '0 18px',
          borderBottom: '1px solid rgba(255,255,255,.12)', flexShrink: 0,
        }}>
          <span style={{ fontSize: 22 }}>📹</span>
          {!collapsed && (
            <div className="col" style={{ lineHeight: 1.25, overflow: 'hidden' }}>
              <span className="bold nowrap" style={{ fontSize: 15 }}>{t.appName}</span>
              <span className="nowrap" style={{ fontSize: 10, opacity: .7 }}>AlAqsa CCTV</span>
            </div>
          )}
        </div>

        <nav className="col gap-4" style={{ padding: 10, flex: 1, overflowY: 'auto' }}>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate({ name: item.id } as Route)}
              title={collapsed ? item.label : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 11,
                padding: collapsed ? '11px 0' : '11px 13px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                border: 'none', borderRadius: 'var(--radius)',
                background: isActive(item.id) ? 'rgba(255,255,255,.17)' : 'transparent',
                color: '#fff', fontFamily: 'inherit', fontSize: 13.5,
                fontWeight: isActive(item.id) ? 700 : 500,
                cursor: 'pointer', textAlign: 'start', width: '100%',
                transition: 'background 140ms',
              }}
              onMouseEnter={(e) => {
                if (!isActive(item.id)) e.currentTarget.style.background = 'rgba(255,255,255,.08)';
              }}
              onMouseLeave={(e) => {
                if (!isActive(item.id)) e.currentTarget.style.background = 'transparent';
              }}
            >
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              {!collapsed && <span className="nowrap">{item.label}</span>}
            </button>
          ))}
        </nav>

        <div style={{ padding: 10, borderTop: '1px solid rgba(255,255,255,.12)' }}>
          <button
            onClick={() => setCollapsed((c) => !c)}
            style={{
              width: '100%', padding: '9px', border: 'none',
              borderRadius: 'var(--radius)', background: 'rgba(255,255,255,.09)',
              color: '#fff', cursor: 'pointer', fontSize: 13,
            }}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? (lang === 'ar' ? '‹' : '›') : (lang === 'ar' ? '›' : '‹')}
          </button>
        </div>
      </aside>

      {/* ---- Main column ---- */}
      <div className="col" style={{ flex: 1, minWidth: 0 }}>
        {/* The header must sit above the scrolling content so an open menu
            is not covered by the page below it. */}
        <header className="row between" style={{
          height: 62, flexShrink: 0, padding: '0 20px',
          background: 'var(--surface)', borderBottom: '1px solid var(--border)',
          gap: 14, position: 'relative', zIndex: 940,
        }}>
          <AppMenuBar
            onLock={lock}
            onSearch={() => setSearchOpen(true)}
            onAbout={() => navigate({ name: 'about' })}
            onSettings={() => navigate({ name: 'settings' })}
          />

          <button
            className="btn btn-outline"
            onClick={() => setSearchOpen(true)}
            style={{
              flex: 1, maxWidth: 400, justifyContent: 'flex-start',
              color: 'var(--text-faint)', fontWeight: 500,
            }}
          >
            🔍 <span className="truncate">{t.common.searchPlaceholder}</span>
            <span className="mono tiny" style={{
              marginInlineStart: 'auto', padding: '2px 6px',
              background: 'var(--surface-2)', borderRadius: 4,
              border: '1px solid var(--border)',
            }}>Ctrl+K</span>
          </button>

          <div className="row gap-6">
            {/* Staff switcher while user accounts are on; otherwise the
                owner-mode badge for the two-password model. */}
            {USER_ACCOUNTS_ENABLED
              ? <SessionMenu onChanged={() => setSessionVersion((v) => v + 1)} />
              : <OwnerBadge onChanged={() => setSessionVersion((v) => v + 1)} />}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
              title={t.settings.language}
            >
              {lang === 'ar' ? 'EN' : 'ع'}
            </button>
            <button
              className="btn btn-ghost btn-icon btn-sm"
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              title={t.settings.theme}
            >
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={lock}
              title="Ctrl+L"
            >
              🔒 {t.auth.lock}
            </button>
          </div>
        </header>

        {/* NOTE: deliberately not keyed on a data version. Remounting here
            reset every screen to its first tab after each save/delete, which
            made adding several documents in a row painful. Screens refresh
            their own data instead. */}
        <main style={{ flex: 1, overflow: 'auto', padding: 24 }} key={sessionVersion}>
          {route.name === 'dashboard' && <DashboardScreen navigate={navigate} />}
          {route.name === 'clients' && <ClientsScreen navigate={navigate} />}
          {route.name === 'client' && (
            <ClientDetailScreen clientId={route.id} initialTab={route.tab} navigate={navigate} />
          )}
          {route.name === 'visits' && <VisitsScreen navigate={navigate} />}
          {route.name === 'inventory' && <InventoryScreen />}
          {route.name === 'reminders' && <RemindersScreen navigate={navigate} />}
          {route.name === 'reports' && <ReportsScreen navigate={navigate} />}
          {route.name === 'settings' && <SettingsScreen onLock={onLock} />}
          {route.name === 'about' && <AboutScreen />}
        </main>
      </div>

      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        navigate={navigate}
      />
    </div>
  );
}
