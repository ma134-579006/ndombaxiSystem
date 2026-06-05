import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { computeInvoice, InvoiceLineInput, IvaCode, requiresExemptionReason, resolveRate, round2 } from '@nexus/agt-xml';
import { allocateDocumentNumber, formatCounterNumber } from '../common/document-counter';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutDto } from './dto/checkout.dto';

/** Motivo de isenção por omissão p/ IVA que o exige (igual ao do POS). */
const DEFAULT_EXEMPTION_REASON: Partial<Record<IvaCode, string>> = {
  [IvaCode.ISE]: 'Isento de IVA',
  [IvaCode.OUT]: 'Não sujeito a IVA',
};

interface CatalogRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  iva_code: IvaCode;
  exemption_reason: string | null;
  exemption_code: string | null;
  unit_price: string;
  stock_qty: string;
  image_url: string | null;
  gallery: unknown;
}

export interface CatalogProduct {
  code: string;
  name: string;
  description: string | null;
  ivaCode: IvaCode;
  netPrice: number;
  grossPrice: number;
  inStock: boolean;
  imageUrl: string | null;
  gallery: string[];
}

@Injectable()
export class StorefrontService {
  constructor(private readonly prisma: PrismaService) {}

  /** Catálogo público: produtos activos e visíveis online, com preço bruto (IVA incluído). */
  async catalog(schema: string): Promise<CatalogProduct[]> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<CatalogRow[]>(
        Prisma.sql`SELECT id, code, name, description, iva_code, unit_price, stock_qty,
                          image_url, gallery
                   FROM products
                   WHERE is_active = TRUE AND show_online = TRUE
                   ORDER BY name`,
      ),
    );
    return rows.map((r) => {
      const netPrice = Number(r.unit_price);
      const rate = resolveRate(r.iva_code);
      return {
        code: r.code,
        name: r.name,
        description: r.description,
        ivaCode: r.iva_code,
        netPrice,
        grossPrice: round2(netPrice * (1 + rate / 100)),
        inStock: Number(r.stock_qty) > 0,
        imageUrl: r.image_url,
        gallery: Array.isArray(r.gallery) ? (r.gallery as string[]) : [],
      };
    });
  }

  /** Cria uma encomenda online em estado PENDING (sem emitir factura ainda). */
  async checkout(schema: string, dto: CheckoutDto): Promise<{ id: string; orderNumber: string; grossTotal: number }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const codes = dto.lines.map((l) => l.productCode);
      const products = await tx.$queryRaw<CatalogRow[]>(
        Prisma.sql`SELECT id, code, name, description, iva_code, exemption_reason, exemption_code, unit_price, stock_qty
                   FROM products WHERE code IN (${Prisma.join(codes)}) AND is_active = TRUE`,
      );
      const byCode = new Map(products.map((p) => [p.code, p]));

      const lineInputs: InvoiceLineInput[] = dto.lines.map((l) => {
        const p = byCode.get(l.productCode);
        if (!p) throw new BadRequestException(`Produto indisponível: ${l.productCode}`);
        // IVA isento/não-sujeito exige motivo (senão computeInvoice rebenta).
        const exemptionReason = requiresExemptionReason(p.iva_code)
          ? (p.exemption_reason?.trim() || DEFAULT_EXEMPTION_REASON[p.iva_code] || 'Isento')
          : undefined;
        return {
          productCode: l.productCode,
          description: p.name,
          quantity: l.quantity,
          unitPrice: Number(p.unit_price),
          ivaCode: p.iva_code,
          exemptionReason,
          exemptionCode: p.exemption_code ?? undefined,
        };
      });
      const { lines, totals } = computeInvoice(lineInputs);

      const year = new Date().getFullYear();
      // Numeração atómica (sem race): contador por (kind, year).
      const sequence = await allocateDocumentNumber(tx, 'WEB', year);
      const orderNumber = formatCounterNumber('WEB', year, sequence);

      const orderRows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO web_orders
            (order_number, customer_name, customer_email, customer_phone, customer_tax_id,
             shipping_address, province, municipality, neighborhood, payment_method,
             status, net_total, iva_total, gross_total)
          VALUES (${orderNumber}, ${dto.customerName}, ${dto.customerEmail ?? null},
                  ${dto.customerPhone ?? null}, ${dto.customerTaxId ?? null},
                  ${dto.shippingAddress ?? null}, ${dto.province}, ${dto.municipality},
                  ${dto.neighborhood}, ${dto.paymentMethod ?? null}, 'PENDING',
                  ${totals.netTotal}, ${totals.ivaTotal}, ${totals.grossTotal})
          RETURNING id`,
      );
      const orderId = orderRows[0].id;

      let lineNumber = 0;
      for (const line of lines) {
        lineNumber += 1;
        const p = byCode.get(line.productCode)!;
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO web_order_items
              (order_id, line_number, product_id, product_code, description, quantity,
               unit_price, iva_code, iva_rate, net_amount, iva_amount, gross_amount)
            VALUES (${orderId}::uuid, ${lineNumber}, ${p.id}::uuid, ${line.productCode},
                    ${line.description}, ${line.quantity}, ${line.unitPrice}, ${line.ivaCode},
                    ${line.ivaRate}, ${line.netAmount}, ${line.ivaAmount}, ${line.grossAmount})`,
        );
      }

      return { id: orderId, orderNumber, grossTotal: totals.grossTotal };
    });
  }
}
