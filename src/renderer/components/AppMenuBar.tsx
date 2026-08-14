// ============================================================================
// AlAqsa — In-app menu bar.
//
// Replaces the native Windows menu with a translucent, rounded strip that
// matches the rest of the UI. The native menu still exists (hidden) purely so
// its accelerators keep working, so every item here has a keyboard equivalent.
// ============================================================================

import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
}

export function AppMenuBar({
  onLock, onSearch, onAbout, onSettings,
}: {
  onLock: () => void;
  onSearch: () => void;
  onAbout: () => void;
  onSettings: () => void;
}) {
  const { t } = useI18n();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Close on any interaction outside the bar. Both mousedown and click are
    // observed so programmatic clicks (and clicks that land on the body) also
    // dismiss the menu.
    const onOutside = (e: Event) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenu(null); };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('click', onOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('click', onOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  // Zoom is driven through the browser API so it works with or without the
  // hidden native menu being focused.
  const zoom = (delta: number | 'reset') => {
    const root = document.documentElement;
    const current = parseFloat(root.style.getPropertyValue('--app-zoom') || '1');
    const next = delta === 'reset' ? 1 : Math.min(1.6, Math.max(0.7, current + delta));
    root.style.setProperty('--app-zoom', String(next));
    root.style.fontSize = `${next * 100}%`;
    localStorage.setItem('alaqsa.zoom', String(next));
  };

  useEffect(() => {
    const saved = parseFloat(localStorage.getItem('alaqsa.zoom') || '1');
    if (saved !== 1) {
      document.documentElement.style.setProperty('--app-zoom', String(saved));
      document.documentElement.style.fontSize = `${saved * 100}%`;
    }
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') { e.preventDefault(); zoom(0.1); }
      else if (e.key === '-' || e.code === 'NumpadSubtract') { e.preventDefault(); zoom(-0.1); }
      else if (e.key === '0') { e.preventDefault(); zoom('reset'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const menus: Record<string, MenuItem[]> = {
    [t.appName]: [
      { label: t.common.search, shortcut: 'Ctrl+K', action: onSearch },
      { label: t.nav.settings, action: onSettings },
      { separator: true, label: '' },
      { label: t.auth.lock, shortcut: 'Ctrl+L', action: onLock },
      { label: t.nav.about, action: onAbout },
    ],
    [t.menu.edit]: [
      { label: t.menu.undo, shortcut: 'Ctrl+Z', action: () => document.execCommand('undo') },
      { label: t.menu.redo, shortcut: 'Ctrl+Shift+Z', action: () => document.execCommand('redo') },
      { separator: true, label: '' },
      { label: t.menu.cut, shortcut: 'Ctrl+X', action: () => document.execCommand('cut') },
      { label: t.menu.copy, shortcut: 'Ctrl+C', action: () => document.execCommand('copy') },
      { label: t.menu.paste, shortcut: 'Ctrl+V', action: () => document.execCommand('paste') },
      { label: t.menu.selectAll, shortcut: 'Ctrl+A', action: () => document.execCommand('selectAll') },
    ],
    [t.menu.view]: [
      { label: t.menu.zoomIn, shortcut: 'Ctrl +', action: () => zoom(0.1) },
      { label: t.menu.zoomOut, shortcut: 'Ctrl -', action: () => zoom(-0.1) },
      { label: t.menu.zoomReset, shortcut: 'Ctrl 0', action: () => zoom('reset') },
      { separator: true, label: '' },
      { label: t.menu.fullscreen, shortcut: 'F11', action: () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      } },
    ],
  };

  return (
    <div ref={barRef} className="app-menubar">
      {Object.entries(menus).map(([name, items]) => (
        <div key={name} style={{ position: 'relative' }}>
          <button
            className={`menubar-btn ${openMenu === name ? 'active' : ''}`}
            onClick={() => setOpenMenu(openMenu === name ? null : name)}
            onMouseEnter={() => { if (openMenu) setOpenMenu(name); }}
          >
            {name}
          </button>

          {openMenu === name && (
            <div className="menubar-dropdown">
              {items.map((item, i) => (
                item.separator ? (
                  <div key={i} className="menubar-sep" />
                ) : (
                  <button
                    key={i}
                    className="menubar-item"
                    onClick={() => { item.action?.(); setOpenMenu(null); }}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && <span className="menubar-shortcut">{item.shortcut}</span>}
                  </button>
                )
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
