import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { DocumentIdentity, SaleDetail } from '../api/types';

const ACCENT: [number, number, number] = [255, 77, 45];
const INK: [number, number, number] = [20, 24, 32];
const MUTED: [number, number, number] = [110, 120, 135];

const KZ = (n: number) => `${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kz`;

const DOC_LABEL: Record<string, string> = {
  FT: 'Fatura', FS: 'Fatura-Recibo', FR: 'Fatura-Recibo', NC: 'Nota de Crédito', ND: 'Nota de Débito',
};

/** Assinatura AGT (4 caracteres do hash nas posições 1, 11, 21, 31). */
function agtSignature(hash: string): string {
  if (!hash) return '';
  return [0, 10, 20, 30].map((i) => hash[i] ?? '').join('');
}

/**
 * PDF A4 de um documento fiscal EMITIDO (2ª via / reimpressão), com o mesmo
 * design profissional do resto do sistema: cabeçalho com marca, dados do
 * cliente, tabela de linhas, totais, assinatura AGT, QR e rodapé. Usado após
 * faturar uma Ordem de Serviço (e reutilizável por clínica/hotel/etc.).
 */
export async function buildInvoicePdf(sale: SaleDetail, identity?: DocumentIdentity | null): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const empresa = identity?.companyName || identity?.brandName || 'Documento';
  const label = DOC_LABEL[sale.docType] ?? sale.docType;
  const emitted = new Date(sale.date).toLocaleString('pt-PT');

  // ── Cabeçalho ──
  let y = 54;
  if (identity?.logoUrl) {
    try {
      const logo = await toDataUrl(identity.logoUrl);
      if (logo) doc.addImage(logo, 'PNG', M, y - 16, 54, 54, undefined, 'FAST');
    } catch { /* logo opcional */ }
  }
  const tx = identity?.logoUrl ? M + 68 : M;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...INK);
  doc.text(empresa, tx, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(90, 100, 115);
  if (identity?.nif) doc.text(`NIF: ${identity.nif}`, tx, y + 16);
  if (identity?.address) doc.text(doc.splitTextToSize(identity.address, W - tx - M - 160), tx, y + 30);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...ACCENT);
  doc.text(`${label} ${sale.invoice.number}`.toUpperCase(), W - M, y, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
  doc.text(`Emitido: ${emitted}`, W - M, y + 16, { align: 'right' });
  if (sale.status && sale.status !== 'N') {
    doc.setTextColor(...ACCENT); doc.text(sale.status === 'A' ? 'ANULADO' : sale.status, W - M, y + 30, { align: 'right' });
  }

  y += 64;
  doc.setDrawColor(...ACCENT); doc.setLineWidth(2); doc.line(M, y, W - M, y);
  y += 22;

  // ── Cliente / operador ──
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(70, 80, 95);
  doc.text(`Cliente: ${sale.customerName || 'Consumidor final'}`, M, y);
  if (sale.cashierName) doc.text(`Operador: ${sale.cashierName}`, W - M, y, { align: 'right' });
  y += 22;

  // ── Tabela de linhas ──
  const usable = W - 2 * M;
  const cols = ['Descrição', 'Qtd', 'Preço', 'Total'];
  const weights = [3.4, 0.8, 1.1, 1.2];
  const wsum = weights.reduce((s, w) => s + w, 0);
  const colW = weights.map((w) => (w / wsum) * usable);
  const colX: number[] = []; { let acc = M; for (const w of colW) { colX.push(acc); acc += w; } }
  const right = [false, true, true, true];
  const footerSafe = 120;

  const drawHead = () => {
    doc.setFillColor(...INK); doc.rect(M, y - 14, usable, 24, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(255, 255, 255);
    cols.forEach((c, i) => {
      const x = right[i] ? colX[i] + colW[i] - 8 : colX[i] + 8;
      doc.text(c, x, y + 2, { align: right[i] ? 'right' : 'left' });
    });
    y += 24;
  };
  drawHead();

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  let alt = false;
  for (const it of sale.items) {
    if (y > H - footerSafe) { doc.addPage(); y = 54; drawHead(); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); alt = false; }
    if (alt) { doc.setFillColor(247, 249, 252); doc.rect(M, y - 13, usable, 22, 'F'); }
    alt = !alt;
    doc.setTextColor(30, 36, 46);
    const cells = [
      it.description + (it.productCode ? '' : ''),
      String(Number(it.quantity)),
      KZ(it.unitPrice),
      KZ(it.total),
    ];
    cells.forEach((val, i) => {
      const x = right[i] ? colX[i] + colW[i] - 8 : colX[i] + 8;
      const txt = doc.splitTextToSize(val, colW[i] - 12)[0] ?? val;
      doc.text(String(txt), x, y + 2, { align: right[i] ? 'right' : 'left' });
    });
    y += 22;
  }
  y += 14;

  // ── Totais ──
  const totals: [string, string][] = [
    ['Base tributável', KZ(sale.invoice.netTotal)],
    ['IVA', KZ(sale.invoice.ivaTotal)],
    ['Total', KZ(sale.invoice.grossTotal)],
  ];
  const boxW = 240; const boxX = W - M - boxW;
  for (let i = 0; i < totals.length; i++) {
    if (y > H - footerSafe) { doc.addPage(); y = 54; }
    const grand = i === totals.length - 1;
    doc.setFillColor(grand ? 20 : 247, grand ? 24 : 249, grand ? 32 : 252);
    doc.rect(boxX, y - 14, boxW, grand ? 28 : 24, 'F');
    doc.setFont('helvetica', grand ? 'bold' : 'normal'); doc.setFontSize(grand ? 12 : 10.5);
    doc.setTextColor(...(grand ? [255, 255, 255] as [number, number, number] : [70, 80, 95] as [number, number, number]));
    doc.text(totals[i][0], boxX + 12, y + (grand ? 4 : 2));
    doc.text(totals[i][1], boxX + boxW - 12, y + (grand ? 4 : 2), { align: 'right' });
    y += grand ? 30 : 24;
  }

  // ── Assinatura AGT + QR ──
  const sig = agtSignature(sale.invoice.hash);
  const fy = H - 92;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
  if (sig) doc.text(`${sig} — Processado por programa validado`, M, fy);
  if (identity?.receiptMessage) doc.text(doc.splitTextToSize(identity.receiptMessage, W - 2 * M - 90), M, fy + 14);
  try {
    const qrData = [empresa, `${label} ${sale.invoice.number}`, sig, KZ(sale.invoice.grossTotal)].join('|');
    const qr = await QRCode.toDataURL(qrData, { margin: 1, width: 220 });
    doc.addImage(qr, 'PNG', W - M - 70, fy - 8, 70, 70, undefined, 'FAST');
  } catch { /* QR opcional */ }

  // ── Rodapé ──
  const foot = [identity?.address, [identity?.phone, identity?.email].filter(Boolean).join(' · ')].filter(Boolean);
  let fyy = H - 40;
  doc.setDrawColor(225, 230, 240); doc.setLineWidth(1); doc.line(M, fyy - 8, W - M, fyy - 8);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
  for (const line of foot) { doc.text(String(line), W / 2, fyy, { align: 'center' }); fyy += 12; }

  return doc;
}

export function invoiceFileName(sale: SaleDetail): string {
  const num = (sale.invoice.number || 'documento').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${num}.pdf`;
}

async function toDataUrl(url: string): Promise<string | null> {
  if (url.startsWith('data:')) return url;
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
