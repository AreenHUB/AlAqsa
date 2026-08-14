// ============================================================================
// AlAqsa — Share a generated report: WhatsApp, print, or open the file.
//
// WhatsApp does not allow programmatic attachment sending, so the app opens the
// chat with a ready message and reveals the PDF in Explorer for a one-drag
// attach. This is the closest fully-supported flow.
// ============================================================================

import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Modal, Field, TextArea, Select, useToast , useErrorMessage } from './ui';
import type { Contact } from '@shared/types';
import { APP_NAME_AR } from '@shared/constants';

export function ShareReportModal({
  open, pdfPath, contacts, clientName, onClose,
}: {
  open: boolean;
  pdfPath: string;
  contacts: Contact[];
  clientName: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const errMsg = useErrorMessage();

  const allPhones = contacts.flatMap((c) => c.phones.map((p) => ({ phone: p, name: c.name })));
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    setPhone(allPhones[0]?.phone ?? '');
    setMessage(
      `السلام عليكم\nمرفق تقرير الصيانة الخاص بـ ${clientName}.\n\nمع تحيات ${APP_NAME_AR} لأنظمة المراقبة.`,
    );
  }, [open, clientName]); // eslint-disable-line react-hooks/exhaustive-deps

  const fileName = pdfPath.split(/[\\/]/).pop() ?? '';

  const share = async () => {
    if (!phone) return toast.warning(t.reports.selectPhone);
    const res = await window.alaqsa.reports.shareWhatsApp(pdfPath, phone, message);
    if (!res.ok) return toast.error(errMsg(res.error));
    onClose();
  };

  const print = async () => {
    const res = await window.alaqsa.reports.print(pdfPath);
    if (!res.ok) return toast.error(errMsg(res.error));
    onClose();
  };

  return (
    <Modal
      open={open}
      title={t.common.share}
      onClose={onClose}
      footer={<button className="btn btn-outline" onClick={onClose}>{t.common.close}</button>}
    >
      <div className="col gap-16">
        <div className="row gap-10" style={{
          padding: '12px 14px', background: 'var(--success-bg)',
          borderRadius: 'var(--radius)', color: '#15803d',
        }}>
          <span style={{ fontSize: 20 }}>✅</span>
          <div className="col">
            <span className="bold small">{t.reports.generated}</span>
            <span className="tiny mono truncate" dir="ltr">{fileName}</span>
          </div>
        </div>

        <div className="row gap-8 wrap">
          <button className="btn btn-outline grow" onClick={print}>🖨 {t.common.print}</button>
          <button className="btn btn-outline grow"
            onClick={() => { void window.alaqsa.reports.print(pdfPath); }}>
            📂 {t.common.open}
          </button>
        </div>

        <hr className="divider" />

        <div className="col gap-12">
          <span className="bold small">💬 {t.reports.shareWhatsApp}</span>

          {allPhones.length > 0 ? (
            <Field label={t.reports.selectPhone}>
              <Select
                value={phone}
                onChange={setPhone}
                options={allPhones.map((p) => ({ value: p.phone, label: `${p.name} — ${p.phone}` }))}
              />
            </Field>
          ) : (
            <Field label={t.common.phone}>
              <input className="input mono" dir="ltr" value={phone}
                onChange={(e) => setPhone(e.target.value)} placeholder="+9715xxxxxxxx" />
            </Field>
          )}

          <Field label={t.reports.messageText}>
            <TextArea value={message} onChange={setMessage} rows={4} />
          </Field>

          <div className="small muted" style={{
            padding: '10px 12px', background: 'var(--info-bg)',
            borderRadius: 'var(--radius)', lineHeight: 1.65,
          }}>
            ℹ️ {t.reports.whatsAppHint}
          </div>

          <button className="btn btn-success btn-block" onClick={share}>
            💬 {t.reports.shareWhatsApp}
          </button>
        </div>
      </div>
    </Modal>
  );
}
