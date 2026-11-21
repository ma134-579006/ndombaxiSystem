import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { DocumentIdentity, EmittedInvoice } from '../api/types';
import { formatKz } from '../format';

/** Venda cujo documento fiscal é do motor externo (resposta do POS ou série interna VND na 2.ª via). */
export function isExternalFiscal(invoice: EmittedInvoice): boolean {
  return invoice.fiscal?.engine === 'VENDUS' || /^[A-Z]{2} VND\d{4}\//.test(invoice.number ?? '');
}

const STATE_LABEL: Record<string, string> = {
  A_PREPARAR: 'A preparar',
  A_ENVIAR: 'A enviar',
  CRIADO_NO_VENDUS: 'Criado no Cegid Vendus',
  COMUNICACAO_AGT_PENDENTE: 'Comunicação AGT pendente',
  AGT_ACEITE: 'Aceite pela AGT',
  AGT_REJEITADO: 'Rejeitado pela AGT',
  ESTADO_DESCONHECIDO: 'A confirmar com o Cegid Vendus',
  ERRO_DE_COMUNICACAO: 'Erro de comunicação',
  CORRECCAO_NECESSARIA: 'Correcção necessária',
};

/**
 * Documento fiscal emitido pelo Cegid Vendus. O LPS só apresenta e abre o PDF
 * ORIGINAL devolvido pelo Vendus (série, número, hash e QR intactos).
 */
export function ExternalFiscalReceipt({ invoice, identity, onClose }: { invoice: EmittedInvoice; identity: DocumentIdentity | null; onClose(): void }) {
  const [doc, setDoc] = useState<{ id: string | null; state: string; number: string | null; pdf: boolean; error: string | null } | null>(invoice.fiscal ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.externalFiscal(invoice.id);
      setDoc(r ? { id: r.id, state: r.state, number: r.number, pdf: r.has_pdf, error: r.last_error } : null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha ao consultar');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!invoice.fiscal) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.id]);

  const openPdf = async (print: boolean) => {
    if (!doc?.id) return;
    setBusy(true);
    setErr(null);
    try {
      const blob = await api.externalFiscalPdf(doc.id);
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (print && w) w.addEventListener('load', () => w.print(), { once: true });
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'PDF indisponível');
    } finally {
      setBusy(false);
    }
  };

  const issued = !!doc?.number;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card receipt efr" onClick={(e) => e.stopPropagation()}>
        {identity && (identity.companyName || identity.brandName) ? <div className="vrc-co">{identity.companyName || identity.brandName}</div> : null}
        <dl className="efr-dl">
          <dt>Documento fiscal</dt>
          <dd className="efr-no">{issued ? doc!.number : 'Pendente'}</dd>
          <dt>Software de facturação</dt>
          <dd>Cegid Vendus</dd>
          <dt>Estado</dt>
          <dd>{STATE_LABEL[doc?.state ?? ''] ?? doc?.state ?? '—'}</dd>
          <dt>Total</dt>
          <dd>{formatKz(invoice.grossTotal)}</dd>
          <dt>Ref. interna LPS</dt>
          <dd className="efr-ref">{invoice.internalNumber ?? invoice.number}</dd>
        </dl>
        {doc?.error && !issued ? <div className="vrc-note">{doc.error}</div> : null}
        {err ? <div className="vrc-note">{err}</div> : null}
        <div className="efr-actions">
          <button className="btn primary" disabled={busy || !doc?.pdf} onClick={() => void openPdf(true)}>Imprimir original</button>
          <button className="btn" disabled={busy || !doc?.pdf} onClick={() => void openPdf(false)}>Abrir PDF</button>
          <button className="btn ghost" disabled={busy} onClick={() => void refresh()}>Actualizar</button>
          <button className="btn ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
