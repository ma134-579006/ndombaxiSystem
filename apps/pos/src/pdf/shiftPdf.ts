// jsPDF (~400 KB) é carregado DINAMICAMENTE na 1.ª geração de PDF.
import type { jsPDF } from 'jspdf';
import type { DocumentIdentity, ShiftClose } from '../api/types';
import { formatDateTime, formatKz } from '../format';

export interface ShiftPdfArgs {
  result: ShiftClose;
  identity?: DocumentIdentity | null;
  operatorName?: string | null;
}

const VERDICT_LABEL: Record<ShiftClose['verdict'], string> = {
  OK: 'CAIXA CERTO',
  QUEBRA: 'QUEBRA DE CAIXA',
  SOBRA: 'SOBRA DE CAIXA',
};

/** Gera o RELATÓRIO DE FECHO DE TURNO (Z) em A4 profissional (PDF). */
export async function buildShiftClosePdf(a: ShiftPdfArgs): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf');
  const { result: r, identity, operatorName } = a;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  let y = 54;
  const empresa = identity?.companyName || identity?.brandName || 'Fecho de turno';
  const accent: [number, number, number] = [255, 77, 45];
  const tone: [number, number, number] =
    r.verdict === 'OK' ? [22, 163, 74] : r.verdict === 'QUEBRA' ? [220, 38, 38] : [217, 119, 6];

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
  if (identity?.nif) doc.text(`NIF: ${identity.nif}`, tx, y + 16);
  if (identity?.address) doc.text(doc.splitTextToSize(identity.address, W - tx - M - 160), tx, y + 30);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...accent);
  doc.text('FECHO DE TURNO (Z)', W - M, y, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(110, 120, 135);
  doc.text(`Aberto: ${formatDateTime(new Date(r.openedAt))}`, W - M, y + 17, { align: 'right' });
  doc.text(`Fechado: ${formatDateTime(new Date(r.closedAt))}`, W - M, y + 30, { align: 'right' });

  y += 64;
  doc.setDrawColor(...accent); doc.setLineWidth(2); doc.line(M, y, W - M, y);
  y += 24;

  // ── Operador ──
  doc.setFontSize(10.5); doc.setTextColor(90, 100, 115); doc.text('Operador', M, y);
  doc.setTextColor(20, 24, 32); doc.setFont('helvetica', 'bold');
  doc.text(operatorName || r.openedByName || '—', M, y + 15);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(90, 100, 115);
  doc.text('Documentos', W / 2, y); doc.setTextColor(20, 24, 32); doc.setFont('helvetica', 'bold');
  doc.text(String(r.salesCount), W / 2, y + 15);
  y += 40;

  // ── Veredicto destacado ──
  doc.setFillColor(...tone); doc.rect(M, y - 14, W - 2 * M, 34, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text(VERDICT_LABEL[r.verdict], M + 12, y + 6);
  doc.text(formatKz(r.difference), W - M - 12, y + 6, { align: 'right' });
  y += 46;

  // ── Conferência de caixa ──
  const rows: [string, string][] = [
    ['Fundo inicial', formatKz(r.openingFloat)],
    ['Vendas (total)', `${formatKz(r.salesTotal)} · ${r.salesCount}`],
    ['Vendas em numerário', formatKz(r.cashSales)],
  ];
  if (r.cashIn > 0) rows.push(['Reforços', formatKz(r.cashIn)]);
  if (r.cashOut > 0) rows.push(['Sangrias', `−${formatKz(r.cashOut)}`]);
  rows.push(['Esperado na gaveta', formatKz(r.expected)]);
  rows.push(['Contado (físico)', formatKz(r.counted)]);
  rows.push(['Diferença', formatKz(r.difference)]);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  for (const [k, val] of rows) {
    doc.setFillColor(247, 249, 252); doc.rect(M, y - 14, W - 2 * M, 26, 'F');
    doc.setTextColor(70, 80, 95); doc.text(k, M + 12, y + 3);
    doc.setTextColor(20, 24, 32); doc.text(val, W - M - 12, y + 3, { align: 'right' });
    y += 30;
  }
  y += 14;

  // ── Produtos vendidos no turno ──
  if (r.products.length) {
    if (y > H - 160) { doc.addPage(); y = 54; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(20, 24, 32);
    doc.text('Produtos vendidos no turno', M, y); y += 12;
    const cQt = W - M - 230, cTot = W - M;
    doc.setFillColor(20, 24, 32); doc.rect(M, y - 6, W - 2 * M, 24, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(255, 255, 255);
    doc.text('Artigo', M + 10, y + 10);
    doc.text('Qt', cQt, y + 10, { align: 'right' });
    doc.text('Total', cTot - 10, y + 10, { align: 'right' });
    y += 24;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    let alt = false;
    for (const p of r.products) {
      if (y > H - 90) { doc.addPage(); y = 54; }
      if (alt) { doc.setFillColor(247, 249, 252); doc.rect(M, y - 1, W - 2 * M, 22, 'F'); }
      alt = !alt;
      doc.setTextColor(30, 36, 46);
      const name = doc.splitTextToSize(`${p.description}`, cQt - M - 24)[0] ?? p.description;
      doc.text(String(name), M + 10, y + 14);
      doc.text(String(p.quantity), cQt, y + 14, { align: 'right' });
      doc.text(formatKz(p.grossTotal), cTot - 10, y + 14, { align: 'right' });
      y += 22;
    }
  }

  // ── Rodapé ──
  const fy = H - 56;
  doc.setDrawColor(225, 230, 240); doc.setLineWidth(1); doc.line(M, fy, W - M, fy);
  doc.setFontSize(9.5); doc.setTextColor(110, 120, 135);
  doc.text(`Documento gerado em ${formatDateTime()}`, M, fy + 16);
  doc.text(empresa, W - M, fy + 16, { align: 'right' });

  return doc;
}

export function shiftFileName(r: ShiftClose): string {
  const d = new Date(r.closedAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `Fecho-turno-${stamp}.pdf`;
}

/** Carrega o logo como data URL para o jsPDF (tolera CORS falhar). */
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
