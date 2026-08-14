// ============================================================================
// AlAqsa — Serial-number field with barcode/QR capture.
//
// Hardware readers behave like keyboards: they "type" the code very fast and
// end with Enter. We detect that burst pattern and treat it as a scan (rather
// than manual typing), so the field can react instantly — e.g. warn about a
// duplicate serial. A camera-based scanner is offered as a fallback for when
// no hardware reader is at hand.
// ============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import { Modal, useToast } from './ui';

/** Keystrokes arriving faster than this are considered machine input. */
const SCANNER_MAX_GAP_MS = 35;
const SCANNER_MIN_LENGTH = 4;

export function BarcodeInput({
  value, onChange, onScan, error,
}: {
  value: string;
  onChange: (v: string) => void;
  onScan?: (v: string) => void;
  error?: boolean;
}) {
  const { t } = useI18n();
  const [cameraOpen, setCameraOpen] = useState(false);
  const lastKeyTime = useRef(0);
  const burstLength = useRef(0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const now = performance.now();
    const gap = now - lastKeyTime.current;
    lastKeyTime.current = now;

    if (e.key === 'Enter') {
      // A fast burst ending in Enter is a scanner submission.
      if (burstLength.current >= SCANNER_MIN_LENGTH) {
        e.preventDefault();
        onScan?.(e.currentTarget.value.trim());
      }
      burstLength.current = 0;
      return;
    }

    if (e.key.length === 1) {
      burstLength.current = gap < SCANNER_MAX_GAP_MS ? burstLength.current + 1 : 1;
    }
  };

  return (
    <>
      <div className="row gap-6">
        <input
          className={`input mono ${error ? 'invalid' : ''}`}
          value={value}
          dir="ltr"
          placeholder={t.devices.scanHint}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="btn btn-outline btn-icon"
          title={t.devices.scanBarcode}
          onClick={() => setCameraOpen(true)}
        >
          📷
        </button>
      </div>

      <CameraScanModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onDetected={(code) => {
          setCameraOpen(false);
          onChange(code);
          onScan?.(code);
        }}
      />
    </>
  );
}

/**
 * Camera scanner using the browser's built-in BarcodeDetector when available
 * (Chromium ships it, which Electron is built on). Falls back to a clear
 * message when unsupported, so the hardware reader remains the primary path.
 */
function CameraScanModal({
  open, onClose, onDetected,
}: {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const [supported, setSupported] = useState(true);
  const [starting, setStarting] = useState(false);

  const stop = useCallback(() => {
    if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    rafRef.current = undefined;
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) { stop(); return; }

    const Detector = (window as unknown as {
      BarcodeDetector?: new (o?: { formats?: string[] }) => {
        detect(src: CanvasImageSource): Promise<{ rawValue: string }[]>;
      };
    }).BarcodeDetector;

    if (!Detector) { setSupported(false); return; }

    let cancelled = false;
    setStarting(true);

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStarting(false);

        const detector = new Detector({
          formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf'],
        });

        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const results = await detector.detect(videoRef.current);
            if (results.length > 0) {
              const raw = results[0].rawValue.trim();
              // Our own QR labels carry an ALAQSA:DEV: prefix.
              const m = /^ALAQSA:DEV:(.+)$/.exec(raw);
              stop();
              onDetected(m ? m[1] : raw);
              return;
            }
          } catch { /* keep scanning */ }
          rafRef.current = requestAnimationFrame(() => void tick());
        };
        rafRef.current = requestAnimationFrame(() => void tick());
      } catch {
        if (!cancelled) {
          setStarting(false);
          toast.error(t.msg.error);
          onClose();
        }
      }
    })();

    return () => { cancelled = true; stop(); };
  }, [open, stop, onDetected, onClose, toast, t]);

  return (
    <Modal open={open} title={t.devices.scanBarcode} onClose={onClose} size="sm">
      {!supported ? (
        <div className="empty">
          <div className="empty-icon">📷</div>
          <div className="empty-title">{t.devices.scanHint}</div>
          <p className="small muted">
            الماسح بالكاميرا غير مدعوم على هذا الجهاز — استخدم قارئ الباركود أو اكتب الرقم يدوياً.
          </p>
        </div>
      ) : (
        <div className="col gap-12 center">
          <video
            ref={videoRef}
            muted
            playsInline
            style={{
              width: '100%', borderRadius: 'var(--radius-lg)',
              background: '#000', aspectRatio: '4/3', objectFit: 'cover',
            }}
          />
          {starting && <div className="spinner" />}
          <p className="small muted text-center">{t.devices.scanHint}</p>
        </div>
      )}
    </Modal>
  );
}
