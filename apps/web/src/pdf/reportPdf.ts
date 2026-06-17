import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { DocumentIdentity } from '../api/types';

export interface ReportTable {
  heading?: string;
  columns: string[];
  rows: string[][];
}
export interface ReportPdfArgs {
  identity?: DocumentIdentity | null;
  title: string;
  subtitle?: string;
  /** Linhas de resumo (rótulo → valor), estilo "totais" da fatura. */
  summary?: [string, string][];
  tables: ReportTable[];
}

const ACCENT: [number, number, number] = [255, 77, 45];
const INK: [number, number, number] = [20, 24, 32];
const MUTED: [number, number, number] = [110, 120, 135];

/**
 * Documento A4 profissional com EXATAMENTE o mesmo design da fatura PDF:
 * cabeçalho (logo + empresa + NIF + morada / título + data), linha de acento,
 * resumo, tabelas (cabeçalho escuro + linhas alternadas), QR e rodapé com os
 * dados da empresa. Reutilizável por qualquer secção que tenha "Imprimir".
 */
export async function buildReportPdf(a: ReportPdfArgs): Promise<jsPDF> {
  const { identity, title, subtitle, summary, tables } = a;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const empresa = identity?.companyName || identity?.brandName || 'Relatório';
  const now = new Date();
  const dateStr = now.toLocaleString('pt-PT');

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
  if (identity?.address) doc.text(doc.splitTextToSize(identity.address, W - tx - M), tx, y + 30);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...ACCENT);
  doc.text(title.toUpperCase(), W - M, y, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
  if (subtitle) { doc.text(subtitle, W - M, y + 16, { align: 'right' }); }
  doc.text(dateStr, W - M, y + (subtitle ? 30 : 16), { align: 'right' });

  y += 64;
  doc.setDrawColor(...ACCENT); doc.setLineWidth(2); doc.line(M, y, W - M, y);
  y += 26;

  const footerSafe = 84; // espaço reservado p/ rodapé/QR

  // ── Resumo (estilo totais) ──
  if (summary && summary.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    for (const [k, val] of summary) {
      if (y > H - footerSafe) { doc.addPage(); y = 54; }
      doc.setFillColor(247, 249, 252); doc.rect(M, y - 14, W - 2 * M, 26, 'F');
      doc.setTextColor(70, 80, 95); doc.text(String(k), M + 12, y + 3);
      doc.setTextColor(...INK); doc.setFont('helvetica', 'bold');
      doc.text(String(val), W - M - 12, y + 3, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      y += 30;
    }
    y += 8;
  }

  // ── Tabelas ──
  for (const t of tables) {
    if (!t.columns.length || !t.rows.length) continue;
    const usable = W - 2 * M;
    const n = t.columns.length;
    // pesos: 1ª coluna (texto) mais larga
    const weights = t.columns.map((_, i) => (i === 0 ? 2 : 1));
    const wsum = weights.reduce((s, w) => s + w, 0);
    const colW = weights.map((w) => (w / wsum) * usable);
    const colX: number[] = [];
    let acc = M;
    for (const w of colW) { colX.push(acc); acc += w; }
    // alinhamento por coluna: numérica → direita
    const rightAlign = t.columns.map((_, i) => {
      const sample = t.rows.slice(0, 12).map((r) => r[i] ?? '');
      const num = sample.filter((v) => /^[\s]*[+-]?[\d.,]+\s*(kz|aoa|%)?\s*$/i.test(v.trim()) && /\d/.test(v)).length;
      return i !== 0 && num >= Math.max(1, sample.length * 0.5);
    });

    if (t.heading) {
      if (y > H - footerSafe) { doc.addPage(); y = 54; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...INK);
      doc.text(t.heading, M, y); y += 18;
    }

    const drawHead = () => {
      doc.setFillColor(...INK); doc.rect(M, y - 14, usable, 24, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(255, 255, 255);
      t.columns.forEach((c, i) => {
        const x = rightAlign[i] ? colX[i] + colW[i] - 8 : colX[i] + 8;
        const txt = doc.splitTextToSize(c, colW[i] - 12)[0] ?? c;
        doc.text(String(txt), x, y + 2, { align: rightAlign[i] ? 'right' : 'left' });
      });
      y += 24;
    };
    drawHead();

    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    let alt = false;
    for (const row of t.rows) {
      if (y > H - footerSafe) { doc.addPage(); y = 54; drawHead(); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); alt = false; }
      if (alt) { doc.setFillColor(247, 249, 252); doc.rect(M, y - 13, usable, 22, 'F'); }
      alt = !alt;
      doc.setTextColor(30, 36, 46);
      t.columns.forEach((_, i) => {
        const val = row[i] ?? '';
        const x = rightAlign[i] ? colX[i] + colW[i] - 8 : colX[i] + 8;
        const txt = doc.splitTextToSize(String(val), colW[i] - 12)[0] ?? String(val);
        doc.text(String(txt), x, y + 2, { align: rightAlign[i] ? 'right' : 'left' });
      });
      y += 22;
    }
    y += 18;
  }

  // ── QR (paridade visual com a fatura) ──
  const qy = H - footerSafe - 4;
  try {
    const qrData = [empresa, title, identity?.nif ? `NIF:${identity.nif}` : '', now.toISOString().slice(0, 10)].filter(Boolean).join('|');
    const qr = await QRCode.toDataURL(qrData, { margin: 1, width: 200 });
    doc.addImage(qr, 'PNG', W - M - 70, qy - 70, 70, 70, undefined, 'FAST');
  } catch { /* QR opcional */ }

  // ── Rodapé (em todas as páginas) ──
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const fy = H - 60;
    doc.setDrawColor(225, 230, 240); doc.setLineWidth(1); doc.line(M, fy, W - M, fy);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
    const foot = [identity?.address, [identity?.phone, identity?.email].filter(Boolean).join(' · ')].filter(Boolean);
    let fyy = fy + 16;
    for (const line of foot) { doc.text(String(line), W / 2, fyy, { align: 'center' }); fyy += 13; }
    doc.setTextColor(...ACCENT); doc.setFont('helvetica', 'bold');
    doc.text(identity?.receiptMessage || empresa, W / 2, fyy + 2, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setTextColor(170, 178, 190); doc.setFontSize(8);
    doc.text(`Página ${p}/${pages}`, W - M, H - 24, { align: 'right' });
  }

  return doc;
}

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
