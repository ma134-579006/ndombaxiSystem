import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { luandaDate } from '../common/luanda-date';

/** Documentos de venda com valor fiscal (as NC entram a negativo). */
export const FISCAL_SALE_TYPES = ['FT', 'FR', 'FS', 'ND', 'NC'] as const;
/** Todos os tipos que a «Listagem de Documentos» deixa escolher. */
export const LISTABLE_TYPES = ['FT', 'FR', 'FS', 'ND', 'NC', 'RC', 'PF', 'OR', 'GR', 'GT'] as const;
/** Taxas de IVA de Angola (o mapa de fornecedores mostra-as sempre, mesmo a zero). */
export const AO_IVA_RATES: { rate: number; label: string }[] = [
  { rate: 0, label: 'IVA - Isento (0%)' },
  { rate: 1, label: 'IVA - Taxa Reduzida (1%)' },
  { rate: 2, label: 'IVA - Taxa Cabinda (2%)' },
  { rate: 5, label: 'IVA - Taxa Intermédia (5%)' },
  { rate: 7, label: 'IVA - Taxa 7% (7%)' },
  { rate: 14, label: 'IVA - Taxa Normal (14%)' },
];

export interface AccountingFilter { from?: string; to?: string; storeId?: string; types?: string }

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const LIST_LIMIT = 2000;
const LINES_LIMIT = 3000;

/** Tipos pedidos (lista separada por vírgulas), só dos permitidos; vazio → os fiscais. */
export function parseTypes(raw: string | undefined, allowed: readonly string[], fallback: readonly string[]): string[] {
  const asked = (raw ?? '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => allowed.includes(s));
  return asked.length ? [...new Set(asked)] : [...fallback];
}

/** Junta as linhas do mapa de fornecedores às taxas de Angola (as que faltam vão a zero). */
export function withAllRates<T extends { rate: number }>(rows: T[], zero: (rate: number) => T): Array<T & { label: string }> {
  const out = AO_IVA_RATES.map(({ rate, label }) => ({ ...(rows.find((r) => Number(r.rate) === rate) ?? zero(rate)), label }));
  for (const r of rows) if (!AO_IVA_RATES.some((x) => x.rate === Number(r.rate))) out.push({ ...r, label: `IVA (${Number(r.rate)}%)` });
  return out;
}

/**
 * Relatórios de CONTABILIDADE no formato do Vendus (Gestão › Contabilidade):
 * Listagem de Documentos, Mapa de Impostos, Listagem de Produtos, Vendas Diárias,
 * Tipos de Pagamento e Mapa de Impostos de Fornecedores. Período pela DATA DO
 * DOCUMENTO; documentos anulados (status 'A') não entram nos totais; as notas de
 * crédito entram a negativo.
 */
@Injectable()
export class AccountingReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private range(from?: string, to?: string): { f: string; t: string } {
    const t = to && ISO.test(to) ? to : luandaDate();
    const f = from && ISO.test(from) ? from : `${t.slice(0, 8)}01`;
    return { f, t };
  }
  private store(storeId?: string, alias = 'i'): Prisma.Sql {
    return storeId ? Prisma.sql` AND ${Prisma.raw(alias)}.store_id = ${storeId}::uuid` : Prisma.empty;
  }
  private sign(alias = 'i'): Prisma.Sql {
    return Prisma.sql`(CASE WHEN ${Prisma.raw(alias)}.doc_type = 'NC' THEN -1 ELSE 1 END)`;
  }
  private inTypes(types: readonly string[], alias = 'i'): Prisma.Sql {
    return Prisma.sql`${Prisma.raw(alias)}.doc_type IN (${Prisma.join([...types])})`;
  }
  /** Método de pagamento da venda: movimento de caixa; sem ele → crédito (conta a receber) ou «sem turno». */
  private async payJoin(tx: Prisma.TransactionClient): Promise<{ join: Prisma.Sql; method: Prisma.Sql }> {
    const reg = await tx.$queryRaw<{ cm: string | null; rc: string | null }[]>(
      Prisma.sql`SELECT to_regclass('cash_movements')::text AS cm, to_regclass('receivables')::text AS rc`,
    );
    const join = reg[0]?.cm
      ? Prisma.sql`LEFT JOIN LATERAL (SELECT m.payment_type, m.session_id FROM cash_movements m WHERE m.type = 'SALE' AND m.reference_id = i.id ORDER BY m.created_at LIMIT 1) cm ON TRUE`
      : Prisma.sql`LEFT JOIN LATERAL (SELECT NULL::text AS payment_type, NULL::uuid AS session_id) cm ON TRUE`;
    const credit = reg[0]?.rc ? Prisma.sql`EXISTS (SELECT 1 FROM receivables r WHERE r.invoice_id = i.id)` : Prisma.sql`FALSE`;
    return { join, method: Prisma.sql`COALESCE(cm.payment_type, CASE WHEN ${credit} THEN 'CREDIT' ELSE 'SEM_TURNO' END)` };
  }

  /** Listagem de Documentos: linhas + «Total IVA» (tipo × taxa) + «Total» (tipo). */
  async documents(schema: string, q: AccountingFilter) {
    const { f, t } = this.range(q.from, q.to);
    const types = parseTypes(q.types, LISTABLE_TYPES, FISCAL_SALE_TYPES);
    return this.prisma.runInTenant(schema, async (tx) => {
      const pay = await this.payJoin(tx);
      const where = Prisma.sql`${this.inTypes(types)} AND i.invoice_date >= ${f}::date AND i.invoice_date <= ${t}::date${this.store(q.storeId)}`;
      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT i.id::text AS id, i.number, i.doc_type, i.invoice_date::text AS date, i.status,
               COALESCE(NULLIF(i.customer_name, ''), c.name) AS customer_name,
               COALESCE(i.customer_tax_id, c.tax_id) AS customer_tax_id,
               ${pay.method} AS method,
               (${this.sign()} * i.net_total)::float AS net,
               (${this.sign()} * i.iva_total)::float AS iva,
               (${this.sign()} * i.gross_total)::float AS gross,
               COALESCE((SELECT jsonb_agg(jsonb_build_object('code', x.iva_code, 'rate', x.iva_rate::float, 'iva', (${this.sign()} * x.iva)::float) ORDER BY x.iva_rate)
                           FROM (SELECT ii.iva_code, ii.iva_rate, SUM(ii.iva_amount) AS iva FROM invoice_items ii WHERE ii.invoice_id = i.id GROUP BY 1, 2) x), '[]'::jsonb) AS taxes
          FROM invoices i
          LEFT JOIN customers c ON c.id = i.customer_id
          ${pay.join}
         WHERE ${where}
         ORDER BY i.invoice_date DESC, i.system_entry_date DESC
         LIMIT ${LIST_LIMIT}`);
      const count = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM invoices i WHERE ${where}`);
      const ivaByType = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT i.doc_type, ii.iva_rate::float AS rate, ROUND(SUM(${this.sign()} * ii.iva_amount), 2)::float AS iva
          FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
         WHERE ${where} AND i.status <> 'A'
         GROUP BY 1, 2 ORDER BY 1, 2`);
      const totalsByType = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT i.doc_type, COUNT(*)::int AS docs,
               ROUND(SUM(${this.sign()} * i.net_total), 2)::float AS net,
               ROUND(SUM(${this.sign()} * i.iva_total), 2)::float AS iva,
               ROUND(SUM(${this.sign()} * i.gross_total), 2)::float AS gross
          FROM invoices i
         WHERE ${where} AND i.status <> 'A'
         GROUP BY 1 ORDER BY 1`);
      return { from: f, to: t, types, rows, total: count[0]?.n ?? rows.length, limit: LIST_LIMIT, ivaByType, totalsByType };
    });
  }

  /** Mapa de Impostos: por código/taxa (e por tipo de documento). */
  async taxMap(schema: string, q: AccountingFilter) {
    const { f, t } = this.range(q.from, q.to);
    return this.prisma.runInTenant(schema, async (tx) => {
      const where = Prisma.sql`${this.inTypes(FISCAL_SALE_TYPES)} AND i.status <> 'A' AND i.invoice_date >= ${f}::date AND i.invoice_date <= ${t}::date${this.store(q.storeId)}`;
      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT ii.iva_code AS code, ii.iva_rate::float AS rate, COUNT(DISTINCT i.id)::int AS docs,
               ROUND(SUM(${this.sign()} * ii.iva_amount), 2)::float AS iva,
               ROUND(SUM(${this.sign()} * ii.net_amount), 2)::float AS base,
               ROUND(SUM(${this.sign()} * ii.gross_amount), 2)::float AS total
          FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
         WHERE ${where}
         GROUP BY 1, 2 ORDER BY 2, 1`);
      const byType = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT i.doc_type, ii.iva_code AS code, ii.iva_rate::float AS rate, COUNT(DISTINCT i.id)::int AS docs,
               ROUND(SUM(${this.sign()} * ii.iva_amount), 2)::float AS iva,
               ROUND(SUM(${this.sign()} * ii.net_amount), 2)::float AS base,
               ROUND(SUM(${this.sign()} * ii.gross_amount), 2)::float AS total
          FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
         WHERE ${where}
         GROUP BY 1, 2, 3 ORDER BY 1, 3, 2`);
      return { from: f, to: t, rows, byType };
    });
  }

  /** Listagem de Produtos: cada linha vendida (documento, cliente, IVA, base, unitário, total). */
  async productLines(schema: string, q: AccountingFilter) {
    const { f, t } = this.range(q.from, q.to);
    return this.prisma.runInTenant(schema, async (tx) => {
      const where = Prisma.sql`${this.inTypes(FISCAL_SALE_TYPES)} AND i.status <> 'A' AND i.invoice_date >= ${f}::date AND i.invoice_date <= ${t}::date${this.store(q.storeId)}`;
      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT i.id::text AS id, ii.line_number AS line, i.number, i.doc_type, i.system_entry_date AS at,
               COALESCE(NULLIF(i.customer_name, ''), c.name) AS customer_name,
               COALESCE(i.customer_tax_id, c.tax_id) AS customer_tax_id,
               ii.product_code AS code, ii.description,
               (${this.sign()} * ii.quantity)::float AS qty,
               ii.iva_code AS iva_code, ii.iva_rate::float AS rate,
               (${this.sign()} * ii.iva_amount)::float AS iva,
               (${this.sign()} * ii.net_amount)::float AS base,
               ROUND(ii.unit_price * (1 + ii.iva_rate / 100), 2)::float AS unit,
               (${this.sign()} * ii.gross_amount)::float AS total
          FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
          LEFT JOIN customers c ON c.id = i.customer_id
         WHERE ${where}
         ORDER BY i.system_entry_date DESC, ii.line_number
         LIMIT ${LINES_LIMIT}`);
      const tot = await tx.$queryRaw<Array<{ n: number; qty: number; iva: number; base: number; total: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS n, ROUND(SUM(${this.sign()} * ii.quantity), 3)::float AS qty,
               ROUND(SUM(${this.sign()} * ii.iva_amount), 2)::float AS iva,
               ROUND(SUM(${this.sign()} * ii.net_amount), 2)::float AS base,
               ROUND(SUM(${this.sign()} * ii.gross_amount), 2)::float AS total
          FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
         WHERE ${where}`);
      const s = tot[0];
      return { from: f, to: t, rows, total: s?.n ?? rows.length, limit: LINES_LIMIT, totals: { qty: s?.qty ?? 0, iva: s?.iva ?? 0, base: s?.base ?? 0, total: s?.total ?? 0 } };
    });
  }

  /** Vendas Diárias: quantidades e totais por loja e produto no intervalo de datas. */
  async dailySales(schema: string, q: AccountingFilter) {
    const { f, t } = this.range(q.from ?? q.to ?? luandaDate(), q.to);
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT COALESCE(w.name, '—') AS store_name, ii.product_code AS code, MAX(ii.description) AS description,
               ROUND(SUM(${this.sign()} * ii.quantity), 3)::float AS qty,
               ROUND(SUM(${this.sign()} * ii.net_amount), 2)::float AS net,
               ROUND(SUM(${this.sign()} * ii.gross_amount), 2)::float AS gross
          FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
          LEFT JOIN stores w ON w.id = i.store_id
         WHERE ${this.inTypes(FISCAL_SALE_TYPES)} AND i.status <> 'A'
           AND i.invoice_date >= ${f}::date AND i.invoice_date <= ${t}::date${this.store(q.storeId)}
         GROUP BY 1, 2 ORDER BY 1, 3`);
      return { from: f, to: t, rows };
    });
  }

  /** Tipos de Pagamento: por loja e caixa, com o total de cada método. */
  async paymentTypes(schema: string, q: AccountingFilter) {
    const { f, t } = this.range(q.from, q.to);
    return this.prisma.runInTenant(schema, async (tx) => {
      const pay = await this.payJoin(tx);
      const reg = await tx.$queryRaw<{ cs: string | null }[]>(Prisma.sql`SELECT to_regclass('cash_sessions')::text AS cs`);
      const sess = reg[0]?.cs
        ? Prisma.sql`LEFT JOIN cash_sessions s ON s.id = cm.session_id`
        : Prisma.sql`LEFT JOIN LATERAL (SELECT NULL::text AS register_code) s ON TRUE`;
      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT COALESCE(w.name, '—') AS store_name, COALESCE(NULLIF(s.register_code, ''), '') AS register,
               ${pay.method} AS method, COUNT(*)::int AS count, ROUND(SUM(i.gross_total), 2)::float AS total
          FROM invoices i
          LEFT JOIN stores w ON w.id = i.store_id
          ${pay.join}
          ${sess}
         WHERE i.doc_type IN ('FT','FR','FS') AND i.status <> 'A'
           AND i.invoice_date >= ${f}::date AND i.invoice_date <= ${t}::date${this.store(q.storeId)}
         GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`);
      return { from: f, to: t, rows };
    });
  }

  /** Mapa de Impostos de Fornecedores: compras rececionadas no período, por taxa de IVA. */
  async supplierTaxMap(schema: string, q: AccountingFilter) {
    const { f, t } = this.range(q.from, q.to);
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ rate: number; products: number; iva: number; base: number; total: number }>>(Prisma.sql`
        SELECT pi.iva_rate::float AS rate, COUNT(*)::int AS products,
               ROUND(SUM(pi.iva_amount), 2)::float AS iva,
               ROUND(SUM(pi.net_amount), 2)::float AS base,
               ROUND(SUM(pi.gross_amount), 2)::float AS total
          FROM purchase_orders po JOIN purchase_order_items pi ON pi.po_id = po.id
         WHERE po.status = 'RECEIVED' AND po.order_date >= ${f}::date AND po.order_date <= ${t}::date
         GROUP BY 1 ORDER BY 1`);
      return { from: f, to: t, rows: withAllRates(rows, (rate) => ({ rate, products: 0, iva: 0, base: 0, total: 0 })) };
    });
  }
}
