import React, { useEffect, useRef, useState } from 'react';

/**
 * Leitor de código de barras pela CÂMARA (BarcodeDetector nativo).
 * Precisão: só aceita um código depois de o LER 2x IGUAL (evita leituras
 * erradas). Modo `continuous`: fica a ler produto após produto (com
 * arrefecimento para o mesmo código), ideal para a caixa.
 */
export function BarcodeScanner({
  onDetected, continuous = false,
}: { onDetected(code: string): void; continuous?: boolean }) {
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  // confiança: valor candidato + nº de frames iguais seguidos
  const candRef = useRef<{ v: string; n: number }>({ v: '', n: 0 });
  const cooldownRef = useRef<Record<string, number>>({});

  const stop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    candRef.current = { v: '', n: 0 };
    setScanning(false);
  };
  useEffect(() => () => stop(), []);

  const start = async () => {
    setErr(null); setLast(null);
    const BD = (window as unknown as { BarcodeDetector?: new (o?: unknown) => { detect(s: unknown): Promise<{ rawValue: string; format?: string }[]> } }).BarcodeDetector;
    if (!BD) { setErr('Este dispositivo não lê códigos pela câmara — use o leitor físico ou a pesquisa.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);
      await new Promise((r) => setTimeout(r, 50));
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
      // Só formatos de retalho lineares (sem QR) — reduz leituras erradas.
      const detector = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'] } as unknown);
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes && codes.length) {
            const raw = String(codes[0].rawValue).trim();
            if (raw) {
              // Confiança: precisa de 2 frames iguais seguidos.
              if (candRef.current.v === raw) candRef.current.n += 1;
              else candRef.current = { v: raw, n: 1 };
              const now = Date.now();
              const cooled = !cooldownRef.current[raw] || now - cooldownRef.current[raw] > 2000;
              if (candRef.current.n >= 2 && cooled) {
                cooldownRef.current[raw] = now;
                candRef.current = { v: '', n: 0 };
                setLast(raw);
                onDetected(raw);
                if (!continuous) { stop(); return; }
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
    <>
      <button className="icon-btn" title="Ler código de barras pela câmara" onClick={() => (scanning ? stop() : start())}>
        <span style={{ fontSize: 20 }}>{scanning ? '✕' : '📷'}</span>
      </button>
      {err ? <div className="banner danger" style={{ position: 'absolute', zIndex: 50, marginTop: 4 }}>{err}</div> : null}
      {scanning ? (
        <div className="scan-overlay" onClick={stop}>
          <div className="scan-box" onClick={(e) => e.stopPropagation()}>
            <video ref={videoRef} playsInline muted />
            <div className="scan-hint">
              {continuous ? 'Aponte ao código — lê automaticamente. Continue a ler os produtos.' : 'Aponte a câmara ao código de barras…'}
            </div>
            {last ? <div className="scan-last">✓ Lido: {last}</div> : null}
            <button className="btn ghost block" onClick={stop}>{continuous ? 'Concluir' : 'Cancelar'}</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
