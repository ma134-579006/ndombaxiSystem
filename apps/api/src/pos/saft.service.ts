import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DocumentType,
  FiscalDocument,
  InvoiceLineComputed,
  IvaCode,
  writeSaftXml,
} from '@nexus/agt-xml';
import { AgtConfigService } from '../fiscal/agt-config.service';
import { PrismaService } from '../prisma/prisma.service';

interface InvoiceHeaderRow {
  id: string;
  number: string;
  doc_type: DocumentType;
  invoice_date: Date;
  system_entry_date: Date;
  customer_tax_id: string | null;
  net_total: string;
  iva_total: string;
  gross_total: string;
  hash: string;
  signature: string | null;
  signature_key_version: number | null;
  status: string;
  reference: string | null;
}

interface InvoiceItemRow {
  invoice_id: string;
  product_code: string;
  description: string;
  quantity: string;
  unit_price: string;
  iva_code: IvaCode;
  iva_rate: string;
  discount_rate: string;
  net_amount: string;
  iva_amount: string;
  gross_amount: string;
  exemption_reason: string | null;
  exemption_code: string | null;
}

@Injectable()
export class SaftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agtConfig: AgtConfigService,
  ) {}

  /**
   * Gera o ficheiro SAF-T (Angola) mensal do tenant (§7.2) escrevendo-o POR PARTES
   * em `write` (ex.: a resposta HTTP), com memória constante.
   */
  async writeMonth(
    tenantId: string,
    schema: string,
    year: number,
    month: number,
    write: (chunk: string) => void | Promise<void>,
  ): Promise<void> {
    if (month < 1 || month > 12) {
      throw new BadRequestException('Mês inválido (1-12)');
    }

    const company = await this.prisma.company.findUnique({ where: { id: tenantId } });
    if (!company) {
      throw new NotFoundException('Empresa não encontrada');
    }

    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0); // último dia do mês
    const end = `${year}-${String(month).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

    // Morada da sede (site_settings) — o CompanyAddress é obrigatório no XSD.
    const identity = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ address: string | null }[]>(
        Prisma.sql`SELECT address FROM site_settings LIMIT 1`,
      ),
    ).catch(() => [] as { address: string | null }[]);

    // Clientes com NIF no período — nomes reais para o MasterFiles/Customer.
    const custRows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ tax_id: string; name: string; address: string | null }[]>(
        Prisma.sql`SELECT DISTINCT c.tax_id, c.name, c.address
                   FROM customers c
                   WHERE c.tax_id IS NOT NULL AND c.tax_id <> ''
                     AND EXISTS (SELECT 1 FROM invoices i
                                 WHERE i.customer_tax_id = c.tax_id
                                   AND i.invoice_date >= ${start}::date AND i.invoice_date <= ${end}::date)`,
      ),
    ).catch(() => [] as { tax_id: string; name: string; address: string | null }[]);

    // Totais e tabelas mestras calculados na BD (não em memória): com milhões de
    // documentos/mês o ficheiro inteiro numa string esgotava a memória, e a lista
    // de ids numa só consulta rebentava acima de ~32 000 faturas (limite de
    // parâmetros do Postgres). Os documentos seguem por LOTES (ver iterateDocuments).
    const agg = await this.prisma.runInTenant(schema, async (tx) => {
      const tot = await tx.$queryRaw<{ n: number; debit: string | null; credit: string | null }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS n,
               SUM(net_total) FILTER (WHERE status <> 'A' AND doc_type = 'NC') AS debit,
               SUM(net_total) FILTER (WHERE status <> 'A' AND doc_type <> 'NC') AS credit
        FROM invoices WHERE invoice_date >= ${start}::date AND invoice_date <= ${end}::date`);
      const taxIds = await tx.$queryRaw<{ t: string | null }[]>(Prisma.sql`
        SELECT DISTINCT customer_tax_id AS t FROM invoices
        WHERE invoice_date >= ${start}::date AND invoice_date <= ${end}::date`);
      const prods = await tx.$queryRaw<{ code: string; description: string }[]>(Prisma.sql`
        SELECT DISTINCT ON (ii.product_code) ii.product_code AS code, ii.description
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        WHERE i.invoice_date >= ${start}::date AND i.invoice_date <= ${end}::date
        ORDER BY ii.product_code, i.doc_type, i.series, i.year, i.sequence, ii.line_number`);
      const taxes = await tx.$queryRaw<{ code: IvaCode; rate: string }[]>(Prisma.sql`
        SELECT DISTINCT ON (ii.iva_code) ii.iva_code AS code, ii.iva_rate AS rate
        FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        WHERE i.invoice_date >= ${start}::date AND i.invoice_date <= ${end}::date
        ORDER BY ii.iva_code, i.doc_type DESC, i.series DESC, i.year DESC, i.sequence DESC`);
      return { tot: tot[0], taxIds, prods, taxes };
    });

    const software = await this.agtConfig.getSaftSoftware();
    await writeSaftXml(write, {
      company: {
        taxRegistrationNumber: company.nif,
        companyName: company.name,
        fiscalYear: year,
        startDate: start,
        endDate: end,
        addressDetail: identity[0]?.address ?? undefined,
      },
      customers: custRows.map((c) => ({
        taxId: c.tax_id,
        name: c.name,
        addressDetail: c.address ?? undefined,
      })),
      referencedCustomerTaxIds: agg.taxIds.map((r) => r.t),
      products: new Map(agg.prods.map((p) => [p.code, p.description])),
      taxes: new Map(agg.taxes.map((t) => [t.code, Number(t.rate)])),
      numberOfEntries: agg.tot?.n ?? 0,
      totalDebit: Number(agg.tot?.debit ?? 0),
      totalCredit: Number(agg.tot?.credit ?? 0),
      software,
      documents: this.iterateDocuments(schema, start, end),
    });
  }

  /** Versão em string (testes / períodos pequenos): junta as partes. */
  async exportMonth(tenantId: string, schema: string, year: number, month: number): Promise<string> {
    let out = '';
    await this.writeMonth(tenantId, schema, year, month, (c) => { out += c; });
    return out;
  }

  /**
   * Documentos do período por LOTES de 1000 (paginação por chave — série/ano/nº),
   * com as linhas de cada lote numa só consulta. Memória constante seja qual for
   * o volume do mês. Ordem igual à do SAF-T anterior (tipo, série, ano, nº).
   */
  private async *iterateDocuments(schema: string, start: string, end: string): AsyncGenerator<FiscalDocument> {
    const LOTE = 1000;
    type Cursor = { doc_type: string; series: string; year: number; sequence: number };
    type Header = InvoiceHeaderRow & { series: string; year: number; sequence: number };
    let after: Cursor | null = null;
    for (;;) {
      const cursor: Cursor | null = after;
      const page: { headers: Header[]; items: InvoiceItemRow[] } = await this.prisma.runInTenant(schema, async (tx) => {
        const headers: Header[] = await tx.$queryRaw<Header[]>(
          // SAF-T AGT inclui TODOS os documentos do período: válidos (N), anulados
          // (A, com estado) e notas de crédito (NC). Anular nada some — só muda de estado.
          Prisma.sql`SELECT i.id, i.number, i.doc_type, i.series, i.year, i.sequence, i.invoice_date, i.system_entry_date,
                            i.customer_tax_id, i.net_total, i.iva_total, i.gross_total, i.hash, i.signature,
                            i.signature_key_version,
                            i.status, (SELECT s.number FROM invoices s WHERE s.id = i.source_invoice_id) AS reference
                     FROM invoices i
                     WHERE i.invoice_date >= ${start}::date AND i.invoice_date <= ${end}::date
                       ${cursor ? Prisma.sql`AND (i.doc_type, i.series, i.year, i.sequence) > (${cursor.doc_type}, ${cursor.series}, ${cursor.year}, ${cursor.sequence})` : Prisma.empty}
                     ORDER BY i.doc_type, i.series, i.year, i.sequence
                     LIMIT ${LOTE}`,
        );
        if (headers.length === 0) return { headers, items: [] as InvoiceItemRow[] };
        const items = await tx.$queryRaw<InvoiceItemRow[]>(
          Prisma.sql`SELECT invoice_id, product_code, description, quantity, unit_price,
                            iva_code, iva_rate, discount_rate, net_amount, iva_amount,
                            gross_amount, exemption_reason, exemption_code
                     FROM invoice_items
                     WHERE invoice_id = ANY(ARRAY[${Prisma.join(headers.map((h) => h.id))}]::uuid[])
                     ORDER BY invoice_id, line_number`,
        );
        return { headers, items };
      });
      if (page.headers.length === 0) return;
      const itemsByInvoice = new Map<string, InvoiceItemRow[]>();
      for (const it of page.items) {
        const list = itemsByInvoice.get(it.invoice_id) ?? [];
        list.push(it);
        itemsByInvoice.set(it.invoice_id, list);
      }
      for (const h of page.headers) yield toFiscalDocument(h, itemsByInvoice.get(h.id) ?? []);
      const last: Header = page.headers[page.headers.length - 1];
      after = { doc_type: last.doc_type, series: last.series, year: Number(last.year), sequence: Number(last.sequence) };
      if (page.headers.length < LOTE) return;
    }
  }
}

function toFiscalDocument(h: InvoiceHeaderRow, items: InvoiceItemRow[]): FiscalDocument {
  return {
    type: h.doc_type,
    number: h.number,
    status: h.status,
    reference: h.reference ?? undefined,
    invoiceDate: h.invoice_date.toISOString().slice(0, 10),
    systemEntryDate: h.system_entry_date.toISOString(),
    customerTaxId: h.customer_tax_id ?? undefined,
    // No SAF-T o campo Hash leva a assinatura digital (se existir) ou o hash
    // encadeado; o HashControl leva a versão da chave que assinou.
    hash: h.hash,
    signature: h.signature ?? undefined,
    signatureKeyVersion: h.signature_key_version != null ? Number(h.signature_key_version) : undefined,
    lines: items.map<InvoiceLineComputed>((it) => ({
      productCode: it.product_code,
      description: it.description,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unit_price),
      ivaCode: it.iva_code,
      ivaRate: Number(it.iva_rate),
      discountRate: Number(it.discount_rate),
      netAmount: Number(it.net_amount),
      ivaAmount: Number(it.iva_amount),
      grossAmount: Number(it.gross_amount),
      exemptionReason: it.exemption_reason ?? undefined,
      exemptionCode: it.exemption_code ?? undefined,
    })),
    totals: {
      netTotal: Number(h.net_total),
      ivaTotal: Number(h.iva_total),
      grossTotal: Number(h.gross_total),
      byTaxCode: [],
    },
  };
}
