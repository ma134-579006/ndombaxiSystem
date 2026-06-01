import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { computeInvoice, InvoiceLineInput, IvaCode } from '@nexus/agt-xml';
import { allocateDocumentNumber, formatCounterNumber } from '../common/document-counter';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from './stock.service';
import { TenantAuditService } from '../cashbox/tenant-audit.service';

export interface CreatePoInput {
  supplierId: string;
  warehouseId: string;
  expectedDate?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  lines: { productCode: string; quantity: number; unitCost: number }[];
}

interface ProductRow {
  id: string;
  code: string;
  name: string;
  iva_code: IvaCode;
}

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: TenantAuditService,
  ) {}

  /** Cria uma encomenda de compra em estado DRAFT, com totais (IVA incluído). */
  async create(schema: string, input: CreatePoInput): Promise<{ id: string; number: string }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const codes = input.lines.map((l) => l.productCode);
      const products = await tx.$queryRaw<ProductRow[]>(
        Prisma.sql`SELECT id, code, name, iva_code FROM products
                   WHERE code IN (${Prisma.join(codes)}) AND is_active = TRUE`,
      );
      const byCode = new Map(products.map((p) => [p.code, p]));

      const lineInputs: InvoiceLineInput[] = input.lines.map((l) => {
        const p = byCode.get(l.productCode);
        if (!p) throw new BadRequestException(`Produto não encontrado: ${l.productCode}`);
        return {
          productCode: l.productCode,
          description: p.name,
          quantity: l.quantity,
          unitPrice: l.unitCost,
          ivaCode: p.iva_code,
        };
      });
      const { lines, totals } = computeInvoice(lineInputs);

      const year = new Date().getFullYear();
      // Numeração atómica (sem race): contador por (kind, year).
      const sequence = await allocateDocumentNumber(tx, 'PO', year);
      const number = formatCounterNumber('PO', year, sequence);

      const poRows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO purchase_orders
            (number, supplier_id, warehouse_id, status, expected_date, net_total, iva_total, gross_total, notes, created_by)
          VALUES (${number}, ${input.supplierId}::uuid, ${input.warehouseId}::uuid, 'DRAFT',
                  ${input.expectedDate ?? null}::date, ${totals.netTotal}, ${totals.ivaTotal},
                  ${totals.grossTotal}, ${input.notes ?? null}, ${input.createdBy ?? null}::uuid)
          RETURNING id`,
      );
      const poId = poRows[0].id;

      let lineNumber = 0;
      for (const line of lines) {
        lineNumber += 1;
        const p = byCode.get(line.productCode)!;
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO purchase_order_items
              (po_id, line_number, product_id, product_code, description, quantity, unit_cost,
               iva_code, iva_rate, net_amount, iva_amount, gross_amount)
            VALUES (${poId}::uuid, ${lineNumber}, ${p.id}::uuid, ${line.productCode}, ${line.description},
                    ${line.quantity}, ${line.unitPrice}, ${line.ivaCode}, ${line.ivaRate},
                    ${line.netAmount}, ${line.ivaAmount}, ${line.grossAmount})`,
        );
      }
      return { id: poId, number };
    });
  }

  /** Transição de estado DRAFT → CONFIRMED. */
  async confirm(schema: string, poId: string): Promise<void> {
    await this.prisma.runInTenant(schema, async (tx) => {
      const po = await this.lockPo(tx, poId);
      if (po.status !== 'DRAFT') {
        throw new BadRequestException(`Só é possível confirmar encomendas em DRAFT (estado: ${po.status})`);
      }
      await tx.$executeRaw(
        Prisma.sql`UPDATE purchase_orders SET status = 'CONFIRMED', updated_at = now()
                   WHERE id = ${poId}::uuid`,
      );
    });
  }

  /**
   * Receção total da encomenda: dá entrada em stock (movimentos IN) no armazém
   * da encomenda, marca as linhas como recebidas e passa a RECEIVED.
   */
  async receive(
    schema: string,
    poId: string,
    receivedBy?: string | null,
  ): Promise<{ received: number }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const po = await this.lockPo(tx, poId);
      if (po.status !== 'CONFIRMED') {
        throw new BadRequestException(`Só é possível rececionar encomendas CONFIRMED (estado: ${po.status})`);
      }
      const items = await tx.$queryRaw<
        { id: string; product_id: string | null; quantity: string; received_qty: string; unit_cost: string }[]
      >(
        Prisma.sql`SELECT id, product_id, quantity, received_qty, unit_cost
                   FROM purchase_order_items WHERE po_id = ${poId}::uuid ORDER BY line_number`,
      );

      let received = 0;
      for (const it of items) {
        const outstanding = Number(it.quantity) - Number(it.received_qty);
        if (outstanding <= 0 || !it.product_id) continue;
        await StockService.applyMovement(tx, {
          productId: it.product_id,
          warehouseId: po.warehouse_id,
          type: 'IN',
          quantity: outstanding,
          unitCost: Number(it.unit_cost),
          reference: po.number,
          referenceId: poId,
          createdBy: receivedBy ?? null,
        });
        await tx.$executeRaw(
          Prisma.sql`UPDATE purchase_order_items SET received_qty = quantity WHERE id = ${it.id}::uuid`,
        );
        received += 1;
      }

      await tx.$executeRaw(
        Prisma.sql`UPDATE purchase_orders SET status = 'RECEIVED', updated_at = now()
                   WHERE id = ${poId}::uuid`,
      );

      // Auditoria: entrada de stock (recepção de encomenda de compra).
      await this.audit.recordInTx(tx, {
        actorId: receivedBy ?? null,
        action: 'STOCK_IN',
        entity: 'purchase_order',
        entityId: poId,
        details: { number: po.number, linesReceived: received, warehouseId: po.warehouse_id },
      });

      return { received };
    });
  }

  list(schema: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT po.*, s.name AS supplier_name
                   FROM purchase_orders po
                   JOIN suppliers s ON s.id = po.supplier_id
                   ORDER BY po.created_at DESC`,
      ),
    );
  }

  private async lockPo(
    tx: Prisma.TransactionClient,
    poId: string,
  ): Promise<{ id: string; status: string; number: string; warehouse_id: string }> {
    const rows = await tx.$queryRaw<
      { id: string; status: string; number: string; warehouse_id: string }[]
    >(
      Prisma.sql`SELECT id, status, number, warehouse_id FROM purchase_orders
                 WHERE id = ${poId}::uuid FOR UPDATE`,
    );
    if (rows.length === 0) throw new NotFoundException('Encomenda não encontrada');
    return rows[0];
  }
}
