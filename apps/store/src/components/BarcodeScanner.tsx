import React, { useEffect, useRef, useState } from 'react';
import { beep } from '../beep';

/**
 * Leitor de código de barras pela CÂMARA do telemóvel (BarcodeDetector nativo)
 * para a loja online. Ao reconhecer um código associado a um produto, faz BIP,
 * adiciona/encontra e FECHA a câmara automaticamente. Se o código não existir,
 * continua a ler. Precisão: só aceita depois de 2 leituras iguais seguidas.
 *
 * `onDetected(code)` deve devolver `true` se o código corresponde a um produto
 * (para fazer bip + fechar); caso contrário a câmara continua a ler.
 */
export function BarcodeScanner({ onDetected }: { onDetected(code: string): boolean | void }) {
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
    if (!BD) { setErr('Este telemóvel não lê códigos pela câmara — procure pelo nome.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);
      await new Promise((r) => setTimeout(r, 50));
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
      const detector = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'] } as unknown);
      let cand = ''; let cn = 0;
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes && codes.length) {
            const raw = String(codes[0].rawValue).trim();
            if (raw) {
              if (cand === raw) cn += 1; else { cand = raw; cn = 1; }
              if (cn >= 2) {
                const matched = onDetected(raw) === true;
                if (matched) { beep(); stop(); return; }
                cand = ''; cn = 0; // não encontrado → continua a ler
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
      <button type="button" className="scan-btn" title="Procurar produto pela câmara" onClick={() => (scanning ? stop() : start())}>
        <span style={{ fontSize: 20 }}>{scanning ? '✕' : '📷'}</span>
      </button>
      {err ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{err}</div> : null}
      {scanning ? (
        <div className="scan-overlay" onClick={stop}>
          <div className="scan-box" onClick={(e) => e.stopPropagation()}>
            <video ref={videoRef} playsInline muted />
            <div className="scan-hint">Aponte ao código de barras — faz um bip e adiciona ao reconhecer o produto.</div>
            <button type="button" className="scan-cancel" onClick={stop}>Cancelar</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
