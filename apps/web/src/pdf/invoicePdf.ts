import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { DocumentIdentity, SaleDetail } from '../api/types';

/* ── Paleta SÓBRIA (enterprise) — igual à do Caixa, para o documento fiscal ser
   idêntico venha ele da Gestão ou do POS. Tinta escura, cinzentos, réguas finas
   e molduras a delimitar cada bloco (à imagem das faturas Primavera/AGT). ── */
const INK: [number, number, number] = [17, 24, 39];
const SUB: [number, number, number] = [92, 101, 116];
const LINE: [number, number, number] = [203, 210, 221];
const ZEBRA: [number, number, number] = [246, 248, 251];
const HEAD: [number, number, number] = [30, 38, 52];
const DANGER: [number, number, number] = [200, 40, 40];

const KZ = (n: number) => `${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kz`;

const DOC_LABEL: Record<string, string> = {
  FT: 'Fatura', FS: 'Fatura-Recibo', FR: 'Fatura-Recibo', NC: 'Nota de Crédito', ND: 'Nota de Débito',
};

/** Assinatura AGT (4 caracteres do hash nas posições 1, 11, 21, 31 — DP 71/25). */
function agtSignature(hash: string): string {
  if (!hash) return '';
  return [0, 10, 20, 30].map((i) => hash[i] ?? '').join('');
}

/**
 * PDF A4 de um documento fiscal EMITIDO (2ª via / reimpressão), com o mesmo
 * layout profissional do Caixa: cabeçalho com identidade + bloco do documento,
 * adquirente com moldura, tabela densa, resumo de impostos, TOTAL DO DOCUMENTO,
 * assinatura AGT, QR e rodapé.
 */
export async function buildInvoicePdf(sale: SaleDetail, identity?: DocumentIdentity | null): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  const empresa = identity?.companyName || identity?.brandName || 'Documento';
  const title = (DOC_LABEL[sale.docType] ?? sale.docType).toUpperCase();
  const emitted = new Date(sale.date).toLocaleString('pt-PT');
  const annulled = sale.status === 'A';
  const ivaRate = sale.invoice.netTotal > 0 ? Math.round((sale.invoice.ivaTotal / sale.invoice.netTotal) * 100) : 0;

  // ── Cabeçalho: identidade (esq.) + bloco do documento (dir.) ──
  let y = 46;
  if (identity?.logoUrl) {
    try {
      const logo = await toDataUrl(identity.logoUrl);
      if (logo) doc.addImage(logo, 'PNG', M, y - 10, 46, 46, undefined, 'FAST');
    } catch { /* logo opcional */ }
  }
  const tx = identity?.logoUrl ? M + 58 : M;
  const bx = W - M - 200, bw = 200, bh = 60;
  const nameW = bx - tx - 16;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...INK);
  const nameLines = doc.splitTextToSize(empresa, nameW);
  nameLines.forEach((ln: string, i: number) => doc.text(String(ln), tx, y + i * 15));
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6); doc.setTextColor(...SUB);
  let hy = y + (nameLines.length - 1) * 15 + 13;
  if (identity?.nif) { doc.text(`Contribuinte n.º ${identity.nif}`, tx, hy); hy += 11; }
  if (identity?.address) { for (const ln of doc.splitTextToSize(identity.address, 250)) { doc.text(String(ln), tx, hy); hy += 11; } }
  const contact = [identity?.phone, identity?.email].filter(Boolean).join('  ·  ');
  if (contact) { doc.text(contact, tx, hy); hy += 11; }

  doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.roundedRect(bx, y - 12, bw, bh, 3, 3, 'S');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...INK);
  doc.text(title, bx + 12, y + 3);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
  doc.setTextColor(...(annulled ? DANGER : SUB));
  doc.text(annulled ? 'ANULADO' : 'ORIGINAL', bx + bw - 12, y + 2, { align: 'right' });
  doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(bx + 12, y + 12, bx + bw - 12, y + 12);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK);
  doc.text(sale.invoice.number, bx + 12, y + 26);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.4); doc.setTextColor(...SUB);
  doc.text(`Data de emissão: ${emitted}`, bx + 12, y + 39);

  y = Math.max(hy + 6, y + bh - 2);
  doc.setDrawColor(...INK); doc.setLineWidth(1); doc.line(M, y, W - M, y);
  y += 14;

  // ── Adquirente (cliente) + meta ──
  const halfW = (W - 2 * M);
  doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.roundedRect(M, y, halfW, 44, 3, 3, 'S');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...SUB);
  doc.text('EXMO(S) SENHOR(ES)', M + 10, y + 14);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK);
  doc.text(sale.customerName || 'Consumidor final', M + 10, y + 30);
  const rx = M + halfW - 190;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  const metaPairs: [string, string][] = [
    ['Operador', sale.cashierName || '—'],
    ['Pagamento', 'Pronto pagamento'],
    ['Página', '1 / 1'],
  ];
  let myy = y + 13;
  for (const [k, v] of metaPairs) {
    doc.setTextColor(...SUB); doc.text(k, rx, myy);
    doc.setTextColor(...INK); doc.text(v, M + halfW - 10, myy, { align: 'right' });
    myy += 12;
  }
  y += 44 + 16;

  // ── Tabela de ARTIGOS ──
  const usable = W - 2 * M;
  const cols = ['DESCRIÇÃO', 'QTD', 'UNI', 'P.UNIT', `IVA${ivaRate ? ` ${ivaRate}%` : ''}`, 'TOTAL'];
  const weights = [3.5, 0.8, 0.7, 1.25, 0.9, 1.35];
  const wsum = weights.reduce((s, w) => s + w, 0);
  const colW = weights.map((w) => (w / wsum) * usable);
  const colX: number[] = []; { let acc = M; for (const w of colW) { colX.push(acc); acc += w; } }
  const right = [false, false, false, true, true, true];
  const center = [false, true, true, false, false, false];

  const drawHead = () => {
    doc.setFillColor(...HEAD); doc.rect(M, y, usable, 20, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.2); doc.setTextColor(255, 255, 255);
    cols.forEach((c, i) => {
      const x = right[i] ? colX[i] + colW[i] - 6 : center[i] ? colX[i] + colW[i] / 2 : colX[i] + 6;
      doc.text(c, x, y + 13, { align: right[i] ? 'right' : center[i] ? 'center' : 'left' });
    });
    y += 20;
  };
  drawHead();

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6);
  let alt = false;
  for (const it of sale.items) {
    const descLines = doc.splitTextToSize(it.description, colW[0] - 12);
    const rowH = Math.max(18, descLines.length * 10 + 8);
    if (y + rowH > H - 210) { doc.addPage(); y = 46; drawHead(); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6); alt = false; }
    if (alt) { doc.setFillColor(...ZEBRA); doc.rect(M, y, usable, rowH, 'F'); }
    alt = !alt;
    doc.setTextColor(...INK);
    const cells = [
      descLines,
      String(Number(it.quantity)),
      'UND',
      KZ(it.unitPrice),
      ivaRate ? `${ivaRate}%` : 'Isento',
      KZ(it.total),
    ];
    cells.forEach((val, i) => {
      const x = right[i] ? colX[i] + colW[i] - 6 : center[i] ? colX[i] + colW[i] / 2 : colX[i] + 6;
      if (Array.isArray(val)) {
        val.forEach((ln: string, k: number) => doc.text(String(ln), x, y + 12 + k * 10, { align: 'left' }));
      } else {
        doc.text(String(val), x, y + 12, { align: right[i] ? 'right' : center[i] ? 'center' : 'left' });
      }
    });
    y += rowH;
  }
  doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.line(M, y, W - M, y);
  y += 16;

  // ── Resumo de impostos + TOTAL (painel à direita) ──
  const panelW = 250; const px = W - M - panelW;
  if (y + 118 > H - 90) { doc.addPage(); y = 46; }
  const rows: [string, string][] = [
    ['Mercadorias / Serviços', KZ(sale.invoice.netTotal)],
    ['Descontos', KZ(0)],
    ['Líquido (base tributável)', KZ(sale.invoice.netTotal)],
    [`Imposto (IVA${ivaRate ? ` ${ivaRate}%` : ''})`, KZ(sale.invoice.ivaTotal)],
  ];
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  for (const [k, v] of rows) {
    doc.setTextColor(...SUB); doc.text(k, px, y);
    doc.setTextColor(...INK); doc.text(v, px + panelW, y, { align: 'right' });
    y += 16;
  }
  y += 4;
  doc.setFillColor(...HEAD); doc.roundedRect(px, y - 12, panelW, 30, 3, 3, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(255, 255, 255);
  doc.text('TOTAL DO DOCUMENTO', px + 12, y + 6);
  doc.setFontSize(13); doc.text(KZ(sale.invoice.grossTotal), px + panelW - 12, y + 6, { align: 'right' });
  y += 34;

  // ── Legendas fiscais + assinatura AGT ──
  const sig = agtSignature(sale.invoice.hash);
  let ly = Math.max(y + 6, H - 150);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...SUB);
  if (sig) { doc.text(`${sig} — Processado por programa validado`, M, ly); ly += 11; }
  if (sale.invoice.hash) { doc.text(`Controlo (Hash): ${sale.invoice.hash.slice(0, 20)}`, M, ly); ly += 11; }
  if (identity?.receiptMessage) { for (const ln of doc.splitTextToSize(identity.receiptMessage, W - 2 * M - 110)) { doc.text(String(ln), M, ly); ly += 11; } }

  // ── QR de verificação ──
  try {
    const qrData = [empresa, `${title} ${sale.invoice.number}`, sig, KZ(sale.invoice.grossTotal)].join('|');
    const qr = await QRCode.toDataURL(qrData, { margin: 1, width: 220 });
    doc.addImage(qr, 'PNG', W - M - 84, H - 156, 84, 84, undefined, 'FAST');
    doc.setFontSize(7.5); doc.setTextColor(...SUB);
    doc.text('Verificação · leia o QR', W - M - 84, H - 66);
  } catch { /* QR opcional */ }

  // ── Rodapé ──
  const fy = H - 44;
  doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.line(M, fy - 10, W - M, fy - 10);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.4); doc.setTextColor(...SUB);
  const foot = [identity?.address, contact].filter(Boolean) as string[];
  let fyy = fy;
  for (const line of foot) { doc.text(line, W / 2, fyy, { align: 'center' }); fyy += 11; }
  doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK);
  doc.text(identity?.receiptMessage || 'Obrigado pela preferência!', W / 2, fyy + 1, { align: 'center' });

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
