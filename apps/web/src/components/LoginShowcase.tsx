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
    const small = window.innerWidth < 900 || window.matchMedia('(pointer: coarse)').matches;
    const q = small ? 'sd' : 'hd';
    a.src = `/media/login-tech-${q}.mp4`;
    a.play().catch(() => undefined);
    // o clip de compra carrega DEPOIS (não atrasa o primeiro frame)
    const t = window.setTimeout(() => {
      b.src = `/media/login-bg-${q}.mp4`;
      b.play().catch(() => undefined);
    }, 1800);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="login-video" aria-hidden>
      <video ref={aRef} className="lv-a" muted loop playsInline autoPlay preload="auto" />
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
