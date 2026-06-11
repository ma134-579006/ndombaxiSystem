import React, { useEffect, useRef, useState } from 'react';
import { isTouchDevice, makeDetector } from '../scan/decoder';
import { beep } from '../beep';

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
    try {
      const detect = await makeDetector(); // nativo ou ZXing (iPhone)
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);
      await new Promise((r) => setTimeout(r, 50));
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }

      let cand = ''; let n = 0; // confiança: 2 leituras iguais seguidas
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const raw = await detect(videoRef.current);
          {
            if (raw) {
              if (cand === raw) n += 1; else { cand = raw; n = 1; }
              if (n >= 2) { beep(); onDetected(raw); stop(); return; }
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

  // Computadores: sem câmara — escreve-se o código ou usa-se o leitor físico.
  if (!isTouchDevice()) return null;

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
