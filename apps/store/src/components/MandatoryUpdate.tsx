import React, { useEffect, useState } from 'react';
import { API_URL } from '../config';
import { isNativeApp } from '../native';

/**
 * ATUALIZAÇÃO OBRIGATÓRIA da app LPS Loja (Android).
 *
 * REGRA PERMANENTE (igual à Gestão e à Caixa): quando o CI publica uma versão
 * nova, o servidor regista-a sozinho e esta app — se for mais antiga — fica
 * bloqueada, com o botão para a página oficial. No site (navegador) não se
 * aplica: o site atualiza-se ao recarregar.
 *
 * Regras de segurança (as mesmas de @nexus/update-core):
 *  - sem resposta do servidor NÃO se bloqueia (cliente sem rede continua a ver a loja);
 *  - só se bloqueia com uma versão oficial válida e MAIOR do que a instalada;
 *  - o botão só abre páginas https.
 */
const INSTALLED = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '';
const OFFICIAL_PAGE = 'https://ndombaxisystem.com/baixar';
const EVERY_MS = 15 * 60 * 1000;

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0), pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

interface Official { version: string; downloadPageUrl: string }

/** Decide se a versão instalada tem de ser bloqueada (puro — testável). */
export function mustBlock(installed: string, raw: unknown): Official | null {
  if (!/^\d+(\.\d+)*/.test(installed)) return null;
  const r = raw as { version?: unknown; mandatory?: unknown; downloadPageUrl?: unknown; channel?: unknown } | null;
  if (!r || typeof r.version !== 'string' || !/^\d+(\.\d+)*/.test(r.version)) return null;
  if (r.channel && r.channel !== 'production') return null;
  if (compareVersions(r.version, installed) <= 0) return null;
  if (r.mandatory === false) return null;
  const page = typeof r.downloadPageUrl === 'string' && /^https:\/\/\S+$/i.test(r.downloadPageUrl) ? r.downloadPageUrl : OFFICIAL_PAGE;
  return { version: r.version, downloadPageUrl: page };
}

export function MandatoryUpdate() {
  const [block, setBlock] = useState<Official | null>(null);

  useEffect(() => {
    if (!isNativeApp || !INSTALLED) return;
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(`${API_URL}/downloads/latest?platform=android-loja`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return; // servidor sem resposta útil → não bloqueia
        const raw = await res.json().catch(() => null);
        const b = mustBlock(INSTALLED, raw);
        if (alive && b) setBlock(b);
      } catch { /* sem rede → não bloqueia */ }
    };
    const t = window.setTimeout(() => void check(), 3000);
    const i = window.setInterval(() => void check(), EVERY_MS);
    const vis = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', vis);
    return () => { alive = false; clearTimeout(t); clearInterval(i); document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', vis); };
  }, []);

  if (!block) return null;
  return (
    <div className="mu-wrap" role="alertdialog" aria-modal="true" aria-label="Atualização obrigatória">
      <div className="mu-card">
        <div className="mu-brand">LPS Loja</div>
        <h1>Nova versão disponível</h1>
        <p>Foi publicada uma nova versão da app. Para continuar a comprar é obrigatório atualizar.</p>
        <div className="mu-vers">
          <div><span>Versão instalada</span><b>{INSTALLED}</b></div>
          <div className="new"><span>Nova versão</span><b>{block.version}</b></div>
        </div>
        <a className="mu-btn" href={block.downloadPageUrl} target="_blank" rel="noreferrer">Atualizar Agora</a>
      </div>
    </div>
  );
}
