import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { DocumentIdentity, EmittedInvoice, ReceiptFiscalInfo } from '../api/types';
import { copyrightLine } from '../brand';
import { formatDateTime, formatKz } from '../format';
import { IconCheck } from './Icons';

interface Props {
  invoice: EmittedInvoice;
  info: ReceiptFiscalInfo | null;
  identity?: DocumentIdentity | null;
  customerName?: string | null;
  /** Venda guardada offline: comprovativo PROVISÓRIO (sem nº fiscal ainda). */
  provisional?: boolean;
  onClose(): void;
}

/** Recibo/comprovativo da venda emitida — identidade da empresa + dados fiscais AGT (§7). */
export function ReceiptModal({ invoice, info, identity, customerName, provisional, onClose }: Props) {
  const hashShort = invoice.hash ? invoice.hash.slice(0, 4) : '----';
  // Conteúdo do QR de verificação (campos-chave do documento).
  const qrData = [
    'Ndombaxi', invoice.number,
    identity?.nif ? `NIF:${identity.nif}` : '',
    `Total:${invoice.grossTotal}`, `IVA:${invoice.ivaTotal}`,
    new Date().toISOString().slice(0, 10),
    invoice.hash ? `H:${invoice.hash.slice(0, 16)}` : '',
  ].filter(Boolean).join('|');
  const companyMeta = identity
    ? [identity.nif ? `NIF ${identity.nif}` : '', identity.address ?? ''].filter(Boolean).join(' · ')
    : '';

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

        <div className="receipt-credit">{identity?.copyright ?? copyrightLine()}</div>

        <div className="r-foot">
          <button className="btn lg block" onClick={onClose} autoFocus>
            Nova venda
          </button>
        </div>
      </div>
    </div>
  );
}
