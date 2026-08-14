// ============================================================================
// AlAqsa — QR / barcode generation for device labels.
//
// Each device gets a printable QR sticker. Scanning it (with the app's scan
// field or any reader) yields "ALAQSA:DEV:<id>" which the app resolves to the
// device record, or the serial number for third-party scanners.
// ============================================================================

import QRCode from 'qrcode';
import type { Device } from '@shared/types';

export function deviceQrPayload(device: Device): string {
  return `ALAQSA:DEV:${device.id}`;
}

export async function deviceQrDataUrl(device: Device): Promise<string> {
  return QRCode.toDataURL(deviceQrPayload(device), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
    color: { dark: '#0B4F8A', light: '#FFFFFF' },
  });
}

export async function textQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
}

/** Parse a scanned string: returns a device id when it is one of our labels. */
export function parseScan(scanned: string): { kind: 'device'; id: string } | { kind: 'serial'; serial: string } {
  const m = /^ALAQSA:DEV:(.+)$/.exec(scanned.trim());
  if (m) return { kind: 'device', id: m[1] };
  return { kind: 'serial', serial: scanned.trim() };
}
