import { round2 } from '../money';
import type { FiscalDocument } from '../types';

/**
 * Validação SEMÂNTICA do conteúdo de um SAF-T (AO) de facturação — o que o XSD
 * não apanha: um ficheiro pode ser estruturalmente válido e fiscalmente errado.
 * Cada problema indica o documento, a regra e a causa.
 */
export interface SemanticIssue { document: string; rule: string; message: string }

const CENT = 0.011;
const NIF_RE = /^(\d{9}|\d{10}|[0-9]{9}[A-Z]{2}[0-9]{3})$/;
const NUM_RE = /^([A-Z]{2}) ([^ /]+)\/(\d+)$/;

export function validateSaftSemantics(docs: FiscalDocument[], period: { startDate: string; endDate: string }): SemanticIssue[] {
  const out: SemanticIssue[] = [];
  const add = (d: string, rule: string, message: string) => out.push({ document: d, rule, message });
  const seen = new Set<string>();
  const numbers = new Set(docs.map((d) => d.number));
  const lastBySeries = new Map<string, { seq: number; date: string }>();
  const sorted = [...docs].sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }));
  for (const d of sorted) {
    if (seen.has(d.number)) add(d.number, 'S01-DUPLICADO', 'número de documento repetido');
    seen.add(d.number);
    const m = NUM_RE.exec(d.number.replace(/^([A-Z]+) ([A-Z0-9]{1,5})\/(\d{4})\//, '$1 $2$3/'));
    if (!m) { add(d.number, 'S02-NUMERO', 'número fora do padrão "<TIPO> <SÉRIE>/<SEQ>"'); continue; }
    const key = `${m[1]} ${m[2]}`;
    const seq = Number(m[3]);
    const prev = lastBySeries.get(key);
    if (prev && seq !== prev.seq + 1) add(d.number, 'S03-SEQUENCIA', `sequência ${seq} após ${prev.seq} (esperado ${prev.seq + 1})`);
    if (prev && d.invoiceDate < prev.date) add(d.number, 'S04-DATA-ORDEM', `data ${d.invoiceDate} anterior à do documento anterior (${prev.date})`);
    lastBySeries.set(key, { seq, date: d.invoiceDate });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.invoiceDate)) add(d.number, 'S05-DATA', `data inválida "${d.invoiceDate}"`);
    else if (d.invoiceDate < period.startDate || d.invoiceDate > period.endDate) add(d.number, 'S06-PERIODO', `data ${d.invoiceDate} fora do período ${period.startDate}..${period.endDate}`);
    if (d.customerTaxId && !NIF_RE.test(d.customerTaxId.trim()) && d.customerTaxId.trim() !== '999999999') add(d.number, 'S07-NIF', `NIF do cliente inválido "${d.customerTaxId}"`);
    if (!d.lines.length) add(d.number, 'S08-LINHAS', 'documento sem linhas');
    const net = round2(d.lines.reduce((s, l) => s + l.netAmount, 0));
    const iva = round2(d.lines.reduce((s, l) => s + l.ivaAmount, 0));
    if (Math.abs(net - d.totals.netTotal) > CENT) add(d.number, 'S09-NETTOTAL', `NetTotal ${d.totals.netTotal} ≠ soma das linhas ${net}`);
    if (Math.abs(iva - d.totals.ivaTotal) > CENT) add(d.number, 'S10-TAXPAYABLE', `TaxPayable ${d.totals.ivaTotal} ≠ soma do IVA das linhas ${iva}`);
    if (Math.abs(round2(d.totals.netTotal + d.totals.ivaTotal) - d.totals.grossTotal) > CENT) add(d.number, 'S11-GROSSTOTAL', 'GrossTotal ≠ NetTotal + TaxPayable');
    d.lines.forEach((l, i) => {
      const exp = round2(l.netAmount * l.ivaRate / 100);
      if (Math.abs(exp - l.ivaAmount) > CENT) add(d.number, 'S12-IVA-LINHA', `linha ${i + 1}: IVA ${l.ivaAmount} ≠ ${l.ivaRate}% de ${l.netAmount}`);
      if (l.ivaRate === 0 && !l.exemptionCode) add(d.number, 'S13-ISENCAO', `linha ${i + 1}: taxa 0% sem TaxExemptionCode`);
      if (l.quantity <= 0) add(d.number, 'S14-QUANTIDADE', `linha ${i + 1}: quantidade ${l.quantity}`);
    });
    if (String(d.type) === 'NC') {
      if (!d.reference) add(d.number, 'S15-REFERENCIA', 'nota de crédito sem documento de origem');
      else if (!numbers.has(d.reference)) add(d.number, 'S16-REFERENCIA-FORA', `origem ${d.reference} não está no ficheiro (aceitável se for de período anterior — confirmar)`);
    }
    if (!d.hash && !d.signature) add(d.number, 'S17-HASH', 'documento sem assinatura/hash');
  }
  return out;
}
