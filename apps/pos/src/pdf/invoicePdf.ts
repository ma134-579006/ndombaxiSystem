import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { DocumentIdentity, EmittedInvoice, ReceiptFiscalInfo } from '../api/types';
import { formatDateTime, formatKz } from '../format';

export interface InvoicePdfArgs {
  invoice: EmittedInvoice;
  identity?: DocumentIdentity | null;
  info?: ReceiptFiscalInfo | null;
  customerName?: string | null;
  operatorName?: string | null;
  provisional?: boolean;
}

/** Gera uma FATURA A4 profissional (logo, NIF, totais, QR) em PDF. */
export async function buildInvoicePdf(a: InvoicePdfArgs): Promise<jsPDF> {
  const { invoice, identity, info, customerName, operatorName, provisional } = a;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 48; // margem
  let y = 54;
  const empresa = identity?.companyName || identity?.brandName || 'Fatura';
  const accent: [number, number, number] = [255, 77, 45];

  // ── Cabeçalho ──
  if (identity?.logoUrl) {
    try {
      const logo = await toDataUrl(identity.logoUrl);
      if (logo) doc.addImage(logo, 'PNG', M, y - 16, 54, 54, undefined, 'FAST');
    } catch { /* logo opcional */ }
  }
  const tx = identity?.logoUrl ? M + 68 : M;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(20, 24, 32);
  doc.text(empresa, tx, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90, 100, 115);
  const meta = [identity?.nif ? `NIF: ${identity.nif}` : '', identity?.address ?? ''].filter(Boolean);
  if (meta[0]) doc.text(meta[0], tx, y + 16);
  if (identity?.address) doc.text(doc.splitTextToSize(identity.address, W - tx - M), tx, y + 30);

  // Título do documento (direita)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...accent);
  doc.text(provisional ? 'COMPROVATIVO' : 'FATURA', W - M, y, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(20, 24, 32);
  doc.text(invoice.number, W - M, y + 17, { align: 'right' });
  doc.setFontSize(9.5); doc.setTextColor(110, 120, 135);
  doc.text(formatDateTime(), W - M, y + 31, { align: 'right' });

  y += 64;
  doc.setDrawColor(...accent); doc.setLineWidth(2); doc.line(M, y, W - M, y);
  y += 26;

  // ── Cliente / Operador ──
  doc.setFontSize(10.5); doc.setTextColor(90, 100, 115);
  doc.text('Cliente', M, y);
  doc.setTextColor(20, 24, 32); doc.setFont('helvetica', 'bold');
  doc.text(customerName || 'Consumidor final', M, y + 15);
  if (operatorName) {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(90, 100, 115);
    doc.text('Operador', W / 2, y);
    doc.setTextColor(20, 24, 32); doc.setFont('helvetica', 'bold');
    doc.text(operatorName, W / 2, y + 15);
  }
  y += 44;

  // ── Tabela de totais ──
  const rows: [string, string][] = [
    ['Base tributável', formatKz(invoice.netTotal)],
    ['IVA', formatKz(invoice.ivaTotal)],
  ];
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  for (const [k, val] of rows) {
    doc.setFillColor(247, 249, 252); doc.rect(M, y - 14, W - 2 * M, 26, 'F');
    doc.setTextColor(70, 80, 95); doc.text(k, M + 12, y + 3);
    doc.setTextColor(20, 24, 32); doc.text(val, W - M - 12, y + 3, { align: 'right' });
    y += 30;
  }
  // Total destacado
  doc.setFillColor(...accent); doc.rect(M, y - 14, W - 2 * M, 34, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text('TOTAL', M + 12, y + 6);
  doc.text(formatKz(invoice.grossTotal), W - M - 12, y + 6, { align: 'right' });
  y += 46;

  // ── Controlo / fiscal ──
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(110, 120, 135);
  if (!provisional && invoice.hash) { doc.text(`Controlo (Hash): ${invoice.hash.slice(0, 16)}`, M, y); y += 14; }
  for (const f of info?.fields ?? []) { doc.text(`${f.label}: ${f.value}`, M, y); y += 13; }
  if (info?.softwareCertificateNumber) { doc.text(`Software certificado AGT nº ${info.softwareCertificateNumber}`, M, y); y += 13; }
  if (info?.receiptLegend) { doc.text(doc.splitTextToSize(info.receiptLegend, W - 2 * M), M, y); y += 22; }

  // ── QR de verificação ──
  if (!provisional && invoice.hash) {
    try {
      const qrData = [empresa, invoice.number, identity?.nif ? `NIF:${identity.nif}` : '',
        `Total:${invoice.grossTotal}`, `IVA:${invoice.ivaTotal}`, new Date().toISOString().slice(0, 10),
        `H:${invoice.hash.slice(0, 16)}`].filter(Boolean).join('|');
      const qr = await QRCode.toDataURL(qrData, { margin: 1, width: 220 });
      doc.addImage(qr, 'PNG', W - M - 92, y, 92, 92, undefined, 'FAST');
      doc.setFontSize(8.5); doc.setTextColor(130, 140, 155);
      doc.text('Verificação · leia o QR', W - M - 92, y + 104);
    } catch { /* QR opcional */ }
  }

  // ── Rodapé ──
  const fy = doc.internal.pageSize.getHeight() - 60;
  doc.setDrawColor(225, 230, 240); doc.setLineWidth(1); doc.line(M, fy, W - M, fy);
  doc.setFontSize(9.5); doc.setTextColor(110, 120, 135);
  const foot = [identity?.address, [identity?.phone, identity?.email].filter(Boolean).join(' · ')].filter(Boolean);
  let fyy = fy + 16;
  for (const line of foot) { doc.text(line as string, W / 2, fyy, { align: 'center' }); fyy += 13; }
  doc.setTextColor(...accent); doc.setFont('helvetica', 'bold');
  doc.text(identity?.receiptMessage || 'Obrigado pela preferência!', W / 2, fyy + 2, { align: 'center' });

  return doc;
}

/** Nome de ficheiro limpo para a fatura. */
export function invoiceFileName(invoice: EmittedInvoice): string {
  return `Fatura-${invoice.number.replace(/[^\w-]/g, '_')}.pdf`;
}

/** Carrega uma imagem (logo) como data URL para o jsPDF (tolera CORS falhar). */
async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch { return null; }
}
