import React, { useEffect, useRef } from 'react';

/**
 * VÍDEO DE FUNDO do login — filmagem REAL (pagamento com cartão num terminal
 * POS · Pexels, licença livre) em loop atrás do cartão de login, com um véu
 * gradiente para manter a leitura. NÃO altera a estrutura do login: é uma
 * camada fixa por baixo de tudo.
 *
 * Leve: telemóveis carregam a versão SD (~1 MB), desktops a HD (~3,7 MB);
 * `muted/playsInline` permite autoplay também no iPhone; com
 * prefers-reduced-motion o vídeo não toca (fica o gradiente).
 */
export function LoginShowcase() {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // SD nos ecrãs pequenos/táteis; HD no desktop.
    const small = window.innerWidth < 900 || window.matchMedia('(pointer: coarse)').matches;
    v.src = small ? '/media/login-bg-sd.mp4' : '/media/login-bg-hd.mp4';
    v.play().catch(() => undefined); // se o autoplay falhar, fica o gradiente
  }, []);

  return (
    <div className="login-video" aria-hidden>
      <video ref={ref} muted loop playsInline autoPlay preload="metadata" />
      <div className="login-video-veil" />
    </div>
  );
}
