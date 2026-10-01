import React, { useEffect, useState } from 'react';

/**
 * Avatar do utilizador logado: a FOTO (se tiver feito upload) ou as INICIAIS do
 * nome e sobrenome numa cor estável (derivada do nome). Se a foto falhar a
 * carregar, cai nas iniciais — nunca mostra um ícone genérico.
 */

const PALETTE = ['#2430E8', '#4338CA', '#1D4ED8', '#0E7490', '#0F766E', '#6D28D9', '#BE185D', '#334155'];

/** "Maria João Silva" → "MS"; "ana" → "AN"; "loja.mulher@x.com" → "LM". */
export function initialsOf(name: string | null | undefined, email?: string | null): string {
  let src = (name || '').trim();
  if (!src || src.includes('@')) src = (email || src || '').split('@')[0];
  const words = src
    .replace(/[0-9_.\-+]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function colorOf(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function UserAvatar({ photo, name, email, size = 36, className = '' }: {
  photo?: string | null; name: string; email?: string | null; size?: number; className?: string;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [photo]);
  const style: React.CSSProperties = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (photo && !broken) {
    return <img className={`u-av ${className}`} style={style} src={photo} alt={name} onError={() => setBroken(true)} />;
  }
  return (
    <span className={`u-av u-av-ini ${className}`} style={{ ...style, background: colorOf(name || email || '') }} aria-label={name} role="img">
      {initialsOf(name, email)}
    </span>
  );
}

/** Nome para mostrar: se o "nome" for um email, usa a parte antes do @. */
export function displayName(name: string | null | undefined, email?: string | null): string {
  const n = (name || '').trim();
  if (n && !n.includes('@')) return n;
  return (n || email || '').split('@')[0] || 'Utilizador';
}
