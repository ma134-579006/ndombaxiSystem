import React, { useEffect, useRef, useState } from 'react';

/**
 * Animação profissional de auto-escrita: escreve a frase letra a letra, faz uma
 * pausa ao completar, apaga, e recomeça (ciclo). Aceita uma frase ou várias.
 * Respeita "prefers-reduced-motion" (mostra a 1.ª frase estática).
 */
export function Typewriter({
  text,
  typingSpeed = 65,
  deletingSpeed = 35,
  pauseEnd = 1700,
  pauseStart = 500,
  className,
}: {
  text: string | string[];
  typingSpeed?: number;
  deletingSpeed?: number;
  pauseEnd?: number;
  pauseStart?: number;
  className?: string;
}) {
  const phrases = (Array.isArray(text) ? text : [text]).filter((p) => p && p.length > 0);
  const key = phrases.join(' ');
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const [display, setDisplay] = useState('');
  const [idx, setIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setDisplay(''); setIdx(0); setDeleting(false); }, [key]);

  useEffect(() => {
    if (reduce || phrases.length === 0) return;
    const full = phrases[idx % phrases.length] ?? '';
    if (!deleting && display === full) {
      timer.current = setTimeout(() => setDeleting(true), pauseEnd);
    } else if (deleting && display === '') {
      timer.current = setTimeout(() => { setDeleting(false); setIdx((i) => (i + 1) % phrases.length); }, pauseStart);
    } else {
      const next = deleting ? full.slice(0, display.length - 1) : full.slice(0, display.length + 1);
      timer.current = setTimeout(() => setDisplay(next), deleting ? deletingSpeed : typingSpeed);
    }
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [display, deleting, idx, key, reduce]);

  if (reduce || phrases.length === 0) {
    return <span className={className}>{phrases[0] ?? ''}</span>;
  }
  return (
    <span className={className} aria-label={phrases[0]}>
      {display}
      <span className="tw-caret" aria-hidden>|</span>
    </span>
  );
}
