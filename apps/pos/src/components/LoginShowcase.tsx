import React, { useEffect, useRef } from 'react';

/**
 * VÍDEO DE FUNDO do login — nível enterprise:
 *   • DUAS filmagens REAIS em alternância suave (crossfade 22 s, loop):
 *     ① dados/código a correr num monitor (tecnologia) e
 *     ② pagamento com cartão num terminal POS (compra) — Pexels, licença livre;
 *   • gradação DUOTONE azul-ciano (cores tecnológicas — mata os tons castanhos);
 *   • grelha digital + varrimento de luz + scanline por cima (HUD subtil).
 *
 * Leve: ecrãs táteis carregam SD (~1 MB cada); o 2.º vídeo só começa a
 * descarregar depois do 1.º estar a tocar; com prefers-reduced-motion não toca.
 * NÃO altera a estrutura do login — é uma camada fixa por baixo de tudo.
 */
export function LoginShowcase() {
  const aRef = useRef<HTMLVideoElement | null>(null);
  const bRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const a = aRef.current, b = bRef.current;
    if (!a || !b) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // LEVE E RÁPIDO: SD em todo o lado (1.1 MB vs 3.8 MB do HD) — o HD tornava a
    // Caixa lenta a abrir. O vídeo é ENRIQUECIMENTO: o ecrã pinta já com o fundo
    // tecnológico em CSS (grelha + varrimento + scanline) e os clips entram depois,
    // sem bloquear o primeiro frame nem o login.
    const q = 'sd';
    // Caminho RELATIVO à base do build (`import.meta.env.BASE_URL`): na app
    // instalada (base `./`) resolve para `./media/…` — os clips estão empacotados
    // no módulo e TOCAM OFFLINE. Absoluto `/media/…` apontava para a raiz errada.
    const base = import.meta.env.BASE_URL || '/';
    const t1 = window.setTimeout(() => {
      a.src = `${base}media/login-tech-${q}.mp4`;
      a.play().catch(() => undefined);
    }, 250);
    const t2 = window.setTimeout(() => {
      b.src = `${base}media/login-bg-${q}.mp4`;
      b.play().catch(() => undefined);
    }, 2400);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, []);

  return (
    <div className="login-video" aria-hidden>
      <video ref={aRef} className="lv-a" muted loop playsInline preload="none" />
      <video ref={bRef} className="lv-b" muted loop playsInline preload="none" />
      {/* duotone tecnológico (azul/ciano) por cima das filmagens */}
      <div className="lv-tone" />
      {/* HUD: grelha digital + varrimento + scanline */}
      <div className="lv-grid" />
      <div className="lv-sweep" />
      <div className="lv-scan" />
      <div className="login-video-veil" />
    </div>
  );
}
