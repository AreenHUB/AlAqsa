// ============================================================================
// AlAqsa — Reports hub: per-client exports, agreements, and a full data export.
// ============================================================================

import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Select, Loading, useToast , useErrorMessage } from '../components/ui';
import { ShareReportModal } from '../components/ShareReportModal';
import type { Route } from '../Shell';
import type { Client, Contact } from '@shared/types';

export function ReportsScreen({ navigate }: { navigate: (r: Route) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [clients, setClients] = useState<Client[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [share, setShare] = useState<{ path: string; contacts: Contact[]; name: string } | null>(null);

  useEffect(() => {
    void window.alaqsa.clients.list({ limit: 500 }).then((res) => {
      if (res.ok) setClients(res.data.rows);
      setLoading(false);
    });
  }, []);

  const selectedClient = clients.find((c) => c.id === selected);

  const agreement = async () => {
    if (!selected) return toast.warning(t.common.selectOption);
    setBusy('agreement');
    const res = await window.alaqsa.reports.agreementPdf(selected);
    setBusy('');
    if (!res.ok) return toast.error(errMsg(res.error));
    const contacts = await window.alaqsa.clients.contacts(selected);
    toast.success(t.reports.generated);
    setShare({
      path: res.data.path,
      contacts: contacts.ok ? contacts.data : [],
      name: selectedClient?.nameAr ?? '',
    });
  };

  const clientExcel = async () => {
    if (!selected) return toast.warning(t.common.selectOption);
    setBusy('clientExcel');
    const res = await window.alaqsa.reports.exportClientExcel(selected);
    setBusy('');
    if (!res.ok) return toast.error(errMsg(res.error));
    toast.success(`${t.reports.generated}: ${res.data.path}`);
  };

  const allExcel = async () => {
    setBusy('allExcel');
    const res = await window.alaqsa.reports.exportAllExcel();
    setBusy('');
    if (!res.ok) return toast.error(errMsg(res.error));
    toast.success(`${t.reports.generated}: ${res.data.path}`);
  };

  if (loading) return <Loading />;

  const Card = ({
    icon, title, desc, action, disabled, loadingKey,
  }: {
    icon: string; title: string; desc: string;
    action: () => void; disabled?: boolean; loadingKey: string;
  }) => (
    <div className="card">
      <div className="card-body col gap-10">
        <div className="row gap-10">
          <span style={{ fontSize: 26 }}>{icon}</span>
          <div className="col">
            <span className="bold">{title}</span>
            <span className="tiny muted">{desc}</span>
          </div>
        </div>
        <button className="btn btn-primary btn-block" onClick={action} disabled={disabled || !!busy}>
          {busy === loadingKey ? <span className="spinner" /> : `${t.common.export} →`}
        </button>
      </div>
    </div>
  );

  return (
    <div className="col gap-20 fade-in">
      <div>
        <h1 style={{ fontSize: 22 }}>{t.reports.title}</h1>
        <p className="muted small">{t.appTagline}</p>
      </div>

      <div className="card">
        <div className="card-head"><span className="card-title">👤 {t.nav.clients}</span></div>
        <div className="card-body">
          <Select
            value={selected}
            onChange={setSelected}
            placeholder={t.common.selectOption}
            options={clients.map((c) => ({ value: c.id, label: `${c.code} — ${c.nameAr}` }))}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(275px, 1fr))', gap: 14 }}>
        <Card
          icon="📋"
          title={t.reports.agreementReport}
          desc={t.clients.tabs.devices + ' · ' + t.licenses.title}
          action={agreement}
          disabled={!selected}
          loadingKey="agreement"
        />
        <Card
          icon="📊"
          title={t.reports.exportClient}
          desc={`Excel · ${t.clients.tabs.branches} · ${t.visits.title}`}
          action={clientExcel}
          disabled={!selected}
          loadingKey="clientExcel"
        />
        <Card
          icon="🗄"
          title={t.reports.exportAll}
          desc={t.reports.exportAllHint}
          action={allExcel}
          loadingKey="allExcel"
        />
      </div>

      <div className="card">
        <div className="card-head"><span className="card-title">📄 {t.reports.visitReport}</span></div>
        <div className="card-body col gap-10">
          <p className="small muted">
            تُصدر تقارير الزيارات من صفحة الزيارات أو من ملف العميل مباشرة.
          </p>
          <div className="row gap-8">
            <button className="btn btn-outline" onClick={() => navigate({ name: 'visits' })}>
              🛠 {t.nav.visits} →
            </button>
            <button className="btn btn-outline" onClick={() => navigate({ name: 'clients' })}>
              👥 {t.nav.clients} →
            </button>
          </div>
        </div>
      </div>

      <ShareReportModal
        open={!!share}
        pdfPath={share?.path ?? ''}
        contacts={share?.contacts ?? []}
        clientName={share?.name ?? ''}
        onClose={() => setShare(null)}
      />
    </div>
  );
}
