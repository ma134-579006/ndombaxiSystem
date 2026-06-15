import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { DocumentIdentity, EmittedInvoice, ReceiptFiscalInfo } from '../api/types';
import { formatDateTime, formatKz } from '../format';
import { IconCheck } from './Icons';
import { PaperSizeToggle } from './PaperSizeToggle';
import { buildInvoicePdf, invoiceFileName } from '../pdf/invoicePdf';

interface Props {
  invoice: EmittedInvoice;
  info: ReceiptFiscalInfo | null;
  identity?: DocumentIdentity | null;
  customerName?: string | null;
  /** Nome do operador (funcionário) que emitiu — impresso no recibo. */
  operatorName?: string | null;
  /** Venda guardada offline: comprovativo PROVISÓRIO (sem nº fiscal ainda). */
  provisional?: boolean;
  onClose(): void;
}

/** Recibo/comprovativo da venda emitida — identidade da empresa + dados fiscais AGT (§7). */
export function ReceiptModal({ invoice, info, identity, customerName, operatorName, provisional, onClose }: Props) {
  const hashShort = invoice.hash ? invoice.hash.slice(0, 4) : '----';
  // Conteúdo do QR de verificação (campos-chave do documento).
  const qrData = [
    identity?.companyName || identity?.brandName || 'Documento', invoice.number,
    identity?.nif ? `NIF:${identity.nif}` : '',
    `Total:${invoice.grossTotal}`, `IVA:${invoice.ivaTotal}`,
    new Date().toISOString().slice(0, 10),
    invoice.hash ? `H:${invoice.hash.slice(0, 16)}` : '',
  ].filter(Boolean).join('|');
  const companyMeta = identity
    ? [identity.nif ? `NIF ${identity.nif}` : '', identity.address ?? ''].filter(Boolean).join(' · ')
    : '';

  // FATURA DIGITAL por WhatsApp: monta um resumo legível do documento e abre o
  // WhatsApp (app/Web) pronto a enviar. Funciona no telemóvel e no PC, sem app.
  const shareWhatsApp = () => {
    const empresa = identity?.companyName || identity?.brandName || 'Fatura';
    const linhas: string[] = [`*${empresa}*`];
    if (identity?.nif) linhas.push(`NIF: ${identity.nif}`);
    linhas.push('', `${provisional ? 'Comprovativo' : 'Fatura'}: ${invoice.number}`, `Data: ${formatDateTime()}`);
    if (customerName) linhas.push(`Cliente: ${customerName}`);
    linhas.push(
      '',
      `Base tributável: ${formatKz(invoice.netTotal)}`,
      `IVA: ${formatKz(invoice.ivaTotal)}`,
      `*Total: ${formatKz(invoice.grossTotal)}*`,
    );
    if (!provisional && invoice.hash) linhas.push(`Controlo (Hash): ${hashShort}`);
    if (identity?.phone || identity?.email) linhas.push('', [identity?.phone, identity?.email].filter(Boolean).join(' · '));
    linhas.push('', identity?.receiptMessage || 'Obrigado pela preferência!');
    const texto = encodeURIComponent(linhas.join('\n'));
    // Se a Web Share API existir (telemóvel), deixa o utilizador escolher WhatsApp
    // e qualquer outra app; senão abre o WhatsApp diretamente por wa.me.
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string }) => Promise<void> };
    if (nav.share) {
      void nav.share({ title: `${empresa} · ${invoice.number}`, text: decodeURIComponent(texto) }).catch(() => {
        window.open(`https://wa.me/?text=${texto}`, '_blank', 'noopener');
      });
    } else {
      window.open(`https://wa.me/?text=${texto}`, '_blank', 'noopener');
    }
  };

  const [pdfBusy, setPdfBusy] = useState(false);
  const makePdf = () => buildInvoicePdf({ invoice, identity, info, customerName, operatorName, provisional });

  const downloadPdf = async () => {
    setPdfBusy(true);
    try { (await makePdf()).save(invoiceFileName(invoice)); }
    catch { alert('Não foi possível gerar o PDF.'); }
    finally { setPdfBusy(false); }
  };

  // Partilha o PDF como FICHEIRO (WhatsApp e outras apps). No telemóvel usa a
  // partilha nativa; no PC descarrega o PDF e abre o WhatsApp com o resumo.
  const sharePdfWhatsApp = async () => {
    setPdfBusy(true);
    try {
      const doc = await makePdf();
      const blob = doc.output('blob');
      const file = new File([blob], invoiceFileName(invoice), { type: 'application/pdf' });
      const nav = navigator as Navigator & {
        share?: (d: { files?: File[]; title?: string; text?: string }) => Promise<void>;
        canShare?: (d: { files?: File[] }) => boolean;
      };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: invoice.number, text: `${identity?.companyName || identity?.brandName || 'Fatura'} · ${invoice.number}` });
      } else {
        doc.save(invoiceFileName(invoice)); // PC: descarrega
        shareWhatsApp(); // e abre o WhatsApp com o resumo (anexa o PDF descarregado)
      }
    } catch { shareWhatsApp(); }
    finally { setPdfBusy(false); }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card receipt" onClick={(e) => e.stopPropagation()}>
        {identity && (identity.companyName || identity.brandName) ? (
          <div className="r-company">
            {identity.logoUrl ? <img src={identity.logoUrl} alt={identity.companyName} /> : null}
            <div>
              <div className="c-name">{identity.companyName || identity.brandName}</div>
              {companyMeta ? <div className="c-meta">{companyMeta}</div> : null}
            </div>
          </div>
        ) : null}

        <div className="r-head" style={provisional ? { background: 'var(--warning-soft, rgba(245,158,11,.14))', borderColor: 'rgba(245,158,11,.4)' } : undefined}>
          <div className="check" style={provisional ? { background: 'var(--warning)', color: '#20160a' } : undefined}>
            <IconCheck size={30} />
          </div>
          <div className="num">{invoice.number}</div>
          <div className="sub">{formatDateTime()}</div>
        </div>

        <div className="r-body">
          {provisional ? (
            <div className="banner" style={{ marginBottom: 12, justifyContent: 'center', background: 'rgba(245,158,11,.14)', border: '1px solid rgba(245,158,11,.4)', color: '#fcd9a3' }}>
              Comprovativo provisório (sem internet). A factura fiscal será emitida automaticamente quando a ligação voltar.
            </div>
          ) : info && info.environment !== 'PRODUCTION' ? (
            <div className="banner info" style={{ marginBottom: 12, justifyContent: 'center' }}>
              Ambiente de {info.environment}
            </div>
          ) : null}

          <div className="kv">
            <span className="k">Cliente</span>
            <span className="v">{customerName || 'Consumidor final'}</span>
          </div>
          {operatorName ? (
            <div className="kv">
              <span className="k">Operador</span>
              <span className="v">{operatorName}</span>
            </div>
          ) : null}
          <div className="kv">
            <span className="k">Base tributável</span>
            <span className="v">{formatKz(invoice.netTotal)}</span>
          </div>
          <div className="kv">
            <span className="k">IVA</span>
            <span className="v">{formatKz(invoice.ivaTotal)}</span>
          </div>
          <div className="kv" style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 10 }}>
            <span className="k">Total</span>
            <span className="v grand">{formatKz(invoice.grossTotal)}</span>
          </div>
          <div className="kv">
            <span className="k">{provisional ? 'Referência local' : 'Controlo (Hash)'}</span>
            <span className="v hash">{provisional ? invoice.number : hashShort}</span>
          </div>

          {info && (info.receiptLegend || info.fields.length > 0 || info.softwareCertificateNumber) ? (
            <div className="legend">
              {info.fields.map((f) => (
                <div key={f.label}>
                  <strong>{f.label}:</strong> {f.value}
                </div>
              ))}
              {info.softwareCertificateNumber ? (
                <div>Software certificado AGT nº {info.softwareCertificateNumber}</div>
              ) : null}
              {info.receiptLegend ? <div>{info.receiptLegend}</div> : null}
            </div>
          ) : null}

          {!provisional && invoice.hash ? (
            <div style={{ display: 'grid', placeItems: 'center', gap: 6, padding: '14px 0 4px' }}>
              <div style={{ background: '#fff', padding: 8, borderRadius: 8 }}>
                <QRCodeSVG value={qrData} size={116} level="M" />
              </div>
              <div className="muted" style={{ fontSize: 11 }}>Verificação · leia o QR</div>
            </div>
          ) : null}
        </div>

        {identity && (identity.address || identity.phone || identity.email || identity.receiptMessage) ? (
          <div className="r-foot-company">
            {identity.address ? <div>{identity.address}</div> : null}
            {(identity.phone || identity.email) ? (
              <div>{[identity.phone, identity.email].filter(Boolean).join(' · ')}</div>
            ) : null}
            {identity.receiptMessage ? <div className="r-foot-msg">{identity.receiptMessage}</div> : null}
            <div className="r-foot-thanks">Obrigado pela preferência!</div>
          </div>
        ) : null}

        <PaperSizeToggle />
        <div className="r-foot" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button className="btn ghost lg" style={{ flex: '1 1 30%' }} onClick={() => window.print()}>
            Imprimir
          </button>
          <button className="btn ghost lg" style={{ flex: '1 1 30%' }} onClick={() => void downloadPdf()} disabled={pdfBusy}>
            {pdfBusy ? '…' : '⬇️ PDF'}
          </button>
          <button
            className="btn lg"
            style={{ flex: '1 1 30%', background: '#25D366', color: '#06351f', boxShadow: '0 8px 20px -10px #25D366' }}
            onClick={() => void sharePdfWhatsApp()}
            disabled={pdfBusy}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
              <path d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.004c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.02zM12.05 20.15h-.004a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.69 8.24-8.23 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.39.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43-.14-.01-.31-.01-.48-.01-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z"/>
            </svg>
            PDF
          </button>
          <button className="btn lg" style={{ flex: '1 1 100%' }} onClick={onClose} autoFocus>
            Nova venda
          </button>
        </div>
      </div>
    </div>
  );
}
