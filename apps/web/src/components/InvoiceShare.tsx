import React from 'react';
import { api } from '../api/client';
import { runTransfer } from './feedback';
import { Modal } from './ui';
import { formatKz } from '../format';

/** Gera e descarrega o PDF da fatura (fatura física = imprimir; digital = enviar o PDF). */
export async function invoicePdf(invoiceId: string): Promise<void> {
  await runTransfer({ title: 'A gerar a fatura em PDF', kind: 'generate', task: async () => {
    const [{ buildInvoicePdf, invoiceFileName }, sale, identity] = await Promise.all([
      import('../pdf/invoicePdf'), api.sales.detail(invoiceId), api.branding().catch(() => null),
    ]);
    const pdf = await buildInvoicePdf(sale, identity);
    pdf.save(invoiceFileName(sale));
  } });
}

export type IssuedInvoice = { id: string; number: string; total: number };

/** Depois de faturar: o cliente escolhe fatura física (imprimir) ou digital (PDF, WhatsApp, e-mail). */
export function InvoiceShareModal({ inv, onClose, phone }: { inv: IssuedInvoice; onClose(): void; phone?: string | null }) {
  const msg = `Fatura ${inv.number} — ${formatKz(inv.total)}. Obrigado pela preferência!`;
  const wa = phone ? phone.replace(/[^\d]/g, '').replace(/^(?!244)(\d{9})$/, '244$1') : '';
  return (
    <Modal title={`Fatura ${inv.number}`} onClose={onClose}>
      <div className="rt-inv-total"><span>Total</span><strong>{formatKz(inv.total)}</strong></div>
      <div className="rt-inv-opts">
        <button className="vd-btn" onClick={() => void invoicePdf(inv.id)}>Imprimir (fatura física)</button>
        <button className="vd-btn outline" onClick={() => void invoicePdf(inv.id)}>Descarregar PDF</button>
        <a className="vd-btn outline" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`}>Enviar por WhatsApp</a>
        <a className="vd-btn outline" href={`mailto:?subject=${encodeURIComponent(`Fatura ${inv.number}`)}&body=${encodeURIComponent(msg)}`}>Enviar por e-mail</a>
      </div>
      <button className="btn ghost block" style={{ marginTop: 10 }} onClick={onClose}>Concluir</button>
    </Modal>
  );
}
