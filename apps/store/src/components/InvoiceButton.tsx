import React, { useState } from 'react';
import { downloadOrderInvoice } from '../views/Track';

/**
 * Botão "Fatura" das listas de encomendas do cliente (loja online, loja dos
 * associados e LPS Kwanza): descarrega o PDF da fatura dessa encomenda.
 */
export function InvoiceButton({ code, orderId, number, annulled, className }: {
  code: string; orderId: string; number?: string | null; annulled?: boolean | null; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    if (busy) return;
    setBusy(true); setErr(null);
    try { await downloadOrderInvoice(code, orderId); }
    catch (x) { setErr(x instanceof Error ? x.message : 'Não foi possível obter a fatura.'); }
    finally { setBusy(false); }
  };
  return (
    <span className="inv-btn-wrap" style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
      <button type="button" className={className ?? 'btn sm ghost'} onClick={(e) => void go(e)} disabled={busy}
        title={number ? `Descarregar a fatura ${number}` : 'Descarregar a fatura'}>
        {busy ? 'A obter…' : 'Fatura PDF'}{number ? <span translate="no" style={{ fontWeight: 400, opacity: 0.8 }}> · {number}</span> : null}
        {annulled ? <span style={{ color: '#b91c1c', fontWeight: 600 }}> · Anulada</span> : null}
      </button>
      {err ? <small role="alert" style={{ color: '#b91c1c', maxWidth: 260 }}>{err}</small> : null}
    </span>
  );
}
