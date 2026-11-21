/**
 * Validação das FATURAS e LINHAS que sobem de um posto pela replicação.
 *
 * Antes, a nuvem inseria `invoices`/`invoice_items` tal como vinham (só
 * `WHERE NOT EXISTS id`): um caixa podia forjar faturas (número, data, totais,
 * estado) ou acrescentar linhas a uma fatura já emitida. Aqui ficam as regras
 * PURAS (testáveis sem BD); o serviço junta-lhes o estado da série na BD.
 *
 * O que é exigido a uma fatura replicada:
 *   • série de POSTO LOCAL (`L` + 3 caracteres — `apps/local-server`): a série
 *     da nuvem ('A') e as séries da Facturação Electrónica nunca vêm do posto;
 *   • tipo fiscal conhecido, ano/sequência coerentes e número = "<TIPO> <SÉRIE>/<ANO>/<SEQ>";
 *   • totais coerentes (bruto = líquido + IVA, nada negativo);
 *   • data de emissão nem futura nem anterior à última da mesma série, e
 *     sequência sempre maior do que a última (sem reutilizar números);
 *   • estado inicial 'N' ou 'A' e ciclo de vida 'ISSUED'/'ANNULLED'.
 * Linhas: só para faturas de série de posto e sem ultrapassar o total do cabeçalho.
 */

export const DEVICE_SERIES_RE = /^L[A-Z0-9]{3}$/;
const FISCAL_TYPES = new Set(['FT', 'FS', 'FR', 'NC', 'ND']);
const CENT = 0.011;

export interface LastInSeries {
  sequence: number;
  invoice_date: string; // AAAA-MM-DD
}

const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const isoDay = (v: unknown): string | null => {
  if (typeof v !== 'string' && !(v instanceof Date)) return null;
  const s = v instanceof Date ? v.toISOString() : v;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/** Número esperado para (tipo, série, ano, sequência): "FT L1AB2026/0001" (FS imprime-se FR). */
export function expectedNumber(docType: string, series: string, year: number, sequence: number): string {
  return `${docType === 'FS' ? 'FR' : docType} ${series}${year}/${String(sequence).padStart(4, '0')}`;
}
/** Formato legado ("FT L1AB/2026/0001"), ainda emitido por postos antigos. */
function legacyNumber(docType: string, series: string, year: number, sequence: number): string {
  return `${docType === 'FS' ? 'FR' : docType} ${series}/${year}/${String(sequence).padStart(4, '0')}`;
}

/** Erros (vazio = válida) de uma fatura replicada. `today` = AAAA-MM-DD em Luanda. */
export function checkReplicatedInvoice(d: Record<string, unknown>, last: LastInSeries | null, today: string): string[] {
  const e: string[] = [];
  const series = String(d.series ?? '');
  const docType = String(d.doc_type ?? '');
  const year = n(d.year);
  const seq = n(d.sequence);
  if (!DEVICE_SERIES_RE.test(series)) e.push(`série "${series}" não é de um posto local`);
  if (!FISCAL_TYPES.has(docType)) e.push(`tipo de documento "${docType}" não é aceite pela replicação`);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) e.push('ano inválido');
  if (!Number.isInteger(seq) || seq < 1) e.push('sequência inválida');
  const num = String(d.number ?? '');
  if (e.length === 0 && num !== expectedNumber(docType, series, year, seq) && num !== legacyNumber(docType, series, year, seq)) {
    e.push(`número "${String(d.number)}" não corresponde a ${expectedNumber(docType, series, year, seq)}`);
  }
  const net = n(d.net_total), iva = n(d.iva_total), gross = n(d.gross_total);
  if (![net, iva, gross].every(Number.isFinite)) e.push('totais em falta');
  else {
    if (net < 0 || iva < 0 || gross < 0) e.push('totais negativos');
    if (Math.abs(net + iva - gross) > CENT) e.push(`total bruto (${gross}) ≠ líquido (${net}) + IVA (${iva})`);
  }
  const day = isoDay(d.invoice_date);
  if (!day) e.push('data de emissão em falta');
  else {
    if (day > today) e.push(`data de emissão futura (${day})`);
    if (Number.isInteger(year) && Number(day.slice(0, 4)) !== year) e.push(`data ${day} fora do ano da série (${year})`);
    if (last && day < last.invoice_date) e.push(`data ${day} anterior à última da série (${last.invoice_date})`);
  }
  if (last && Number.isInteger(seq) && seq <= last.sequence) e.push(`sequência ${seq} já usada (última: ${last.sequence})`);
  const status = String(d.status ?? 'N');
  if (status !== 'N' && status !== 'A') e.push(`estado "${status}" inválido`);
  const state = String(d.doc_state ?? 'ISSUED');
  if (state !== 'ISSUED' && state !== 'ANNULLED') e.push(`ciclo de vida "${state}" inválido para uma fatura nova`);
  if (status === 'A' && state !== 'ANNULLED') e.push('fatura anulada sem ciclo ANNULLED');
  if (typeof d.hash !== 'string' || !d.hash || typeof d.signable_string !== 'string' || !d.signable_string) {
    e.push('fatura sem hash/texto assinado');
  }
  if (docType === 'NC' && !d.source_invoice_id) e.push('nota de crédito sem documento de origem');
  return e;
}

/** Erros de uma linha replicada (coerência interna). */
export function checkReplicatedItem(d: Record<string, unknown>): string[] {
  const e: string[] = [];
  if (typeof d.invoice_id !== 'string' || !d.invoice_id) e.push('linha sem fatura');
  const q = n(d.quantity), net = n(d.net_amount), iva = n(d.iva_amount), gross = n(d.gross_amount), price = n(d.unit_price);
  if (![q, net, iva, gross, price].every(Number.isFinite)) e.push('valores da linha em falta');
  else {
    if (q <= 0 || price < 0 || net < 0 || iva < 0) e.push('quantidade/valores inválidos');
    if (Math.abs(net + iva - gross) > CENT) e.push(`linha: bruto (${gross}) ≠ líquido (${net}) + IVA (${iva})`);
  }
  return e;
}
