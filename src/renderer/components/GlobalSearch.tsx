// ============================================================================
// AlAqsa — Global search (Ctrl+K). Searches clients, branches, devices (by
// serial/model) and contacts (by phone/email) in one place.
// ============================================================================

import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type { Route } from '../Shell';
import type { GlobalSearchResult } from '@shared/ipc';
import { DEVICE_TYPES } from '@shared/constants';

export function GlobalSearch({
  open, onClose, navigate,
}: {
  open: boolean;
  onClose: () => void;
  navigate: (r: Route) => void;
}) {
  const { t, lang } = useI18n();
  const [term, setTerm] = useState('');
  const [result, setResult] = useState<GlobalSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setTerm('');
      setResult(null);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.clearTimeout(debounce.current);
    if (term.trim().length < 2) {
      setResult(null);
      return;
    }
    setBusy(true);
    debounce.current = window.setTimeout(async () => {
      const res = await window.alaqsa.search.global(term.trim());
      setBusy(false);
      if (res.ok) setResult(res.data);
    }, 220);
    return () => window.clearTimeout(debounce.current);
  }, [term, open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const deviceTypeLabel = (v: string) => {
    const d = DEVICE_TYPES.find((x) => x.value === v);
    return d ? (lang === 'ar' ? d.ar : d.en) : v;
  };

  const total = result
    ? result.clients.length + result.branches.length + result.devices.length + result.contacts.length
    : 0;

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="mb-16">
      <div className="tiny bold muted" style={{ padding: '4px 6px', textTransform: 'uppercase' }}>
        {title}
      </div>
      <div className="col gap-4">{children}</div>
    </div>
  );

  const Row = ({
    icon, primary, secondary, onClick,
  }: {
    icon: string; primary: string; secondary?: string; onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      className="row gap-10"
      style={{
        padding: '9px 11px', border: '1px solid transparent',
        borderRadius: 'var(--radius)', background: 'transparent',
        cursor: 'pointer', textAlign: 'start', width: '100%',
        fontFamily: 'inherit', color: 'var(--text)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span className="col grow" style={{ minWidth: 0 }}>
        <span className="truncate" style={{ fontSize: 13.5, fontWeight: 600 }}>{primary}</span>
        {secondary && <span className="truncate tiny muted">{secondary}</span>}
      </span>
    </button>
  );

  return (
    <div
      className="modal-backdrop"
      style={{ alignItems: 'flex-start', paddingTop: '9vh' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal modal-lg" style={{ maxHeight: '76vh' }}>
        <div className="row gap-10" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 17 }}>🔍</span>
          <input
            ref={inputRef}
            className="input"
            style={{ border: 'none', boxShadow: 'none', fontSize: 15, padding: 0, background: 'transparent' }}
            placeholder={t.common.searchPlaceholder}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          {busy && <div className="spinner" />}
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ padding: 12 }}>
          {term.trim().length < 2 && (
            <div className="empty" style={{ padding: 40 }}>
              <div className="empty-icon">⌨️</div>
              <div className="small muted">{t.common.searchPlaceholder}</div>
            </div>
          )}

          {term.trim().length >= 2 && result && total === 0 && !busy && (
            <div className="empty" style={{ padding: 40 }}>
              <div className="empty-icon">🔎</div>
              <div className="empty-title">{t.common.noResults}</div>
            </div>
          )}

          {result && result.clients.length > 0 && (
            <Section title={t.nav.clients}>
              {result.clients.map((c) => (
                <Row
                  key={c.id}
                  icon={c.isFlagged ? '🔴' : '👤'}
                  primary={lang === 'ar' ? c.nameAr : (c.nameEn || c.nameAr)}
                  secondary={c.code}
                  onClick={() => navigate({ name: 'client', id: c.id })}
                />
              ))}
            </Section>
          )}

          {result && result.branches.length > 0 && (
            <Section title={t.branches.title}>
              {result.branches.map((b) => (
                <Row
                  key={b.id}
                  icon="🏢"
                  primary={lang === 'ar' ? b.nameAr : (b.nameEn || b.nameAr)}
                  secondary={b.location.address}
                  onClick={() => navigate({ name: 'client', id: b.clientId, tab: 'branches' })}
                />
              ))}
            </Section>
          )}

          {result && result.devices.length > 0 && (
            <Section title={t.devices.title}>
              {result.devices.map((d) => (
                <Row
                  key={d.id}
                  icon={d.type === 'camera' ? '📷' : d.type === 'hdd' ? '💾' : '📟'}
                  primary={`${d.label ?? deviceTypeLabel(d.type)} — ${d.model ?? ''}`}
                  secondary={d.serialNumber ? `S/N: ${d.serialNumber}` : undefined}
                  onClick={() => navigate({ name: 'clients' })}
                />
              ))}
            </Section>
          )}

          {result && result.contacts.length > 0 && (
            <Section title={t.clients.contacts}>
              {result.contacts.map((c) => (
                <Row
                  key={c.id}
                  icon="📞"
                  primary={c.name}
                  secondary={[...c.phones, ...c.emails].join(' · ')}
                  onClick={() => navigate({ name: 'client', id: c.clientId })}
                />
              ))}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
