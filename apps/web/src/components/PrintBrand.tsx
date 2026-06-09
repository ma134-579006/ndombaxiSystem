import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { DocumentIdentity } from '../api/types';

/** Cache do branding (1 pedido por sessão — partilhado pelo cabeçalho e rodapé). */
let cached: DocumentIdentity | null = null;
let pending: Promise<DocumentIdentity | null> | null = null;
function loadBranding(): Promise<DocumentIdentity | null> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = api.branding().then((b) => { cached = b; return b; }).catch(() => null);
  }
  return pending;
}

function useBranding(): DocumentIdentity | null {
  const [b, setB] = useState<DocumentIdentity | null>(cached);
  useEffect(() => { let on = true; void loadBranding().then((r) => { if (on && r) setB(r); }); return () => { on = false; }; }, []);
  return b;
}

/**
 * Cabeçalho de IMPRESSÃO (estilo Primavera/Vendus): logo + nome + NIF da empresa
 * + título da página + data. Invisível no ecrã (`print-only`); colocado no Shell,
 * aparece automaticamente em TODAS as impressões do painel.
 */
export function PrintBrandHead({ title }: { title?: string }) {
  const b = useBranding();
  return (
    <div className="print-only doc-print-head">
      {b?.logoUrl ? <img src={b.logoUrl} alt="" className="dph-logo" /> : null}
      <div className="dph-co">{b?.companyName || b?.brandName || ''}</div>
      {b?.nif ? <div className="dph-nif">NIF: {b.nif}</div> : null}
      {title ? <div className="dph-title">{title}</div> : null}
      <div className="dph-period">Emitido em {new Date().toLocaleString('pt-PT')}</div>
    </div>
  );
}

/** Rodapé de IMPRESSÃO: morada, contactos e dizeres da empresa. */
export function PrintBrandFoot() {
  const b = useBranding();
  return (
    <div className="print-only doc-print-foot">
      {b?.address ? <div>{b.address}</div> : null}
      {(b?.phone || b?.email) ? <div>{[b?.phone, b?.email].filter(Boolean).join(' · ')}</div> : null}
      {b?.receiptMessage ? <div>{b.receiptMessage}</div> : null}
      {b?.copyright ? <div>{b.copyright}</div> : null}
    </div>
  );
}
