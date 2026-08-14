// ============================================================================
// AlAqsa — Centered card layout shared by the auth/license screens.
// ============================================================================

import React from 'react';
import { useI18n } from '../i18n/I18nContext';

export function AuthShell({
  title, subtitle, children, wide,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background:
        'radial-gradient(1100px 620px at 50% -10%, var(--primary-100), transparent 62%), var(--bg)',
      overflow: 'auto',
    }}>
      <div className="slide-up" style={{ width: '100%', maxWidth: wide ? 620 : 430 }}>
        {/* Brand */}
        <div className="col center gap-6 mb-24">
          <div style={{
            width: 62, height: 62, borderRadius: 18,
            background: 'linear-gradient(140deg, var(--primary-600), var(--primary-800))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 27, fontWeight: 800,
            boxShadow: 'var(--shadow-lg)',
          }}>
            📹
          </div>
          <h1 style={{ fontSize: 25, color: 'var(--primary-700)' }}>{t.appName}</h1>
          <p className="small muted text-center">{t.appTagline}</p>
        </div>

        <div className="card" style={{ boxShadow: 'var(--shadow-lg)' }}>
          <div className="card-body">
            <h2 style={{ fontSize: 17, marginBottom: subtitle ? 6 : 18 }}>{title}</h2>
            {subtitle && (
              <p className="small muted mb-24" style={{ lineHeight: 1.7 }}>{subtitle}</p>
            )}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
