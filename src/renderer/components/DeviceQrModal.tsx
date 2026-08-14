// ============================================================================
// AlAqsa — Printable QR label for a device. Stick it on the camera/NVR; a scan
// later opens that device's record instantly.
// ============================================================================

import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Modal, Loading } from './ui';
import type { Device } from '@shared/types';
import { DEVICE_TYPES } from '@shared/constants';

export function DeviceQrModal({
  device, onClose,
}: {
  device: Device | null;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    if (!device) { setDataUrl(''); return; }
    void window.alaqsa.devices.qrDataUrl(device.id).then((res) => {
      if (res.ok) setDataUrl(res.data);
    });
  }, [device]);

  if (!device) return null;

  const typeLabel = (() => {
    const d = DEVICE_TYPES.find((x) => x.value === device.type);
    return d ? (lang === 'ar' ? d.ar : d.en) : device.type;
  })();

  const print = () => {
    const w = window.open('', '_blank', 'width=420,height=560');
    if (!w) return;
    w.document.write(`
      <html dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><title>${device.label ?? typeLabel}</title>
      <style>
        @page { margin: 8mm; }
        body { font-family: Tahoma, Arial, sans-serif; text-align: center; padding: 10px; }
        .label { border: 2px solid #0B4F8A; border-radius: 10px; padding: 14px; display: inline-block; }
        .brand { color: #0B4F8A; font-weight: bold; font-size: 13px; margin-bottom: 6px; }
        img { width: 190px; height: 190px; }
        .name { font-weight: bold; font-size: 15px; margin-top: 8px; }
        .meta { font-size: 11px; color: #444; margin-top: 3px; }
        .sn { font-family: Consolas, monospace; font-size: 12px; margin-top: 5px; direction: ltr; }
      </style></head><body>
      <div class="label">
        <div class="brand">${t.appName} — AlAqsa CCTV</div>
        <img src="${dataUrl}" />
        <div class="name">${device.label ?? typeLabel}</div>
        <div class="meta">${typeLabel}${device.model ? ' · ' + device.model : ''}</div>
        ${device.serialNumber ? `<div class="sn">S/N: ${device.serialNumber}</div>` : ''}
      </div>
      <script>window.onload = () => { window.print(); }</script>
      </body></html>`);
    w.document.close();
  };

  return (
    <Modal
      open={!!device}
      title={t.devices.qrLabel}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>{t.common.close}</button>
          <button className="btn btn-primary" onClick={print} disabled={!dataUrl}>
            🖨 {t.devices.printQr}
          </button>
        </>
      }
    >
      <div className="col center gap-12">
        {!dataUrl ? <Loading /> : (
          <>
            <div style={{
              padding: 14, border: '2px solid var(--primary-700)',
              borderRadius: 'var(--radius-lg)', background: '#fff', textAlign: 'center',
            }}>
              <div style={{ color: '#0B4F8A', fontWeight: 700, fontSize: 12, marginBottom: 6 }}>
                {t.appName} — AlAqsa CCTV
              </div>
              <img src={dataUrl} alt="QR" style={{ width: 180, height: 180, display: 'block' }} />
              <div style={{ fontWeight: 700, fontSize: 14, marginTop: 8, color: '#111' }}>
                {device.label ?? typeLabel}
              </div>
              <div style={{ fontSize: 11, color: '#444' }}>
                {typeLabel}{device.model ? ` · ${device.model}` : ''}
              </div>
              {device.serialNumber && (
                <div className="mono" style={{ fontSize: 11, marginTop: 4, color: '#111', direction: 'ltr' }}>
                  S/N: {device.serialNumber}
                </div>
              )}
            </div>
            <p className="small muted text-center">{t.devices.qrHint}</p>
          </>
        )}
      </div>
    </Modal>
  );
}
