import React, { useEffect, useRef, useState } from 'react';

/**
 * Botão + leitor de código de barras pela CÂMARA do telemóvel (BarcodeDetector
 * nativo). Ao detectar, chama onDetected(code). Se o browser não suportar,
 * mostra aviso. Reutilizável (criar produto, caixa, etc.).
 */
export function BarcodeScanner({
  onDetected, label = '📷 Ler código', title = 'Ler código de barras pela câmara',
}: {
  onDetected(code: string): void;
  label?: string;
  title?: string;
}) {
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
    if (!BD) { setErr('Este browser não lê códigos pela câmara — escreva o código manualmente.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);
      await new Promise((r) => setTimeout(r, 50));
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
      const detector = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'] } as unknown);
      let cand = ''; let n = 0; // confiança: 2 leituras iguais seguidas
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes && codes.length) {
            const raw = String(codes[0].rawValue).trim();
            if (raw) {
              if (cand === raw) n += 1; else { cand = raw; n = 1; }
              if (n >= 2) { onDetected(raw); stop(); return; }
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
    <div>
      <button type="button" className="btn sm ghost" title={title} onClick={() => (scanning ? stop() : start())}>
        {scanning ? 'Parar câmara' : label}
      </button>
      {err ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{err}</div> : null}
      {scanning ? (
        <div className="pp-cam" style={{ marginTop: 6 }}>
          <video ref={videoRef} playsInline muted />
          <div className="muted" style={{ fontSize: 12 }}>Aponte a câmara ao código de barras…</div>
        </div>
      ) : null}
    </div>
  );
}
