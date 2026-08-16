// ============================================================================
// AlAqsa — Files exported for one client.
//
// Reports used to be written to disk and forgotten: nothing told the owner what
// had been produced for a client or where it went. This panel is that record —
// every PDF and Excel file for this client, with its path, and buttons to open
// it, show it in Explorer, print it or send it on WhatsApp.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { EmptyState, Loading, Badge, useToast, useErrorMessage, fmtDate } from './ui';
import { ShareReportModal } from './ShareReportModal';
import type { ExportRecord, Contact } from '@shared/types';

const KIND_ICON: Record<string, string> = {
  visit_pdf: '🛠', agreement_pdf: '📋', invoice_pdf: '🧾',
  client_excel: '📊', full_excel: '📊',
};

export function ExportsPanel({
  clientId, clientName, contacts,
}: {
  clientId: string;
  clientName: string;
  contacts: Contact[];
}) {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const [rows, setRows] = useState<ExportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await window.alaqsa.exports.listByClient(clientId);
    if (res.ok) setRows(res.data);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  // Regenerating a report adds a row, so refresh when the main process says so.
  useEffect(() => {
    const off = window.alaqsa.events.onDataChanged((entity: string) => {
      if (entity === 'exports') void load();
    });
    return off;
  }, [load]);

  const kindLabel = (k: string) => (t.exports.kinds as Record<string, string>)[k] ?? k;

  const open = async (r: ExportRecord) => {
    const res = await window.alaqsa.exports.open(r.filePath);
    if (!res.ok) toast.error(errMsg(res.error));
  };

  const reveal = async (r: ExportRecord) => {
    const res = await window.alaqsa.exports.revealInFolder(r.filePath);
    if (!res.ok) toast.error(errMsg(res.error));
  };

  const print = async (r: ExportRecord) => {
    const res = await window.alaqsa.reports.print(r.filePath);
    if (!res.ok) toast.error(errMsg(res.error));
    else toast.success(t.reports.sentToPrinter);
  };

  const forget = async (r: ExportRecord) => {
    const res = await window.alaqsa.exports.remove(r.id);
    if (!res.ok) return toast.error(errMsg(res.error));
    toast.success(t.exports.forgotten);
    void load();
  };

  if (loading) return <Loading />;

  return (
    <div className="col gap-12">
      <div className="row between wrap gap-10">
        <div>
          <h3 style={{ fontSize: 16 }}>{t.exports.title}</h3>
          <p className="muted small">{t.exports.subtitle}</p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={async () => {
          const res = await window.alaqsa.exports.openFolder();
          if (!res.ok) toast.error(errMsg(res.error));
        }}>📂 {t.exports.openFolder}</button>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="📄" title={t.exports.none} message={t.exports.noneHint} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.exports.kind}</th>
                <th>{t.exports.fileName}</th>
                <th>{t.common.date}</th>
                <th>{t.exports.size}</th>
                <th style={{ width: 190 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="small">
                    <Badge kind="info">{KIND_ICON[r.kind] ?? '📄'} {kindLabel(r.kind)}</Badge>
                  </td>
                  <td className="small" style={{ maxWidth: 280 }}>
                    <div className="truncate" title={r.filePath}>{r.fileName}</div>
                    {/* The path answers "where did it go?" without opening anything. */}
                    <div className="tiny faint truncate" dir="ltr" title={r.filePath}>{r.filePath}</div>
                  </td>
                  <td className="small">{fmtDate(r.createdAt)}</td>
                  <td className="small">
                    {r.sizeBytes ? `${Math.round(r.sizeBytes / 1024)} KB` : '—'}
                  </td>
                  <td>
                    {r.exists === false ? (
                      <div className="row gap-6">
                        <Badge kind="warning">{t.exports.missing}</Badge>
                        <button className="btn btn-ghost btn-sm" title={t.exports.forget}
                          onClick={() => forget(r)}>🗑</button>
                      </div>
                    ) : (
                      <div className="cell-actions">
                        <button className="btn btn-ghost btn-icon btn-sm" title={t.exports.open}
                          onClick={() => open(r)}>👁</button>
                        <button className="btn btn-ghost btn-icon btn-sm" title={t.exports.reveal}
                          onClick={() => reveal(r)}>📂</button>
                        <button className="btn btn-ghost btn-icon btn-sm" title={t.reports.print}
                          onClick={() => print(r)}>🖨</button>
                        <button className="btn btn-ghost btn-icon btn-sm" title={t.reports.shareWhatsApp}
                          onClick={() => setSharing(r.filePath)}>📱</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ShareReportModal
        open={!!sharing}
        pdfPath={sharing ?? ''}
        contacts={contacts}
        clientName={clientName}
        onClose={() => setSharing(null)}
      />
    </div>
  );
}
