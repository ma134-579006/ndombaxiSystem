import { useEffect, useState } from 'react';
import { api } from '../api/client';

/** Selo na barra da caixa quando a facturação desta empresa é emitida pelo Cegid
 *  Vendus (software validado pela AGT). Sem motor Vendus activo não aparece: o
 *  LPS Vendas nunca se apresenta como certificado. */
export function VendusSeal() {
  const [seal, setSeal] = useState<{ validationNo?: string; feCertNo?: string; validUntil?: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.fiscalBadge()
      .then((b) => { if (alive) setSeal(b.vendus ? b : null); })
      .catch(() => undefined);
    void load();
    const t = window.setInterval(load, 10 * 60 * 1000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  if (!seal) return null;
  const parts = ['Facturação emitida pelo Cegid Vendus, software validado pela AGT'];
  if (seal.validationNo) parts.push(seal.validationNo);
  if (seal.feCertNo) parts.push(seal.feCertNo);
  if (seal.validUntil) parts.push(`válido até ${new Date(`${seal.validUntil}T00:00:00`).toLocaleDateString('pt-PT')}`);
  const tip = parts.join(' · ');
  return (
    <span className="vsub vseal" tabIndex={0} aria-label={tip}>
      <span className="vsub-tip" role="tooltip">{tip}</span>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
      <span className="vseal-tx"><b>Vendus</b><small>Facturação certificada</small></span>
    </span>
  );
}
