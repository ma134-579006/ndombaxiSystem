import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { DocumentIdentity, EmittedInvoice, ReceiptFiscalInfo } from '../api/types';
import { formatDateTime, formatKz } from '../format';
import { IconCheck } from './Icons';
import { PaperSizeToggle } from './PaperSizeToggle';
import { buildInvoicePdf, invoiceFileName } from '../pdf/invoicePdf';
import { runTransfer } from '../transfer';
import { getPaper } from '../print';
import { pairPrinter, pairedPrinterName, printRaw, rawPrintSupported } from '../escpos';
import { isCapacitorApp as isNativeApp, saveNativePdf, shareNativePdf } from '../offline/nativeShare';
import { UiIcon } from './UiIcon';

/** Linha de artigo da fatura (para a tabela no recibo/PDF). */
export interface ReceiptItem {
  description: string; quantity: number; unitPrice: number; total: number;
  /** Referência do produto (1.ª coluna do talão, como no modelo de referência). */
  code?: string;
  /** Opcionais (venda feita agora no POS): IVA por taxa e isenção no talão. */
  ivaRate?: number; net?: number; iva?: number; exemptionCode?: string | null;
  /** Desconto da linha em Kz e fração (promoção ou manual). */
  discount?: number; discountRate?: number;
}

/** Designação do documento pelo prefixo do número (FR = Factura-Recibo; FS é o nome antigo). */
export function docDesignation(number: string): string {
  const t = number.split(' ')[0];
  return ({ FT: 'Factura', FR: 'Factura-Recibo', FS: 'Factura-Recibo', NC: 'Nota de Crédito', ND: 'Nota de Débito', RC: 'Recibo', GR: 'Guia de Remessa', ORC: 'Orçamento' } as Record<string, string>)[t] ?? 'Documento';
}

/** IVA discriminado por taxa + motivos de isenção (menções obrigatórias). */
function taxSummary(items: ReceiptItem[] | undefined, netTotal: number) {
  const rows = new Map<number, { base: number; iva: number }>();
  const exempt = new Set<string>();
  for (const it of items ?? []) {
    if (it.ivaRate == null || it.net == null) return { rows: [], exemptions: [] };
    const r = rows.get(it.ivaRate) ?? { base: 0, iva: 0 };
    r.base += it.net; r.iva += it.iva ?? 0;
    rows.set(it.ivaRate, r);
    if (it.ivaRate === 0) exempt.add(it.exemptionCode ? `Isento — ${it.exemptionCode}` : 'Isento de IVA');
  }
  // Desconto global na venda: as linhas já não somam a base do documento → não discrimina (evita números errados).
  const sum = [...rows.values()].reduce((a, r) => a + r.base, 0);
  if (Math.abs(sum - netTotal) > 0.05) return { rows: [], exemptions: [...exempt] };
  return {
    rows: [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([rate, v]) => ({
      label: rate === 0 ? 'Isento' : `IVA ${rate}%`, rate, base: Math.round(v.base * 100) / 100, iva: Math.round(v.iva * 100) / 100,
    })),
    exemptions: [...exempt],
  };
}

interface Props {
  invoice: EmittedInvoice;
  info: ReceiptFiscalInfo | null;
  identity?: DocumentIdentity | null;
  customerName?: string | null;
  /** Nome do operador (funcionário) que emitiu — impresso no recibo. */
  operatorName?: string | null;
  /** Artigos vendidos (descrição, quantidade, preço, total) — listados na fatura. */
  items?: ReceiptItem[];
  /** Venda guardada offline: comprovativo PROVISÓRIO (sem nº fiscal ainda). */
  provisional?: boolean;
  /** Como o cliente pagou (talão: método, valor entregue e troco). */
  pay?: { paymentType: string; tendered?: number; changeGiven?: number; payments?: { type: string; amount: number }[] };
  /** Reimpressão (2ª via) de um documento já emitido. */
  reprint?: boolean;
  /** Data a mostrar (na 2ª via, a data ORIGINAL do documento). */
  dateLabel?: string;
  onClose(): void;
}

/** Recibo/comprovativo da venda emitida — identidade da empresa + dados fiscais AGT (§7). */
/** Nome do meio de pagamento no talão (o cliente não lê "CASH"). */
const PAY_LABEL: Record<string, string> = {
  CASH: 'Numerário', CARD: 'Cartão (TPA)', TRANSFER: 'Transferência', REFERENCE: 'Referência', EXPRESS: 'Multicaixa Express', CREDIT: 'Crédito (a pagar)',
};

export function ReceiptModal({ invoice, info, identity, customerName, operatorName, items, provisional, reprint, dateLabel, pay, onClose }: Props) {
  // AGT: 4 caracteres da assinatura nas posições 1.ª, 11.ª, 21.ª e 31.ª.
  const hashShort = invoice.hash ? [0, 10, 20, 30].map((i) => invoice.hash[i] ?? '').join('') : '----';
  const shownDate = dateLabel ?? formatDateTime();
  const designation = provisional ? 'Comprovativo provisório' : docDesignation(invoice.number);
  const tax = taxSummary(items, invoice.netTotal);
  const totalDiscount = Math.round((items ?? []).reduce((s, it) => s + (it.discount ?? 0), 0) * 100) / 100;
  // Conteúdo do QR de verificação (campos-chave do documento).
  const qrData = invoice.feQr && identity?.nif
    ? `https://quiosqueagt.minfin.gov.ao/facturacao-eletronica/consultar-fe?emissor=${encodeURIComponent(identity.nif)}&document=${invoice.number.replace(/ /g, '%20')}`
    : [
    identity?.companyName || identity?.brandName || 'Documento', invoice.number,
    identity?.nif ? `NIF:${identity.nif}` : '',
    `Total:${invoice.grossTotal}`, `IVA:${invoice.ivaTotal}`,
    new Date().toISOString().slice(0, 10),
    invoice.hash ? `H:${invoice.hash.slice(0, 16)}` : '',
  ].filter(Boolean).join('|');
  const companyMeta = identity
    ? [identity.nif ? `NIF ${identity.nif}` : '', identity.address ?? ''].filter(Boolean).join(' · ')
    : '';
  // ── Estrutura do talão de referência ──
  const headerLines = [
    ...(identity?.address ? identity.address.split(/\n|,\s*/).map((s) => s.trim()).filter(Boolean) : []),
    ...(identity?.nif ? [`NIF: ${identity.nif}`] : []),
    ...(identity?.email ? [identity.email] : []),
    ...(identity?.phone ? [`Tel.: ${identity.phone}`] : []),
  ];
  const viaLabel = provisional ? 'Provisório' : reprint ? 'Segunda Via cf. Original' : 'Original';
  const certOk = !!info?.softwareCertificateNumber && String(info.softwareCertificateNumber) !== '0';
  // Só se escreve "processado por programa validado" quando o nº de certificado está configurado.
  const processedBy = !provisional && certOk ? `Processado por programa validado n.º ${info!.softwareCertificateNumber}` : null;
  const PAYL: Record<string, string> = { CASH: 'Dinheiro', CARD: 'Multicaixa (TPA)', TRANSFER: 'Transferência', REFERENCE: 'Referência', EXPRESS: 'Multicaixa Express', CREDIT: 'Conta Corrente' };
  const payLines = pay?.payments?.length
    ? pay.payments.map((p) => ({ label: PAYL[p.type] ?? p.type, amount: p.amount }))
    : pay ? [{ label: PAYL[pay.paymentType] ?? pay.paymentType, amount: pay.paymentType === 'CASH' && pay.tendered ? pay.tendered : invoice.grossTotal }] : [];
  const changeGiven = !pay?.payments?.length && pay?.paymentType === 'CASH' && pay.tendered ? Math.max(0, pay.tendered - invoice.grossTotal) : null;

  // FATURA DIGITAL por WhatsApp: monta um resumo legível do documento e abre o
  // WhatsApp (app/Web) pronto a enviar. Funciona no telemóvel e no PC, sem app.
  const shareWhatsApp = () => {
    const empresa = identity?.companyName || identity?.brandName || 'Fatura';
    const linhas: string[] = [`*${empresa}*`];
    if (identity?.nif) linhas.push(`NIF: ${identity.nif}`);
    linhas.push('', `${provisional ? 'Comprovativo' : reprint ? 'Fatura (2ª via)' : 'Fatura'}: ${invoice.number}`, `Data: ${shownDate}`);
    if (customerName) linhas.push(`Cliente: ${customerName}`);
    if (items && items.length) {
      linhas.push('', '*Artigos:*');
      for (const it of items) linhas.push(`• ${it.quantity}× ${it.description} — ${formatKz(it.total)}`);
    }
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
  const makePdf = () => buildInvoicePdf({ invoice, identity, info, customerName, operatorName, items, provisional, reprint, payments: payLines });

  // ── Impressão: tenta a TÉRMICA DIRETA (ESC/POS via USB, sem driver) e só
  // se não houver impressora emparelhada/compatível cai no diálogo do sistema.
  const [printBusy, setPrintBusy] = useState(false);
  const [printerName, setPrinterName] = useState<string | null>(() => pairedPrinterName());
  const pairThermal = async () => {
    try {
      const p = await pairPrinter();
      if (p) setPrinterName(p.name);
    } catch (e) { alert(e instanceof Error ? e.message : 'Não foi possível ligar a impressora.'); }
  };
  const doPrint = async () => {
    setPrintBusy(true);
    try {
      const contact = [identity?.phone, identity?.email].filter(Boolean).join(' · ');
      void contact;
      const ok = await printRaw({
        company: identity?.companyName || identity?.brandName || null,
        headerLines: headerLines,
        title: `${invoice.number}${provisional ? ' (provisorio)' : ''}`,
        via: viaLabel,
        docTitle: designation,
        taxRows: tax.rows.length ? tax.rows : undefined,
        exemptions: tax.exemptions,
        qr: !provisional && invoice.feQr ? qrData : null,
        date: shownDate,
        customer: customerName || 'Consumidor Final',
        operator: operatorName || null,
        items: (items ?? []).map((it) => ({ ...it, exempt: it.ivaRate === 0 })),
        payments: payLines,
        change: changeGiven,
        netTotal: invoice.netTotal, ivaTotal: invoice.ivaTotal, grossTotal: invoice.grossTotal,
        hash: provisional ? null : hashShort,
        processedBy: processedBy,
        legends: [
          ...(info?.fields.map((f) => `${f.label}: ${f.value}`) ?? []),
          ...(info?.receiptLegend ? [info.receiptLegend] : []),
        ],
        footer: [identity?.receiptMessage || 'Obrigado pela preferência!'],
      }, getPaper());
      if (!ok) window.print();
    } catch { window.print(); }
    finally { setPrintBusy(false); }
  };

  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      const doc = await runTransfer({ title: 'A gerar o PDF do recibo', kind: 'generate', task: () => makePdf() });
      const name = invoiceFileName(invoice);
      // Na APP: a WebView não descarrega blobs → grava o ficheiro no aparelho
      // (pasta Documentos) pelo plugin nativo. No site: download normal do browser.
      if (isNativeApp()) {
        const uri = await saveNativePdf(doc.output('blob'), name);
        if (uri) alert('Fatura guardada no aparelho (Documentos):\n' + name);
        else doc.save(name);
      } else {
        doc.save(name);
      }
    }
    catch { alert('Não foi possível gerar o PDF.'); }
    finally { setPdfBusy(false); }
  };

  // Partilha o PDF como FICHEIRO (WhatsApp e outras apps). No telemóvel usa a
  // partilha nativa; no PC descarrega o PDF e abre o WhatsApp com o resumo.
  const sharePdfWhatsApp = async () => {
    setPdfBusy(true);
    try {
      const doc = await runTransfer({ title: 'A gerar o PDF do recibo', kind: 'generate', task: () => makePdf() });
      const blob = doc.output('blob');
      const fname = invoiceFileName(invoice);
      const titleN = invoice.number;
      const textN = `${identity?.companyName || identity?.brandName || 'Fatura'} · ${invoice.number}`;
      // Na APP: partilha o FICHEIRO PDF pela partilha nativa (WhatsApp recebe a
      // fatura A4, não só texto). Se conseguir, termina aqui.
      if (isNativeApp()) {
        const ok = await shareNativePdf(blob, fname, titleN, textN);
        if (ok) return;
        // não deu pelo nativo → guarda no aparelho e manda o resumo por WhatsApp
        await saveNativePdf(blob, fname);
        shareWhatsApp();
        return;
      }
      const file = new File([blob], invoiceFileName(invoice), { type: 'application/pdf' });
      const nav = navigator as Navigator & {
        share?: (d: { files?: File[]; title?: string; text?: string }) => Promise<void>;
        canShare?: (d: { files?: File[] }) => boolean;
      };
      const title = invoice.number;
      const text = `${identity?.companyName || identity?.brandName || 'Fatura'} · ${invoice.number}`;
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title, text });
      } else if (nav.share) {
        // Alguns WebView (Android) PARTILHAM ficheiros mas o `canShare` devolve
        // false — por isso a fatura ia só como texto. Tentamos na mesma enviar o
        // PDF; se o utilizador CANCELAR (AbortError) não fazemos nada; se o WebView
        // mesmo não suportar ficheiros, aí sim caímos para o resumo + descarga.
        try {
          await nav.share({ files: [file], title, text });
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') return;
          doc.save(invoiceFileName(invoice));
          shareWhatsApp();
        }
      } else {
        doc.save(invoiceFileName(invoice)); // PC sem Web Share: descarrega
        shareWhatsApp();                     // e abre o WhatsApp com o resumo
      }
    } catch { shareWhatsApp(); }
    finally { setPdfBusy(false); }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card receipt" onClick={(e) => e.stopPropagation()}>
        {/* Talão no formato de referência (80mm): o mesmo que sai na térmica. */}
        <div className="vrc">
          {identity?.logoUrl ? <img className="vrc-logo" src={identity.logoUrl} alt="" /> : null}
          {identity && (identity.companyName || identity.brandName) ? <div className="vrc-co">{identity.companyName || identity.brandName}</div> : null}
          <div className="vrc-head">{headerLines.map((h, i) => <div key={i}>{h}</div>)}</div>

          {provisional ? (
            <div className="vrc-note">Comprovativo provisório (sem internet). A factura fiscal é emitida automaticamente quando a ligação voltar.</div>
          ) : info && info.environment !== 'PRODUCTION' ? (
            <div className="vrc-note">Ambiente de {info.environment}</div>
          ) : null}

          <table className="vrc-type"><tbody><tr><td>{designation}</td><td className="r">{invoice.number}</td></tr></tbody></table>
          <table className="vrc-w"><tbody><tr><td>{viaLabel}</td><td className="r">{shownDate}</td></tr></tbody></table>
          <table className="vrc-w vrc-cli"><tbody>
            <tr><td className="k">Nome:</td><td>{customerName || 'Consumidor Final'}</td></tr>
            {operatorName ? <tr><td className="k">Operador:</td><td>{operatorName}</td></tr> : null}
          </tbody></table>

          {items && items.length ? (
            <table className="vrc-w vrc-items">
              <thead>
                <tr><th colSpan={3} className="l">Referência Produto</th></tr>
                <tr className="bb"><th className="l">Qtd. x Preço</th><th className="c">Taxa</th><th className="r">Total</th></tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <React.Fragment key={i}>
                    <tr><td colSpan={3} className="l">{it.code ? `${it.code} ` : ''}{it.description}{it.ivaRate === 0 ? <sup>*</sup> : null}</td></tr>
                    <tr className={i === items.length - 1 ? 'bb' : ''}>
                      <td className="l">{it.quantity} x {it.unitPrice.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="c">{it.ivaRate != null ? `${it.ivaRate}%` : ''}</td>
                      <td className="r">{(it.total + (it.discount ?? 0)).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                    {it.discount && it.discount > 0 ? (
                      <tr><td colSpan={2} className="l sm">Desconto {(Math.round((it.discountRate ?? 0) * 1000) / 10).toLocaleString('pt-PT')}%</td><td className="r sm">-{it.discount.toLocaleString('pt-PT', { minimumFractionDigits: 2 })}</td></tr>
                    ) : null}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          ) : null}
          {tax.exemptions.length ? <div className="vrc-ex">{tax.exemptions.map((e) => <div key={e}>* {e}</div>)}</div> : null}
          {totalDiscount > 0 ? <table className="vrc-w"><tbody><tr><td>Descontos</td><td className="r">-{formatKz(totalDiscount)}</td></tr></tbody></table> : null}

          <table className="vrc-w vrc-total"><tbody>
            <tr className="big"><td>Total</td><td className="r">Kz {invoice.grossTotal.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>
            {payLines.map((p) => <tr key={p.label}><td>{p.label}</td><td className="r">Kz {p.amount.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>)}
            {changeGiven ? <tr><td>Troco</td><td className="r">Kz {changeGiven.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr> : null}
          </tbody></table>

          <table className="vrc-w vrc-iva">
            <thead><tr className="bb"><th className="l">%IVA</th><th className="r">Incidência</th><th className="r">IVA</th></tr></thead>
            <tbody>
              {(tax.rows.length ? tax.rows : [{ label: '', rate: invoice.netTotal > 0 ? Math.round((invoice.ivaTotal / invoice.netTotal) * 100) : 0, base: invoice.netTotal, iva: invoice.ivaTotal }]).map((t, i, arr) => (
                <tr key={i} className={i === arr.length - 1 ? 'bb' : ''}><td className="l">{t.rate}</td><td className="r">{formatKz(t.base).replace(' Kz', '')}</td><td className="r">{formatKz(t.iva).replace(' Kz', '')}</td></tr>
              ))}
            </tbody>
          </table>

          <div className="vrc-foot">
            {processedBy ? <div>{hashShort}-{processedBy}</div> : !provisional && invoice.hash ? <div>Controlo (Hash): {hashShort}</div> : <div>Referência local: {invoice.number}</div>}
            {info?.fields.map((f) => <div key={f.label}>{f.label}: {f.value}</div>)}
            {info?.receiptLegend ? <div>{info.receiptLegend}</div> : null}
          </div>
          {!provisional && invoice.hash ? (
            <div className="vrc-qr">
              <QRCodeSVG value={qrData} size={112} level="M" />
              <div>{invoice.feQr ? 'Consulte no Quiosque AGT · leia o QR' : 'Verificação · leia o QR'}</div>
            </div>
          ) : null}
          <div className="vrc-thanks">{identity?.receiptMessage || 'Obrigado pela preferência!'}</div>
        </div>
        <PaperSizeToggle />
        {rawPrintSupported() ? (
          <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 12, color: 'var(--muted)', padding: '2px 0 6px' }}>
            <span>{printerName ? `Térmica: ${printerName}` : 'Térmica não ligada (usa o diálogo)'}</span>
            <button className="btn sm ghost" onClick={() => void pairThermal()}>
              {printerName ? 'Trocar' : 'Ligar impressora'}
            </button>
          </div>
        ) : null}
        <div className="r-foot" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button className="btn ghost lg" style={{ flex: '1 1 30%' }} onClick={() => void doPrint()} disabled={printBusy}>
            {printBusy ? 'A imprimir…' : <><UiIcon e="printer" size={16} /> Imprimir</>}
          </button>
          <button className="btn ghost lg" style={{ flex: '1 1 30%' }} onClick={() => void downloadPdf()} disabled={pdfBusy}>
            {pdfBusy ? '…' : <><UiIcon e="download" size={16} /> PDF</>}
          </button>
          <button
            className="btn ghost lg r-wa"
            style={{ flex: '1 1 30%' }}
            onClick={() => void sharePdfWhatsApp()}
            disabled={pdfBusy}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
              <path d="M19.05 4.91A9.82 9.82 0 0 0 12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.004c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.02zM12.05 20.15h-.004a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.69 8.24-8.23 8.24zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.39.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43-.14-.01-.31-.01-.48-.01-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z"/>
            </svg>
            WhatsApp
          </button>
          <button className="btn lg" style={{ flex: '1 1 100%' }} onClick={onClose} autoFocus>
            Nova venda
          </button>
        </div>
      </div>
    </div>
  );
}
