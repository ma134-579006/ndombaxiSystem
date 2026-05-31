import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildSaftXml,
  DocumentType,
  FiscalDocument,
  InvoiceLineComputed,
  IvaCode,
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

  /** Gera o ficheiro SAF-T (Angola) mensal do tenant para submissão à AGT (§7.2). */
  async exportMonth(
    tenantId: string,
    schema: string,
    year: number,
    month: number,
  ): Promise<string> {
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

    const documents = await this.prisma.runInTenant(schema, async (tx) => {
      const headers = await tx.$queryRaw<InvoiceHeaderRow[]>(
        Prisma.sql`SELECT id, number, doc_type, invoice_date, system_entry_date,
                          customer_tax_id, net_total, iva_total, gross_total, hash, signature
                   FROM invoices
                   WHERE invoice_date >= ${start}::date AND invoice_date <= ${end}::date
                     AND status = 'N'
                   ORDER BY doc_type, series, year, sequence`,
      );
      if (headers.length === 0) return [] as FiscalDocument[];

      const ids = headers.map((h) => h.id);
      const items = await tx.$queryRaw<InvoiceItemRow[]>(
        Prisma.sql`SELECT invoice_id, product_code, description, quantity, unit_price,
                          iva_code, iva_rate, discount_rate, net_amount, iva_amount,
                          gross_amount, exemption_reason, exemption_code
                   FROM invoice_items
                   WHERE invoice_id::text IN (${Prisma.join(ids)})
                   ORDER BY invoice_id, line_number`,
      );

      const itemsByInvoice = new Map<string, InvoiceItemRow[]>();
      for (const it of items) {
        const list = itemsByInvoice.get(it.invoice_id) ?? [];
        list.push(it);
        itemsByInvoice.set(it.invoice_id, list);
      }

      return headers.map<FiscalDocument>((h) => ({
        type: h.doc_type,
        number: h.number,
        invoiceDate: h.invoice_date.toISOString().slice(0, 10),
        systemEntryDate: h.system_entry_date.toISOString(),
        customerTaxId: h.customer_tax_id ?? undefined,
        // No SAF-T o campo Hash leva a assinatura digital (se existir) ou o hash encadeado.
        hash: h.signature ?? h.hash,
        lines: (itemsByInvoice.get(h.id) ?? []).map<InvoiceLineComputed>((it) => ({
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
      }));
    });

    const software = await this.agtConfig.getSaftSoftware();
    return buildSaftXml({
      company: {
        taxRegistrationNumber: company.nif,
        companyName: company.name,
        fiscalYear: year,
        startDate: start,
        endDate: end,
      },
      software,
      documents,
    });
  }
}
