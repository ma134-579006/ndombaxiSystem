import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ManagerProduct } from '../api/types';

/**
 * Seletor de produto por PESQUISA (nome ou código de barras) — substitui os
 * <select>. Opcionalmente lê o código de barras pela CÂMARA do telemóvel
 * (BarcodeDetector nativo; se não houver, fica só a pesquisa por texto).
 */
export function ProductPicker({
  products, value, onChange, placeholder,
}: {
  products: ManagerProduct[];
  value: string;
  onChange(productId: string): void;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const selected = products.find((p) => p.id === value) || null;

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t
      ? products.filter((p) =>
          p.name.toLowerCase().includes(t) ||
          p.code.toLowerCase().includes(t) ||
          (p.barcode ?? '').toLowerCase().includes(t))
      : products;
    return list.slice(0, 40);
  }, [q, products]);

  const stopScan = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };
  useEffect(() => () => stopScan(), []);

  const pick = (p: ManagerProduct) => { onChange(p.id); setOpen(false); setQ(''); };

  const startScan = async () => {
    setErr(null);
    const BD = (window as unknown as { BarcodeDetector?: new (o?: unknown) => { detect(s: unknown): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!BD) { setErr('Este browser não lê códigos pela câmara — pesquise pelo nome/código.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);
      await new Promise((r) => setTimeout(r, 50));
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
      const detector = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'] } as unknown);
      let cand = ''; let cn = 0; // confiança: 2 leituras iguais seguidas
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes && codes.length) {
            const raw = String(codes[0].rawValue).trim();
            if (raw) {
              if (cand === raw) cn += 1; else { cand = raw; cn = 1; }
              if (cn >= 2) {
                const p = products.find((x) => x.barcode === raw || x.code === raw);
                if (p) { pick(p); stopScan(); return; }
                setQ(raw); stopScan(); return;
              }
            }
          }
        } catch { /* frame sem código */ }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setErr('Não foi possível abrir a câmara.');
      setScanning(false);
    }
  };

  return (
    <div className="prod-picker">
      {selected ? (
        <div className="pp-selected">
          <span><strong>{selected.name}</strong> <span className="muted">({selected.code})</span></span>
          <button type="button" className="btn sm ghost" onClick={() => { onChange(''); setOpen(true); }}>Trocar</button>
        </div>
      ) : (
        <div className="pp-search">
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder ?? 'Pesquisar por nome ou código de barras…'}
          />
          <button type="button" className="btn sm ghost" title="Ler código pela câmara" onClick={() => (scanning ? stopScan() : startScan())}>
            {scanning ? 'Parar' : '📷'}
          </button>
        </div>
      )}

      {err ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{err}</div> : null}

      {scanning ? (
        <div className="pp-cam">
          <video ref={videoRef} playsInline muted />
          <div className="muted" style={{ fontSize: 12 }}>Aponte a câmara ao código de barras…</div>
        </div>
      ) : null}

      {open && !selected ? (
        <div className="pp-list">
          {matches.length === 0 ? <div className="muted" style={{ padding: 10 }}>Sem produtos.</div>
            : matches.map((p) => (
              <button type="button" key={p.id} className="pp-opt" onClick={() => pick(p)}>
                <span>{p.name}</span>
                <span className="muted">{p.code}{p.barcode ? ` · ${p.barcode}` : ''}</span>
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}
