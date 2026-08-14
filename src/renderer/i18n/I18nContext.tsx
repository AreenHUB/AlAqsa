// ============================================================================
// AlAqsa — i18n context. Arabic is the default; switching flips document dir.
// ============================================================================

import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { translations, type Lang, type Translations } from './translations';

interface I18nValue {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  t: Translations;
  setLang: (l: Lang) => void;
  /** Interpolate {n}-style placeholders: fmt(t.reminders.inDays, { n: 5 }) */
  fmt: (template: string, vars: Record<string, string | number>) => string;
  /** Localized name from a bilingual pair. */
  pick: (ar: string | undefined, en: string | undefined) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children, initialLang = 'ar' }: { children: React.ReactNode; initialLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const dir: 'rtl' | 'ltr' = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    void window.alaqsa.settings.setLanguage(l);
  }, []);

  const fmt = useCallback((template: string, vars: Record<string, string | number>) => {
    return Object.entries(vars).reduce(
      (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
      template,
    );
  }, []);

  const pick = useCallback(
    (ar: string | undefined, en: string | undefined) =>
      (lang === 'ar' ? ar || en : en || ar) ?? '',
    [lang],
  );

  const value = useMemo<I18nValue>(
    () => ({ lang, dir, t: translations[lang] as unknown as Translations, setLang, fmt, pick }),
    [lang, dir, setLang, fmt, pick],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
