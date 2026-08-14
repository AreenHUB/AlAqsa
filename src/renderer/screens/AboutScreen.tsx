// ============================================================================
// AlAqsa — About: ownership, developer contacts, description and usage guide.
// ============================================================================

import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Loading, useToast } from '../components/ui';
import { AUTHOR } from '@shared/constants';
import type { AboutInfo } from '@shared/ipc';

export function AboutScreen() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [info, setInfo] = useState<AboutInfo | null>(null);

  useEffect(() => {
    void window.alaqsa.app.about().then((res) => { if (res.ok) setInfo(res.data); });
  }, []);

  if (!info) return <Loading />;

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(t.common.copied);
  };

  const openExternal = (url: string) => { window.open(url, '_blank'); };

  return (
    <div className="col gap-20 fade-in" style={{ maxWidth: 1000, margin: '0 auto' }}>
      {/* Hero */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{
          background: 'linear-gradient(135deg, var(--primary-700), var(--primary-900))',
          padding: '32px 26px', color: '#fff',
        }}>
          <div className="row gap-16 wrap">
            <div style={{
              width: 72, height: 72, borderRadius: 20,
              background: 'rgba(255,255,255,.16)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 34, flexShrink: 0,
            }}>📹</div>
            <div className="col gap-4">
              <h1 style={{ fontSize: 27, color: '#fff' }}>{t.appName}</h1>
              <p style={{ opacity: .9, fontSize: 14 }}>{t.appTagline}</p>
              <span className="mono" style={{
                fontSize: 12, opacity: .8, marginTop: 4,
                background: 'rgba(255,255,255,.14)', padding: '3px 10px',
                borderRadius: 999, alignSelf: 'flex-start',
              }}>
                {t.about.version} {info.version}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Developer + copyright */}
      <div className="card">
        <div className="card-head"><span className="card-title">👨‍💻 {t.about.developer}</span></div>
        <div className="card-body col gap-14">
          <div className="row gap-14 wrap">
            <div style={{
              width: 54, height: 54, borderRadius: '50%',
              background: 'var(--primary-100)', color: 'var(--primary-700)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, fontWeight: 800, flexShrink: 0,
            }}>
              {lang === 'ar' ? 'أ' : 'A'}
            </div>
            <div className="col gap-2">
              <span className="bold" style={{ fontSize: 17 }}>
                {lang === 'ar' ? AUTHOR.nameAr : AUTHOR.name}
              </span>
              <span className="small muted">{AUTHOR.name}</span>
            </div>
          </div>

          <div className="col gap-8">
            <span className="field-label">{t.about.contact}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
              <button className="btn btn-outline" style={{ justifyContent: 'flex-start' }}
                onClick={() => copy(AUTHOR.phone)}>
                📱 <span className="mono" dir="ltr">{AUTHOR.phone}</span>
              </button>
              <button className="btn btn-outline" style={{ justifyContent: 'flex-start' }}
                onClick={() => copy(AUTHOR.email)}>
                ✉️ <span className="mono truncate" dir="ltr">{AUTHOR.email}</span>
              </button>
              <button className="btn btn-outline" style={{ justifyContent: 'flex-start' }}
                onClick={() => openExternal(AUTHOR.githubUrl)}>
                🐙 <span className="mono" dir="ltr">{AUTHOR.github}</span>
              </button>
              <button className="btn btn-outline" style={{ justifyContent: 'flex-start' }}
                onClick={() => openExternal(`https://wa.me/${AUTHOR.phone.replace(/\D/g, '')}`)}>
                💬 WhatsApp
              </button>
            </div>
          </div>

          <div style={{
            padding: '13px 15px', borderRadius: 'var(--radius)',
            background: 'var(--primary-50)', border: '1px solid var(--primary-100)',
            lineHeight: 1.8, fontSize: 13,
          }}>
            <div className="bold mb-8" style={{ color: 'var(--primary-700)' }}>
              © {info.year} {lang === 'ar' ? AUTHOR.nameAr : AUTHOR.name} — {t.about.copyright}
            </div>
            <div className="muted">{t.about.copyrightNotice}</div>
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="card">
        <div className="card-head"><span className="card-title">📖 {t.about.description}</span></div>
        <div className="card-body">
          <p style={{ lineHeight: 1.9, fontSize: 14 }}>{t.about.descriptionText}</p>
        </div>
      </div>

      {/* Features */}
      <div className="card">
        <div className="card-head"><span className="card-title">✨ {t.about.features}</span></div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(255px, 1fr))', gap: 10 }}>
            {(t.about.featureList as unknown as string[]).map((f, i) => (
              <div key={i} className="row gap-8" style={{
                padding: '10px 12px', background: 'var(--surface-2)',
                borderRadius: 'var(--radius)', fontSize: 13,
              }}>
                <span style={{ color: 'var(--success)' }}>✓</span>
                <span>{f}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* How to use */}
      <div className="card">
        <div className="card-head"><span className="card-title">🎯 {t.about.howToUse}</span></div>
        <div className="card-body col gap-10">
          {(t.about.guideSteps as unknown as string[]).map((step, i) => (
            <div key={i} className="row gap-12" style={{ alignItems: 'flex-start' }}>
              <span style={{
                width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                background: 'var(--primary-700)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12.5, fontWeight: 700,
              }}>{i + 1}</span>
              <span style={{ lineHeight: 1.75, fontSize: 13.5, paddingTop: 2 }}>{step}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Shortcuts */}
      <div className="card">
        <div className="card-head"><span className="card-title">⌨️ Shortcuts</span></div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            {[
              { keys: 'Ctrl + K', desc: t.common.search },
              { keys: 'Ctrl + L', desc: t.auth.lock },
              { keys: 'Esc', desc: t.common.close },
            ].map((s) => (
              <div key={s.keys} className="row between" style={{
                padding: '9px 12px', background: 'var(--surface-2)', borderRadius: 'var(--radius)',
              }}>
                <span className="small">{s.desc}</span>
                <span className="mono tiny" style={{
                  padding: '3px 8px', background: 'var(--surface)',
                  border: '1px solid var(--border)', borderRadius: 5,
                }}>{s.keys}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="text-center small faint" style={{ paddingBottom: 20 }}>
        {t.appName} v{info.version} · © {info.year} {lang === 'ar' ? AUTHOR.nameAr : AUTHOR.name}
      </div>
    </div>
  );
}
