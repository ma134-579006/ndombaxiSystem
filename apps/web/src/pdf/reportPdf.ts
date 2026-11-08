import { jsPDF } from 'jspdf';
import type { DocumentIdentity } from '../api/types';

export interface ReportTable {
  heading?: string;
  columns: string[];
  rows: string[][];
  /** Cabeçalho de grupo por cima das colunas (ex.: "IVA" sobre Código/Taxa). */
  groups?: { label: string; from: number; span: number }[];
}
export interface ReportPdfArgs {
  identity?: DocumentIdentity | null;
  title: string;
  /** Período ou filtro (ex.: "01/11/2026 a 30/11/2026"). */
  subtitle?: string;
  /** Linhas de resumo (rótulo → valor). */
  summary?: [string, string][];
  tables: ReportTable[];
  /** Quem gerou (rodapé "Gerado Online / <nome>"). */
  generatedBy?: string | null;
}

const INK: [number, number, number] = [0, 0, 0];
const GREY: [number, number, number] = [90, 90, 90];
const LINE: [number, number, number] = [205, 205, 205];

/**
 * Relatório A4 no formato de referência: título com o período à esquerda,
 * empresa e contribuinte à direita; tabela simples (texto preto, cabeçalho a
 * negrito com linha por baixo, células que quebram em várias linhas, sem cores
 * de fundo); rodapé em todas as páginas com "Gerado Online", quem gerou, data e
 * "Página x / y". Reutilizável por qualquer secção que tenha "Imprimir".
 */
export async function buildReportPdf(a: ReportPdfArgs): Promise<jsPDF> {
  const { identity, title, subtitle, summary, tables, generatedBy } = a;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 28;
  const empresa = identity?.companyName || identity?.brandName || '';
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${two(now.getDate())}/${two(now.getMonth() + 1)}/${now.getFullYear()} ${two(now.getHours())}:${two(now.getMinutes())}`;
  const footerSafe = 56;
  const top = 40;

  // ── Cabeçalho (repetido em todas as páginas) ──
  const drawHeader = () => {
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
    const head = subtitle ? `${title} - ${subtitle}` : title;
    doc.text(doc.splitTextToSize(head, W / 2 - M)[0] ?? head, M, top);
    if (empresa) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.text(empresa, W - M, top, { align: 'right' });
    }
    if (identity?.nif) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GREY);
      doc.text(`Contribuinte ${identity.nif}`, W - M, top + 11, { align: 'right' });
    }
  };
  drawHeader();
  let y = top + 44;
  const newPage = () => { doc.addPage(); drawHeader(); y = top + 44; };

  // ── Resumo (rótulo → valor), em duas colunas compactas ──
  if (summary && summary.length) {
    doc.setFontSize(8);
    const colW = (W - 2 * M) / 2;
    summary.forEach(([k, v], i) => {
      const cx = M + (i % 2) * colW;
      if (i % 2 === 0 && i > 0) y += 13;
      if (y > H - footerSafe) newPage();
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...GREY); doc.text(String(k), cx, y);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK); doc.text(String(v), cx + colW - 12, y, { align: 'right' });
    });
    y += 24;
  }

  // ── Tabelas ──
  for (const t of tables) {
    if (!t.columns.length || !t.rows.length) continue;
    const usable = W - 2 * M;
    const fs = t.columns.length > 9 ? 6.5 : t.columns.length > 6 ? 7 : 8;
    const lh = fs + 2.6; // altura de linha de texto
    // Larguras pelo conteúdo (amostra), com mínimo e a 1.ª coluna de texto mais larga.
    doc.setFont('helvetica', 'normal'); doc.setFontSize(fs);
    const sample = t.rows.slice(0, 60);
    const natural = t.columns.map((c, i) => {
      const lens = [doc.getTextWidth(c), ...sample.map((r) => doc.getTextWidth(String(r[i] ?? '')))];
      lens.sort((p, q) => p - q);
      return Math.min(150, Math.max(34, lens[Math.floor(lens.length * 0.9)] ?? 34) + 10);
    });
    const nsum = natural.reduce((s, w) => s + w, 0);
    const colW = natural.map((w) => (w / nsum) * usable);
    const colX: number[] = [];
    let acc = M;
    for (const w of colW) { colX.push(acc); acc += w; }
    const rightAlign = t.columns.map((_, i) => {
      const s = sample.slice(0, 20).map((r) => String(r[i] ?? '').trim()).filter(Boolean);
      const num = s.filter((v) => /^[+-]?[\d.\s]*\d(,\d+)?\s*(kz|aoa|%)?$/i.test(v)).length;
      return i !== 0 && s.length > 0 && num >= s.length * 0.6;
    });
    const cellX = (i: number) => (rightAlign[i] ? colX[i] + colW[i] - 4 : colX[i] + 2);

    if (t.heading) {
      if (y > H - footerSafe - 40) newPage();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK);
      doc.text(t.heading, M, y); y += 16;
    }

    const drawHead = () => {
      doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(fs);
      if (t.groups?.length) {
        for (const g of t.groups) {
          const gx = colX[g.from]; const gw = colW.slice(g.from, g.from + g.span).reduce((s, w) => s + w, 0);
          doc.text(g.label, gx + gw / 2, y, { align: 'center' });
          doc.setDrawColor(...LINE); doc.setLineWidth(0.6); doc.line(gx + 2, y + 3, gx + gw - 2, y + 3);
        }
        y += lh + 4;
      }
      let hh = 1;
      const heads = t.columns.map((c, i) => { const ls = doc.splitTextToSize(c, colW[i] - 6) as string[]; hh = Math.max(hh, ls.length); return ls; });
      heads.forEach((ls, i) => doc.text(ls, cellX(i), y, { align: rightAlign[i] ? 'right' : 'left' }));
      y += (hh - 1) * lh + 5;
      doc.setDrawColor(...INK); doc.setLineWidth(0.7); doc.line(M, y, W - M, y);
      y += lh + 3;
    };
    drawHead();

    doc.setFont('helvetica', 'normal'); doc.setFontSize(fs); doc.setTextColor(...INK);
    for (const row of t.rows) {
      const cells = t.columns.map((_, i) => doc.splitTextToSize(String(row[i] ?? ''), colW[i] - 6) as string[]);
      const lines = Math.max(1, ...cells.map((c) => c.length));
      const rowH = lines * lh + 6;
      if (y + rowH - lh > H - footerSafe) { newPage(); drawHead(); doc.setFont('helvetica', 'normal'); doc.setFontSize(fs); doc.setTextColor(...INK); }
      cells.forEach((c, i) => doc.text(c, cellX(i), y, { align: rightAlign[i] ? 'right' : 'left' }));
      y += rowH;
    }
    y += 14;
  }

  // ── Rodapé em todas as páginas ──
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GREY);
    const fy = H - 38;
    doc.text('Gerado Online', M, fy);
    if (generatedBy) doc.text(String(generatedBy), M, fy + 10);
    doc.text(dateStr, M, fy + (generatedBy ? 20 : 10));
    doc.text(`Página ${p} / ${pages}`, W - M, fy + 10, { align: 'right' });
  }

  return doc;
}
