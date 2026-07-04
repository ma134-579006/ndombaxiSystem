import React, { useEffect, useRef, useState } from 'react';
import { isTouchDevice, makeDetector } from '../scan/decoder';

/**
 * Leitor de código de barras pela CÂMARA — universal: BarcodeDetector nativo
 * (Chrome/Android) com fallback ZXing no iPhone/Safari. Só aparece em ecrãs
 * TÁTEIS (nos computadores usa-se o leitor físico/pesquisa).
 * Precisão: só aceita um código depois de o LER 2x IGUAL (evita leituras
 * erradas). Modo `continuous`: fica a ler produto após produto (com
 * arrefecimento para o mesmo código), ideal para a caixa.
 */
/** Bip curto ao reconhecer um produto. */
function beep() {
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
    const AC = Ctx.AudioContext || Ctx.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square'; o.frequency.value = 880;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    o.start();
    o.stop(ctx.currentTime + 0.18);
    o.onended = () => ctx.close().catch(() => undefined);
  } catch { /* sem áudio */ }
}

export function BarcodeScanner({
  onDetected, continuous = false,
}: { onDetected(code: string): boolean | void; continuous?: boolean }) {
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
    try {
      // Universal: nativo (Chrome/Android) ou ZXing (iPhone/Safari).
      const detect = await makeDetector();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setScanning(true);
      await new Promise((r) => setTimeout(r, 50));
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const raw = await detect(videoRef.current);
          {
            if (raw) {
              // Confiança: precisa de 2 frames iguais seguidos.
              if (candRef.current.v === raw) candRef.current.n += 1;
              else candRef.current = { v: raw, n: 1 };
              const now = Date.now();
              const cooled = !cooldownRef.current[raw] || now - cooldownRef.current[raw] > 2000;
              if (candRef.current.n >= 2 && cooled) {
                cooldownRef.current[raw] = now;
                candRef.current = { v: '', n: 0 };
                const matched = onDetected(raw) === true;
                if (matched) {
                  // Encontrou um produto cadastrado → bip e FECHA a câmara.
                  setLast(raw);
                  beep();
                  stop();
                  return;
                }
                // Código não associado a nenhum produto → continua a ler.
                setLast(raw);
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

  // Computadores: sem câmara — usa-se o leitor físico USB ou a pesquisa.
  if (!isTouchDevice()) return null;

  return (
    <>
      <button className="icon-btn" title="Ler código de barras pela câmara" onClick={() => (scanning ? stop() : start())}>
        <span style={{ fontSize: 20, display: 'inline-flex' }}>{scanning ? '✕' : <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" /><circle cx="12" cy="14" r="3.4" /></svg>}</span>
      </button>
      {err ? <div className="banner danger" style={{ position: 'absolute', zIndex: 50, marginTop: 4 }}>{err}</div> : null}
      {scanning ? (
        <div className="scan-overlay" onClick={stop}>
          <div className="scan-box" onClick={(e) => e.stopPropagation()}>
            <video ref={videoRef} playsInline muted />
            <div className="scan-hint">
              Aponte ao código de barras — ao reconhecer o produto, faz um bip, adiciona e fecha automaticamente.
            </div>
            {last ? <div className="scan-last">✓ Lido: {last}</div> : null}
            <button className="btn ghost block" onClick={stop}>{continuous ? 'Concluir' : 'Cancelar'}</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
