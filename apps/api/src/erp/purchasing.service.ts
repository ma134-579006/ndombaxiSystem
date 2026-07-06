import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { computeInvoice, InvoiceLineInput, IvaCode, requiresExemptionReason } from '@nexus/agt-xml';

/** Motivo de isenção por omissão p/ IVA que o exige (igual ao do POS/loja). */
const DEFAULT_EXEMPTION_REASON: Partial<Record<IvaCode, string>> = {
  [IvaCode.ISE]: 'Isento de IVA',
  [IvaCode.OUT]: 'Não sujeito a IVA',
};
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
  exemption_reason: string | null;
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
        Prisma.sql`SELECT id, code, name, iva_code, exemption_reason FROM products
                   WHERE code IN (${Prisma.join(codes)}) AND is_active = TRUE`,
      );
      const byCode = new Map(products.map((p) => [p.code, p]));

      const lineInputs: InvoiceLineInput[] = input.lines.map((l) => {
        const p = byCode.get(l.productCode);
        if (!p) throw new BadRequestException(`Produto não encontrado: ${l.productCode}`);
        const exemptionReason = requiresExemptionReason(p.iva_code)
          ? (p.exemption_reason?.trim() || DEFAULT_EXEMPTION_REASON[p.iva_code] || 'Isento')
          : undefined;
        return {
          productCode: l.productCode,
          description: p.name,
          quantity: l.quantity,
          unitPrice: l.unitCost,
          ivaCode: p.iva_code,
          exemptionReason,
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
        // CUSTO MÉDIO PONDERADO (CMP): a receção da compra tem de atualizar o
        // custo do produto tal como a entrada manual de stock — senão o CMV/lucro
        // ficam falsos (custo 0) e as fichas técnicas sem custo. Lê o saldo e o
        // custo ANTES do movimento (applyMovement altera products.stock_qty).
        const prodRows = await tx.$queryRaw<{ stock_qty: string; cost_price: string }[]>(
          Prisma.sql`SELECT stock_qty, cost_price FROM products WHERE id = ${it.product_id}::uuid FOR UPDATE`,
        );
        const oldQty = Number(prodRows[0]?.stock_qty ?? 0);
        const oldCost = Number(prodRows[0]?.cost_price ?? 0);
        const unitCost = Number(it.unit_cost);
        const newCost = oldQty > 0
          ? Math.round(((oldQty * oldCost + outstanding * unitCost) / (oldQty + outstanding)) * 100) / 100
          : unitCost; // sem stock anterior (ou negativo) → assume o custo da compra
        await StockService.applyMovement(tx, {
          productId: it.product_id,
          warehouseId: po.warehouse_id,
          type: 'IN',
          quantity: outstanding,
          unitCost,
          reference: po.number,
          referenceId: poId,
          createdBy: receivedBy ?? null,
        });
        await tx.$executeRaw(
          Prisma.sql`UPDATE products SET cost_price = ${newCost}, updated_at = now()
                     WHERE id = ${it.product_id}::uuid`,
        );
        await tx.$executeRaw(
          Prisma.sql`UPDATE purchase_order_items SET received_qty = quantity WHERE id = ${it.id}::uuid`,
        );
        received += 1;
      }

      // ENGENHARIA DE CUSTOS (automática, igual à entrada manual): os ingredientes
      // recebidos podem entrar em fichas técnicas — recalcula o custo dos pratos
      // que os usam (custo do prato = Σ qtd×custo dos ingredientes). No-op para
      // negócios sem receitas (afeta 0 linhas).
      const hasRecipes = await tx.$queryRaw<{ r: string | null }[]>(
        Prisma.sql`SELECT to_regclass('product_recipes')::text AS r`,
      );
      if (hasRecipes[0]?.r && received > 0) {
        const ids = items.filter((i) => i.product_id).map((i) => i.product_id as string);
        // Quebra/desperdício: custo real = qtd × (1+quebra/100) × custo (guarda
        // de coluna: pode ainda não existir em tenants antigos).
        const wc = await tx.$queryRaw<{ n: number }[]>(
          Prisma.sql`SELECT COUNT(*)::int AS n FROM information_schema.columns
                     WHERE table_schema = current_schema() AND table_name = 'product_recipes' AND column_name = 'waste_pct'`,
        );
        const wasteFactor = (wc[0]?.n ?? 0) > 0 ? Prisma.sql`(1 + COALESCE(r.waste_pct, 0) / 100)` : Prisma.sql`1`;
        await tx.$executeRaw(
          Prisma.sql`UPDATE products p SET
              cost_price = COALESCE((SELECT SUM(r.quantity * ${wasteFactor} * ing.cost_price)
                                     FROM product_recipes r JOIN products ing ON ing.id = r.ingredient_id
                                     WHERE r.product_id = p.id), 0),
              updated_at = now()
            WHERE p.id IN (SELECT product_id FROM product_recipes
                           WHERE ingredient_id = ANY(ARRAY[${Prisma.join(ids)}]::uuid[]))`,
        );
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
