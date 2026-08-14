// ============================================================================
// AlAqsa — Technician field with suggestions from the staff directory.
//
// Typing filters known staff; Tab or Enter completes the highlighted match.
// Entering a name that is not on the list prompts to add it permanently or
// keep it as a one-off helper, so the directory stays clean without blocking
// the technician mid-form.
// ============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Modal, useToast , useErrorMessage } from './ui';
import type { StaffMember } from '@shared/types';

export function TechnicianPicker({
  value, staffId, onChange, staff, onStaffAdded,
}: {
  value: string;
  staffId?: string;
  onChange: (name: string, staffId?: string) => void;
  staff: StaffMember[];
  onStaffAdded: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [askAdd, setAskAdd] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const pool = staff.filter((s) => s.active);
    if (!q) return pool.slice(0, 8);
    return pool.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8);
  }, [value, staff]);

  // Close the suggestion list when focus leaves the component.
  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);

  const pick = (s: StaffMember) => {
    onChange(s.name, s.id);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || matches.length === 0) {
      // Leaving the field with an unknown name: offer to remember it.
      if (e.key === 'Tab' && value.trim() && !staffId) {
        const known = staff.find((s) => s.name.toLowerCase() === value.trim().toLowerCase());
        if (!known) setAskAdd(value.trim());
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + matches.length) % matches.length);
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      // Complete on Tab; Enter also completes rather than submitting the form.
      e.preventDefault();
      pick(matches[highlight] ?? matches[0]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const addPermanently = async (temporary: boolean) => {
    if (!askAdd) return;
    const res = await window.alaqsa.staff.save({
      name: askAdd, active: true, isTemporary: temporary,
    });
    setAskAdd(null);
    if (!res.ok) return toast.error(errMsg(res.error));
    onChange(res.data.name, res.data.id);
    onStaffAdded();
    toast.success(t.msg.created);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        className="input"
        value={value}
        placeholder={t.staff.pickerPlaceholder}
        onChange={(e) => { onChange(e.target.value, undefined); setOpen(true); setHighlight(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />

      {staffId && (
        <span className="tiny" style={{ color: 'var(--success)', fontWeight: 600 }}>
          ✓ {t.staff.fromDirectory}
        </span>
      )}

      {open && matches.length > 0 && (
        <div style={{
          position: 'absolute', insetInlineStart: 0, insetInlineEnd: 0, top: '100%',
          zIndex: 50, marginTop: 4, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-lg)', overflow: 'hidden', maxHeight: 220, overflowY: 'auto',
        }}>
          {matches.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                display: 'block', width: '100%', textAlign: 'start',
                padding: '8px 11px', border: 'none', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 13,
                background: i === highlight ? 'var(--surface-hover)' : 'transparent',
                color: 'var(--text)',
              }}
            >
              <span className="bold">{s.name}</span>
              {s.role && <span className="tiny muted"> — {s.role}</span>}
              {s.isTemporary && <span className="tiny faint"> ({t.staff.temporary})</span>}
            </button>
          ))}
          <div className="tiny faint" style={{ padding: '6px 11px', borderTop: '1px solid var(--border)' }}>
            ⇥ {t.staff.tabToComplete}
          </div>
        </div>
      )}

      <Modal
        open={!!askAdd}
        title={t.staff.addToDirectory}
        onClose={() => setAskAdd(null)}
        size="sm"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => setAskAdd(null)}>{t.common.cancel}</button>
            <button className="btn btn-outline" onClick={() => addPermanently(true)}>
              {t.staff.oneOffHelper}
            </button>
            <button className="btn btn-primary" onClick={() => addPermanently(false)}>
              {t.staff.addPermanent}
            </button>
          </>
        }
      >
        <p style={{ lineHeight: 1.7 }}>
          {t.staff.addQuestion} <span className="bold">{askAdd}</span>
        </p>
        <p className="small muted mt-8">{t.staff.addHint}</p>
      </Modal>
    </div>
  );
}
