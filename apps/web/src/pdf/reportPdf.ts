import { jsPDF } from 'jspdf';
import type { DocumentIdentity } from '../api/types';

export interface ReportTable {
  heading?: string;
  columns: string[];
  rows: string[][];
  /** Linhas de total (rodapé da tabela): a negrito, com linha escura por cima. */
  foot?: string[][];
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
  /** Notas no fim (texto pequeno a cinzento, por baixo das tabelas). */
  notes?: string[];
  /** Quem gerou (rodapé "Gerado Online / <nome>"). */
  generatedBy?: string | null;
}

type RGB = [number, number, number];
const INK: RGB = [0, 0, 0];
const TITLE: RGB = [51, 51, 51];
const GREY: RGB = [110, 110, 110];
const BAND: RGB = [238, 238, 238];
const ZEBRA: RGB = [249, 249, 249];
const SEP: RGB = [229, 229, 229];
const RULE: RGB = [51, 51, 51];
const FOOT_LINE: RGB = [239, 239, 239];

/**
 * Relatório A4 no formato do sistema de referência (medido no PDF dele):
 * faixa cinzenta no topo com o título à esquerda (sem negrito) e empresa +
 * contribuinte à direita em letra pequena; tabela com cabeçalho a negrito e
 * linha escura por baixo, linhas alternadas (#F9F9F9 / branco) separadas por
 * um fio claro, linha de total a negrito com linha escura por cima; rodapé em
 * todas as páginas com "Gerado Online", quem gerou, data e "Página x / y".
 */
export async function buildReportPdf(a: ReportPdfArgs): Promise<jsPDF> {
  const { identity, title, subtitle, summary, tables, notes, generatedBy } = a;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 20; // margem lateral (faixa e tabelas de 20 a W-20)
  const PAD = 3; // recuo do texto dentro das células
  const empresa = identity?.companyName || identity?.brandName || '';
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${two(now.getDate())}/${two(now.getMonth() + 1)}/${now.getFullYear()} ${two(now.getHours())}:${two(now.getMinutes())}`;
  const footerTop = H - 43; // linha do rodapé
  const bottom = footerTop - 12; // limite do conteúdo
  const startY = 72;

  // ── Cabeçalho (repetido em todas as páginas) ──
  const drawHeader = () => {
    doc.setFillColor(...BAND);
    doc.rect(M, 12, W - 2 * M, 33, 'F');
    doc.setTextColor(...TITLE);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12.5);
    const head = subtitle ? `${title} ${subtitle}` : title;
    const maxW = W - 2 * M - (empresa || identity?.nif ? 170 : 14);
    doc.text((doc.splitTextToSize(head, maxW) as string[])[0] ?? head, M + 7, 32.5);
    doc.setFontSize(7); doc.setTextColor(...GREY);
    if (empresa) doc.text(empresa, W - M - 5, identity?.nif ? 26 : 30.5, { align: 'right' });
    if (identity?.nif) doc.text(`Contribuinte ${identity.nif}`, W - M - 5, 35, { align: 'right' });
  };
  drawHeader();
  let y = startY;
  const newPage = () => { doc.addPage(); drawHeader(); y = startY; };

  // ── Resumo (rótulo → valor), em duas colunas compactas ──
  if (summary && summary.length) {
    const colW = (W - 2 * M) / 2;
    const rowH = 16;
    for (let i = 0; i < summary.length; i += 2) {
      if (y + rowH > bottom) newPage();
      if ((i / 2) % 2 === 0) { doc.setFillColor(...ZEBRA); doc.rect(M, y, W - 2 * M, rowH, 'F'); }
      for (let j = 0; j < 2 && i + j < summary.length; j++) {
        const [k, v] = summary[i + j];
        const cx = M + j * colW;
        doc.setFontSize(7.8);
        doc.setFont('helvetica', 'normal'); doc.setTextColor(...GREY); doc.text(String(k), cx + PAD, y + 10.8);
        doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK); doc.text(String(v), cx + colW - PAD - 6, y + 10.8, { align: 'right' });
      }
      doc.setDrawColor(...SEP); doc.setLineWidth(0.5); doc.line(M, y + rowH, W - M, y + rowH);
      y += rowH;
    }
    y += 22;
  }

  // ── Tabelas ──
  for (const t of tables) {
    if (!t.columns.length || !t.rows.length) continue;
    const foot = t.foot ?? [];
    const usable = W - 2 * M;
    const fs = t.columns.length > 10 ? 6.4 : t.columns.length > 8 ? 7 : 7.8;
    const lh = fs + 2.4; // altura de linha de texto
    const padY = 5.6; // espaço vertical em cada linha (linha simples ≈ 18,6 pt)
    // Larguras pelo conteúdo (amostra), com mínimo e máximo.
    doc.setFont('helvetica', 'normal'); doc.setFontSize(fs);
    const sample = [...t.rows.slice(0, 60), ...foot];
    const natural = t.columns.map((c, i) => {
      doc.setFont('helvetica', 'bold');
      const hw = doc.getTextWidth(c);
      doc.setFont('helvetica', 'normal');
      const lens = [hw, ...sample.map((r) => doc.getTextWidth(String(r[i] ?? '')))];
      lens.sort((p, q) => p - q);
      return Math.min(170, Math.max(30, lens[Math.floor(lens.length * 0.9)] ?? 30) + 2 * PAD + 4);
    });
    const nsum = natural.reduce((s, w) => s + w, 0);
    const colW = natural.map((w) => (w / nsum) * usable);
    const colX: number[] = [];
    let acc = M;
    for (const w of colW) { colX.push(acc); acc += w; }
    const rightAlign = t.columns.map((_, i) => {
      const s = t.rows.slice(0, 20).map((r) => String(r[i] ?? '').trim()).filter(Boolean);
      const num = s.filter((v) => /^[+-]?[\d.\s]*\d(,\d+)?\s*(kz|aoa|%)?$/i.test(v)).length;
      return i !== 0 && s.length > 0 && num >= s.length * 0.6;
    });
    const cellX = (i: number) => (rightAlign[i] ? colX[i] + colW[i] - PAD : colX[i] + PAD);
    const opt = (i: number) => ({ align: (rightAlign[i] ? 'right' : 'left') as 'right' | 'left' });

    if (t.heading) {
      if (y + 60 > bottom) newPage();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...TITLE);
      doc.text(t.heading, M + PAD, y); y += 14;
    }

    const drawHead = () => {
      doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(fs);
      if (t.groups?.length) {
        for (const g of t.groups) {
          const gx = colX[g.from]; const gw = colW.slice(g.from, g.from + g.span).reduce((s, w) => s + w, 0);
          doc.text(g.label, gx + gw / 2, y + fs, { align: 'center' });
          doc.setDrawColor(...SEP); doc.setLineWidth(0.6); doc.line(gx + 2, y + fs + 3, gx + gw - 2, y + fs + 3);
        }
        y += lh + 6;
      }
      let hh = 1;
      const heads = t.columns.map((c, i) => { const ls = doc.splitTextToSize(c, colW[i] - 2 * PAD) as string[]; hh = Math.max(hh, ls.length); return ls; });
      heads.forEach((ls, i) => doc.text(ls, cellX(i), y + fs, opt(i)));
      y += fs + (hh - 1) * lh + 6;
      doc.setDrawColor(...RULE); doc.setLineWidth(1.2); doc.line(M, y, W - M, y);
      y += 1;
    };
    if (y + 60 > bottom) newPage();
    drawHead();

    const drawRow = (row: string[], kind: 'body' | 'foot', idx: number) => {
      doc.setFont('helvetica', kind === 'foot' ? 'bold' : 'normal'); doc.setFontSize(fs);
      const cells = t.columns.map((_, i) => doc.splitTextToSize(String(row[i] ?? ''), colW[i] - 2 * PAD) as string[]);
      const lines = Math.max(1, ...cells.map((c) => c.length));
      const rowH = (lines - 1) * lh + fs + 2 * padY + 1;
      if (y + rowH > bottom) { newPage(); drawHead(); doc.setFont('helvetica', kind === 'foot' ? 'bold' : 'normal'); doc.setFontSize(fs); }
      if (kind === 'body' && idx % 2 === 0) { doc.setFillColor(...ZEBRA); doc.rect(M, y, usable, rowH, 'F'); }
      if (kind === 'foot' && idx === 0) { doc.setDrawColor(...RULE); doc.setLineWidth(1.2); doc.line(M, y, W - M, y); }
      doc.setTextColor(...INK);
      cells.forEach((c, i) => doc.text(c, cellX(i), y + padY + fs - 1, opt(i)));
      y += rowH;
      doc.setDrawColor(...SEP); doc.setLineWidth(0.5); doc.line(M, y, W - M, y);
    };
    t.rows.forEach((r, i) => drawRow(r, 'body', i));
    foot.forEach((r, i) => drawRow(r, 'foot', i));
    y += 22;
  }

  // ── Notas ──
  if (notes?.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...GREY);
    for (const n of notes) {
      const ls = doc.splitTextToSize(n, W - 2 * M) as string[];
      if (y + ls.length * 9 > bottom) newPage();
      doc.text(ls, M, y); y += ls.length * 9 + 3;
    }
  }

  // ── Rodapé em todas as páginas ──
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...FOOT_LINE); doc.setLineWidth(0.8); doc.line(M, footerTop, W - M, footerTop);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.7); doc.setTextColor(...GREY);
    const lines = ['Gerado Online', ...(generatedBy ? [String(generatedBy)] : []), dateStr];
    lines.forEach((l, i) => doc.text(l, M + 3, footerTop + 12 + i * 6.6));
    doc.setFontSize(7.4);
    doc.text(`Página ${p} / ${pages}`, W - M - 3, footerTop + 22, { align: 'right' });
  }

  return doc;
}
