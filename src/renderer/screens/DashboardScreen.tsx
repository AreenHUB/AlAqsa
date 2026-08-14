// ============================================================================
// AlAqsa — Dashboard: KPI tiles, upcoming reminders, recent activity.
// ============================================================================

import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Loading, EmptyState, Badge, fmtDate, daysUntil } from '../components/ui';
import type { Route } from '../Shell';
import type { DashboardStats } from '@shared/ipc';
import type { Reminder, AuditEntry } from '@shared/types';

export function DashboardScreen({ navigate }: { navigate: (r: Route) => void }) {
  const { t, fmt } = useI18n();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const [s, r, a] = await Promise.all([
        window.alaqsa.dashboard.stats(),
        window.alaqsa.reminders.upcoming(30),
        window.alaqsa.audit.recent(12),
      ]);
      if (s.ok) setStats(s.data);
      if (r.ok) setReminders(r.data);
      if (a.ok) setAudit(a.data);
      setLoading(false);
    })();
  }, []);

  if (loading) return <Loading />;

  const tiles: {
    label: string; value: number; icon: string;
    accent?: 'warning' | 'danger' | 'success'; go?: Route;
  }[] = [
    { label: t.dashboard.clients, value: stats?.clients ?? 0, icon: '👥', go: { name: 'clients' } },
    { label: t.dashboard.branches, value: stats?.branches ?? 0, icon: '🏢' },
    { label: t.dashboard.cameras, value: stats?.camerasTotal ?? 0, icon: '📷' },
    { label: t.dashboard.devices, value: stats?.devices ?? 0, icon: '📟' },
    { label: t.dashboard.visitsThisMonth, value: stats?.visitsThisMonth ?? 0, icon: '🛠', go: { name: 'visits' } },
    {
      label: t.dashboard.upcomingReminders, value: stats?.upcomingReminders ?? 0,
      icon: '🔔', accent: 'warning', go: { name: 'reminders' },
    },
    {
      label: t.dashboard.expiringLicenses, value: stats?.expiringLicenses ?? 0,
      icon: '📋', accent: (stats?.expiringLicenses ?? 0) > 0 ? 'warning' : undefined,
    },
    {
      label: t.dashboard.expiringWarranties, value: stats?.expiringWarranties ?? 0,
      icon: '🛡', accent: (stats?.expiringWarranties ?? 0) > 0 ? 'warning' : undefined,
    },
    {
      label: t.dashboard.flaggedClients, value: stats?.flaggedClients ?? 0,
      icon: '🔴', accent: (stats?.flaggedClients ?? 0) > 0 ? 'danger' : undefined,
      go: { name: 'clients' },
    },
  ];

  const reminderTone = (r: Reminder): 'danger' | 'warning' | 'info' => {
    const d = daysUntil(r.dueDate);
    if (d === null) return 'info';
    if (d < 0) return 'danger';
    if (d <= 7) return 'warning';
    return 'info';
  };

  const reminderText = (r: Reminder): string => {
    const d = daysUntil(r.dueDate);
    if (d === null) return '';
    if (d < 0) return t.reminders.overdue;
    if (d === 0) return t.reminders.dueToday;
    return fmt(t.reminders.inDays, { n: d });
  };

  return (
    <div className="col gap-24 fade-in">
      <div>
        <h1 style={{ fontSize: 22 }}>{t.dashboard.title}</h1>
        <p className="muted small">{t.dashboard.welcome}</p>
      </div>

      {/* KPI tiles */}
      <div className="stat-grid">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className={`stat ${tile.accent ? `accent-${tile.accent}` : ''} ${tile.go ? 'clickable' : ''}`}
            onClick={tile.go ? () => navigate(tile.go!) : undefined}
          >
            <span className="stat-icon" aria-hidden>{tile.icon}</span>
            <div className="stat-label">{tile.label}</div>
            <div className="stat-value">{tile.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 18 }}>
        {/* Upcoming reminders */}
        <div className="card">
          <div className="card-head">
            <span className="card-title">🔔 {t.dashboard.upcomingTitle}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate({ name: 'reminders' })}>
              {t.common.view} →
            </button>
          </div>
          <div className="card-body" style={{ padding: reminders.length ? 0 : undefined }}>
            {reminders.length === 0 ? (
              <div className="small muted text-center">{t.dashboard.noUpcoming}</div>
            ) : (
              <div className="col">
                {reminders.slice(0, 7).map((r) => (
                  <div key={r.id} className="row between gap-12" style={{
                    padding: '11px 18px', borderBottom: '1px solid var(--border)',
                  }}>
                    <div className="col" style={{ minWidth: 0 }}>
                      <span className="truncate" style={{ fontSize: 13, fontWeight: 600 }}>{r.title}</span>
                      <span className="tiny muted">{fmtDate(r.dueDate)}</span>
                    </div>
                    <Badge kind={reminderTone(r)}>{reminderText(r)}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent activity */}
        <div className="card">
          <div className="card-head">
            <span className="card-title">📋 {t.dashboard.recentActivity}</span>
          </div>
          <div className="card-body" style={{ padding: audit.length ? 0 : undefined }}>
            {audit.length === 0 ? (
              <div className="small muted text-center">{t.common.noData}</div>
            ) : (
              <div className="col">
                {audit.map((a) => (
                  <div key={a.id} className="row between gap-12" style={{
                    padding: '9px 18px', borderBottom: '1px solid var(--border)',
                  }}>
                    <div className="col" style={{ minWidth: 0 }}>
                      <span className="truncate small">
                        <span className="bold">{a.action}</span>
                        <span className="muted"> · {a.entity}</span>
                      </span>
                      {a.summary && <span className="truncate tiny muted">{a.summary}</span>}
                    </div>
                    <span className="tiny faint nowrap">{a.at.slice(0, 16).replace('T', ' ')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="card">
        <div className="card-head"><span className="card-title">⚡ {t.dashboard.quickActions}</span></div>
        <div className="card-body row gap-10 wrap">
          <button className="btn btn-primary" onClick={() => navigate({ name: 'clients' })}>
            + {t.dashboard.newClient}
          </button>
          <button className="btn btn-outline" onClick={() => navigate({ name: 'visits' })}>
            + {t.dashboard.newVisit}
          </button>
          <button className="btn btn-outline" onClick={() => navigate({ name: 'reports' })}>
            📄 {t.nav.reports}
          </button>
          <button className="btn btn-outline" onClick={() => navigate({ name: 'inventory' })}>
            📦 {t.nav.inventory}
          </button>
        </div>
      </div>
    </div>
  );
}
