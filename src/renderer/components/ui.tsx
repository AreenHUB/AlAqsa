// ============================================================================
// AlAqsa — Shared UI primitives: toasts, modals, fields, badges, states.
// ============================================================================

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
type ToastKind = 'success' | 'error' | 'warning' | 'info';
interface Toast { id: number; kind: ToastKind; message: string }

interface ToastApi {
  push: (message: string, kind?: ToastKind) => void;
  success: (m: string) => void;
  error: (m: string) => void;
  warning: (m: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  const api = useMemo<ToastApi>(() => ({
    push,
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error'),
    warning: (m) => push(m, 'warning'),
  }), [push]);

  const icon: Record<ToastKind, string> = {
    success: '✓', error: '✕', warning: '⚠', info: 'ℹ',
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role="status">
            <span aria-hidden>{icon[t.kind]}</span>
            <span className="toast-msg">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

/**
 * Translate an error code from the main process into a readable sentence.
 *
 * The main process deliberately returns short stable codes rather than raw
 * exception text, so the customer never sees a module path or SQL error.
 */
export function useErrorMessage() {
  const { t } = useI18n();
  return useCallback((code: string | undefined): string => {
    if (!code) return t.msg.error;
    const table = t.msg.errors as unknown as Record<string, string>;
    return table[code] ?? t.msg.error;
  }, [t]);
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
export function Modal({
  open, title, onClose, children, footer, size = 'md', onSubmit,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Called on Enter. Ignored inside textareas and on buttons/selects, so
   *  multi-line notes and normal keyboard navigation still behave. */
  onSubmit?: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }

      if (e.key === 'Enter' && onSubmit) {
        const el = document.activeElement as HTMLElement | null;
        const tag = el?.tagName;
        if (tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT') return;
        if (el?.isContentEditable) return;
        e.preventDefault();
        onSubmit();
        return;
      }

      // Keep Tab focus inside the dialog.
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, onSubmit]);

  if (!open) return null;
  const sizeClass = size === 'md' ? '' : `modal-${size}`;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} className={`modal ${sizeClass}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3 className="modal-title">{title}</h3>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation dialog with optional danger styling and typed confirmation. */
export function ConfirmDialog({
  open, title, message, warning, confirmLabel, danger, requireText, onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  warning?: string;
  confirmLabel?: string;
  danger?: boolean;
  requireText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [typed, setTyped] = useState('');
  useEffect(() => { if (open) setTyped(''); }, [open]);

  const canConfirm = !requireText || typed.trim() === requireText;

  return (
    <Modal open={open} title={title} onClose={onCancel} size="sm"
      footer={
        <>
          <button className="btn btn-outline" onClick={onCancel}>{t.common.cancel}</button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {confirmLabel ?? t.common.confirm}
          </button>
        </>
      }
    >
      <p style={{ lineHeight: 1.7 }}>{message}</p>
      {warning && (
        <div className="mt-16" style={{
          padding: '12px 14px', borderRadius: 'var(--radius)',
          background: 'var(--danger-bg)', color: '#b91c1c',
          fontWeight: 600, fontSize: 13, lineHeight: 1.6,
        }}>
          ⚠ {warning}
        </div>
      )}
      {requireText && (
        <div className="field mt-16">
          <label className="field-label">{t.settings.typeToConfirm}</label>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------
export function Field({
  label, required, error, hint, children, className = '',
}: {
  label?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`field ${className}`}>
      {label && (
        <label className="field-label">
          {label}{required && <span className="req">*</span>}
        </label>
      )}
      {children}
      {error && <span className="field-error">⚠ {error}</span>}
      {hint && !error && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function TextInput({
  value, onChange, error, className, ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
}) {
  return (
    <input
      {...rest}
      className={className ?? `input ${error ? 'invalid' : ''}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function TextArea({
  value, onChange, error, className, ...rest
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
}) {
  return (
    <textarea
      {...rest}
      className={className ?? `textarea ${error ? 'invalid' : ''}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Select({
  value, onChange, options, placeholder, error, ...rest
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  error?: boolean;
}) {
  return (
    <select
      {...rest}
      className={`select ${error ? 'invalid' : ''}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Checkbox({
  checked, onChange, label, disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Editable list of short strings (phones, emails). */
export function StringList({
  values, onChange, placeholder, addLabel, type = 'text',
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  addLabel: string;
  type?: string;
}) {
  return (
    <div className="col gap-6">
      {values.map((v, i) => (
        <div className="row gap-6" key={i}>
          <input
            className="input"
            type={type}
            value={v}
            placeholder={placeholder}
            dir="ltr"
            onChange={(e) => {
              const next = [...values];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
            aria-label="remove"
            type="button"
          >✕</button>
        </div>
      ))}
      <button className="btn btn-outline btn-sm" type="button"
        onClick={() => onChange([...values, ''])}>+ {addLabel}</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------
export function Stars({
  value, onChange, size = 15, rated = true, unratedLabel,
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
  /**
   * False for a client nobody has rated yet. A brand-new client has not been
   * dealt with, so five empty stars would wrongly show them as the worst on
   * the list; read-only views show a neutral label instead.
   */
  rated?: boolean;
  unratedLabel?: string;
}) {
  // Read-only and never rated: say so rather than implying a zero score.
  if (!rated && !onChange) {
    return <span className="tiny faint">{unratedLabel ?? '—'}</span>;
  }
  return (
    <span className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`star ${rated && n <= value ? 'filled' : ''} ${onChange ? 'interactive' : ''}`}
          style={{ fontSize: size }}
          onClick={onChange ? () => onChange(n === value ? 0 : n) : undefined}
          role={onChange ? 'button' : undefined}
          aria-label={onChange ? `${n}` : undefined}
        >★</span>
      ))}
    </span>
  );
}

export function Badge({
  kind = 'neutral', children, dotColor,
}: {
  kind?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  children: React.ReactNode;
  dotColor?: string;
}) {
  return (
    <span className={`badge badge-${kind}`}>
      {dotColor && <span className="dot" style={{ background: dotColor }} />}
      {children}
    </span>
  );
}

export function EmptyState({
  icon = '📭', title, message, action,
}: {
  icon?: string;
  title: string;
  message?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>{icon}</div>
      <div className="empty-title">{title}</div>
      {message && <div className="small">{message}</div>}
      {action && <div className="mt-8">{action}</div>}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="loading-block">
      <div className="row gap-8">
        <div className="spinner" />
        <span className="muted">{label ?? t.common.loading}</span>
      </div>
    </div>
  );
}

export function Tabs({
  tabs, active, onChange,
}: {
  tabs: { id: string; label: string; badge?: number }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          className={`tab ${active === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge > 0 && (
            <span className="badge badge-info" style={{ marginInlineStart: 6, height: 18, fontSize: 10.5 }}>
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Formats an ISO date for display; falls back to a dash. */
export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

/** Days between today and an ISO date (negative = past). */
export function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso.slice(0, 10) + 'T00:00:00').getTime();
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00').getTime();
  return Math.round((target - today) / 86400000);
}
