import { api } from '../api/client';
import type { DocumentIdentity } from '../api/types';
// IMPORT DINÂMICO do gerador (e do jsPDF, ~400 KB): só é descarregado quando o
// utilizador imprime — fora do caminho crítico do arranque da app.
import type { ReportTable } from './reportPdf';

let cachedIdentity: DocumentIdentity | null = null;
async function branding(): Promise<DocumentIdentity | null> {
  if (cachedIdentity) return cachedIdentity;
  try { cachedIdentity = await api.branding(); } catch { cachedIdentity = null; }
  return cachedIdentity;
}

function txt(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}
function isHidden(el: Element): boolean {
  return el.classList.contains('no-print') || el.classList.contains('actions');
}

/** Extrai uma tabela HTML para { columns, rows } (ignora colunas .no-print/.actions). */
function scrapeTable(table: HTMLTableElement): ReportTable | null {
  const headCells = Array.from(table.querySelectorAll('thead th'));
  const keep: boolean[] = headCells.map((th) => !isHidden(th) && txt(th) !== '');
  const columns = headCells.filter((_, i) => keep[i]).map((th) => txt(th));
  // Sem thead utilizável → tenta a 1ª linha do corpo como cabeçalho
  if (!columns.length) return null;
  const rows: string[][] = [];
  for (const tr of Array.from(table.querySelectorAll('tbody tr'))) {
    const cells = Array.from(tr.children) as HTMLElement[];
    const row = cells.filter((_, i) => keep[i] ?? !isHidden(cells[i])).map((td) => txt(td));
    if (row.some((c) => c !== '')) rows.push(row);
  }
  if (!rows.length) return null;
  return { columns, rows };
}

/** Recolhe cartões de indicador (.kpi-card) como linhas de resumo [rótulo, valor]. */
function scrapeSummary(root: Element): [string, string][] {
  const out: [string, string][] = [];
  for (const card of Array.from(root.querySelectorAll('.kpi-card'))) {
    const v = txt(card.querySelector('.kpi-value'));
    if (!v) continue;
    const full = txt(card);
    const label = full.replace(v, '').trim() || 'Total';
    out.push([label, v]);
  }
  return out;
}

/**
 * Imprime a secção ATUAL como um PDF profissional, idêntico à fatura
 * (cabeçalho com os dados da empresa, tabelas limpas, QR e rodapé).
 * Abre o PDF num separador para o utilizador ver/guardar/imprimir.
 */
export async function printSectionReport(opts?: { title?: string; subtitle?: string }): Promise<void> {
  const root = document.querySelector('.content .page-anim') ?? document.body;
  // Título: o indicado, senão um <h2> de relatório, senão o cabeçalho da secção.
  const heads = Array.from(root.querySelectorAll('h2'));
  const printHead = heads.find((h) => !h.closest('.no-print'));
  const title = opts?.title || txt(printHead) || txt(root.querySelector('.content-head h2')) || 'Relatório';

  const tables: ReportTable[] = [];
  for (const t of Array.from(root.querySelectorAll('table'))) {
    if (t.closest('.no-print')) continue;
    const r = scrapeTable(t as HTMLTableElement);
    if (r) tables.push(r);
  }
  const summary = scrapeSummary(root);

  // Sem dados tabulares → mantém a impressão nativa (não gera PDF vazio).
  if (!tables.length && !summary.length) { window.print(); return; }

  await printReportPdf({ title, subtitle: opts?.subtitle, summary, tables });
}

/**
 * Gera e abre um PDF profissional (design da fatura) a partir de dados
 * explícitos — para ecrãs que já têm a informação calculada (ex.: folha de
 * contagem de inventário).
 */
export async function printReportPdf(args: { title: string; subtitle?: string; summary?: [string, string][]; tables: ReportTable[] }): Promise<void> {
  const [{ buildReportPdf }, identity] = await Promise.all([import('./reportPdf'), branding()]);
  const doc = await buildReportPdf({ identity, ...args });
  const filename = `${args.title.replace(/[^\wÀ-ſ -]/g, '').trim().replace(/\s+/g, '-') || 'Relatorio'}.pdf`;
  try {
    const url = doc.output('bloburl');
    const w = window.open(url as unknown as string, '_blank');
    if (!w) doc.save(filename);
  } catch {
    doc.save(filename);
  }
}
