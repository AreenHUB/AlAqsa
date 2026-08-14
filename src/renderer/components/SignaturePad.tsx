// ============================================================================
// AlAqsa — Canvas signature capture (mouse, pen or touch).
// The drawn signature is exported as a PNG data URL and stored encrypted.
// ============================================================================

import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';

export function SignaturePad({
  label, saved, onSave, onClear,
}: {
  label: string;
  saved: boolean;
  onSave: (dataUrl: string) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  // Size the canvas to its container at device pixel ratio for crisp lines.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasInk) setHasInk(true);
  };

  const end = () => { drawing.current = false; };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onClear();
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk) return;
    // Flatten onto white so the PNG reads well in printed reports.
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const octx = out.getContext('2d');
    if (!octx) return;
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(canvas, 0, 0);
    onSave(out.toDataURL('image/png'));
  };

  return (
    <div className="card">
      <div className="card-head" style={{ padding: '10px 14px' }}>
        <span className="card-title" style={{ fontSize: 13 }}>{label}</span>
        {saved && <span className="badge badge-success">✓</span>}
      </div>
      <div className="card-body" style={{ padding: 12 }}>
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          style={{
            width: '100%', height: 130,
            border: '1px dashed var(--border-strong)',
            borderRadius: 'var(--radius)',
            background: '#fff',
            touchAction: 'none',
            cursor: 'crosshair',
            display: 'block',
          }}
        />
        <div className="row gap-6 mt-8">
          <button className="btn btn-outline btn-sm grow" onClick={clear}>
            {t.visits.clearSignature}
          </button>
          <button className="btn btn-primary btn-sm grow" onClick={save} disabled={!hasInk}>
            💾 {t.common.save}
          </button>
        </div>
        {!hasInk && !saved && (
          <div className="tiny faint text-center mt-8">{t.visits.signHere}</div>
        )}
      </div>
    </div>
  );
}
