import React, { useEffect, useRef, useState } from 'react';

/**
 * Leitor de código de barras pela CÂMARA do telemóvel (BarcodeDetector nativo).
 * Botão que abre a câmara; ao detectar, chama onDetected(code) e fecha.
 */
export function BarcodeScanner({ onDetected }: { onDetected(code: string): void }) {
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const stop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };
  useEffect(() => () => stop(), []);

  const start = async () => {
    setErr(null);
    const BD = (window as unknown as { BarcodeDetector?: new (o?: unknown) => { detect(s: unknown): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!BD) { setErr('Este dispositivo não lê códigos pela câmara — use o leitor físico ou a pesquisa.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);
      await new Promise((r) => setTimeout(r, 50));
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
      const detector = new BD({ formats: ['ean_13', 'ean_8', 'code_128', 'upc_a', 'upc_e', 'qr_code'] } as unknown);
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes && codes.length) { onDetected(String(codes[0].rawValue).trim()); stop(); return; }
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
            <div className="scan-hint">Aponte a câmara ao código de barras…</div>
            <button className="btn ghost block" onClick={stop}>Cancelar</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
