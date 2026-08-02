// jsPDF (~400 KB) é carregado DINAMICAMENTE na 1.ª geração de PDF — fora do
// caminho crítico do arranque do caixa (importante em ligações 3G/4G).
import type { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { DocumentIdentity, EmittedInvoice, ReceiptFiscalInfo } from '../api/types';
import { formatDateTime, formatKz } from '../format';

export interface InvoicePdfArgs {
  invoice: EmittedInvoice;
  identity?: DocumentIdentity | null;
  info?: ReceiptFiscalInfo | null;
  customerName?: string | null;
  operatorName?: string | null;
  items?: { description: string; quantity: number; unitPrice: number; total: number }[];
  provisional?: boolean;
}

/* ── Paleta SÓBRIA (enterprise) ──────────────────────────────────────────────
   O antigo layout usava barras cor de laranja e cantos redondos que ficavam
   "infantis". Uma fatura fiscal séria vive de tinta escura, cinzentos e réguas
   finas, com molduras a delimitar cada bloco (à imagem das faturas Primavera/AGT
   que os clientes reconhecem). */
const INK: [number, number, number] = [17, 24, 39];
const SUB: [number, number, number] = [92, 101, 116];
const LINE: [number, number, number] = [203, 210, 221];
const ZEBRA: [number, number, number] = [246, 248, 251];
const HEAD: [number, number, number] = [30, 38, 52];

/** Assinatura AGT (4 caracteres do hash nas posições 1, 11, 21, 31 — DP 71/25). */
function agtSignature(hash: string): string {
  if (!hash) return '';
  return [0, 10, 20, 30].map((i) => hash[i] ?? '').join('');
}

/** Gera uma FATURA A4 profissional (fiscal, densa, com moldura) em PDF. */
export async function buildInvoicePdf(a: InvoicePdfArgs): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf');
  const { invoice, identity, info, customerName, operatorName, items, provisional } = a;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  const empresa = identity?.companyName || identity?.brandName || 'Fatura';
  const title = provisional ? 'COMPROVATIVO' : 'FATURA';
  // Taxa de IVA do documento (derivada — não há taxa por linha na venda).
  const ivaRate = invoice.netTotal > 0 ? Math.round((invoice.ivaTotal / invoice.netTotal) * 100) : 0;

  // ── Cabeçalho: identidade da empresa (esq.) + bloco do documento (dir.) ──
  let y = 46;
  let logoW = 0;
  if (identity?.logoUrl) {
    try {
      const logo = await loadLogo(identity.logoUrl);
      if (logo) {
        // Encaixa o logótipo numa caixa 52×46 mantendo a PROPORÇÃO (sem distorcer).
        const scale = Math.min(52 / logo.w, 46 / logo.h);
        const dw = Math.max(1, logo.w * scale), dh = Math.max(1, logo.h * scale);
        doc.addImage(logo.data, 'PNG', M, y - 10, dw, dh, undefined, 'FAST');
        logoW = dw;
      }
    } catch { /* logo opcional */ }
  }
  const tx = logoW ? M + logoW + 12 : M;
  // O bloco do documento fica no canto superior direito: o nome tem de QUEBRAR
  // dentro da coluna esquerda para nunca lhe passar por cima (empresas com nome
  // legal comprido — "… (SU), LDA" — são a regra em Angola).
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

  // Bloco do documento (moldura à direita)
  doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.roundedRect(bx, y - 12, bw, bh, 3, 3, 'S');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...INK);
  doc.text(title, bx + 12, y + 3);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...SUB);
  doc.text('ORIGINAL', bx + bw - 12, y + 2, { align: 'right' });
  doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(bx + 12, y + 12, bx + bw - 12, y + 12);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK);
  doc.text(invoice.number, bx + 12, y + 26);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.4); doc.setTextColor(...SUB);
  doc.text(`Data de emissão: ${formatDateTime()}`, bx + 12, y + 39);

  y = Math.max(hy + 6, y + bh - 2);
  doc.setDrawColor(...INK); doc.setLineWidth(1); doc.line(M, y, W - M, y);
  y += 14;

  // ── Adquirente (cliente) + meta ──
  const halfW = (W - 2 * M);
  doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.roundedRect(M, y, halfW, 44, 3, 3, 'S');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...SUB);
  doc.text('EXMO(S) SENHOR(ES)', M + 10, y + 14);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK);
  doc.text(customerName || 'Consumidor final', M + 10, y + 30);
  // Coluna direita do bloco: operador + condição + página
  const rx = M + halfW - 190;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...SUB);
  const metaPairs: [string, string][] = [
    ['Operador', operatorName || '—'],
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
  for (const it of items ?? []) {
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
      formatKz(it.unitPrice),
      ivaRate ? `${ivaRate}%` : 'Isento',
      formatKz(it.total),
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
    ['Mercadorias / Serviços', formatKz(invoice.netTotal)],
    ['Descontos', formatKz(0)],
    ['Líquido (base tributável)', formatKz(invoice.netTotal)],
    [`Imposto (IVA${ivaRate ? ` ${ivaRate}%` : ''})`, formatKz(invoice.ivaTotal)],
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
  doc.setFontSize(13); doc.text(formatKz(invoice.grossTotal), px + panelW - 12, y + 6, { align: 'right' });
  y += 34;

  // ── Legendas fiscais + assinatura AGT (canto inferior esquerdo) ──
  const sig = agtSignature(invoice.hash);
  let ly = Math.max(y + 6, H - 150);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...SUB);
  if (!provisional && sig) { doc.text(`${sig} — Processado por programa validado`, M, ly); ly += 11; }
  if (!provisional && invoice.hash) { doc.text(`Controlo (Hash): ${invoice.hash.slice(0, 20)}`, M, ly); ly += 11; }
  for (const f of info?.fields ?? []) { doc.text(`${f.label}: ${f.value}`, M, ly); ly += 11; }
  if (info?.softwareCertificateNumber && String(info.softwareCertificateNumber) !== '0') { doc.text(`Software certificado AGT n.º ${info.softwareCertificateNumber}`, M, ly); ly += 11; }
  if (info?.receiptLegend) { for (const ln of doc.splitTextToSize(info.receiptLegend, W - 2 * M - 110)) { doc.text(String(ln), M, ly); ly += 11; } }

  // ── QR de verificação (canto inferior direito) ──
  if (!provisional && invoice.hash) {
    try {
      const qrData = [empresa, invoice.number, identity?.nif ? `NIF:${identity.nif}` : '',
        `Total:${invoice.grossTotal}`, `IVA:${invoice.ivaTotal}`, new Date().toISOString().slice(0, 10),
        `H:${invoice.hash.slice(0, 16)}`].filter(Boolean).join('|');
      const qr = await QRCode.toDataURL(qrData, { margin: 1, width: 220 });
      doc.addImage(qr, 'PNG', W - M - 84, H - 156, 84, 84, undefined, 'FAST');
      doc.setFontSize(7.5); doc.setTextColor(...SUB);
      doc.text('Verificação · leia o QR', W - M - 84, H - 66);
    } catch { /* QR opcional */ }
  }

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

/** Nome de ficheiro limpo para a fatura. */
export function invoiceFileName(invoice: EmittedInvoice): string {
  return `Fatura-${invoice.number.replace(/[^\w-]/g, '_')}.pdf`;
}

/**
 * Carrega o logótipo de forma ROBUSTA: decodifica QUALQUER formato (PNG/JPEG/
 * WEBP) via <img>+canvas e reexporta como PNG — o jsPDF aceita sempre — e devolve
 * as dimensões naturais para manter a proporção. Aceita data-URI (o caso comum: a
 * logo é gravada em base64) e URL. O bug anterior: `fetch({mode:'cors'})` falhava
 * em logos remotas e o formato fixo 'PNG' rejeitava logos JPEG → a fatura saía
 * sem logótipo. Tolera falhar (devolve null; nunca rebenta a fatura).
 */
async function loadLogo(url: string): Promise<{ data: string; w: number; h: number } | null> {
  let src = url;
  if (!src.startsWith('data:')) {
    try {
      let res: Response;
      try { res = await fetch(url, { mode: 'cors' }); } catch { res = await fetch(url); }
      if (!res.ok) return null;
      const blob = await res.blob();
      src = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
    } catch { return null; }
  }
  return await new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || 1;
        c.height = img.naturalHeight || 1;
        const ctx = c.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        resolve({ data: c.toDataURL('image/png'), w: c.width, h: c.height });
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
