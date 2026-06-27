import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DocumentType, IvaCode, round2 } from '@nexus/agt-xml';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceService, type EmitLineInput } from '../pos/invoice.service';

const IVA_RATE: Record<string, number> = { NOR: 14, INT: 7, RED: 5, ISE: 0, NS: 0 };
const STATUSES = ['OPEN', 'QUOTED', 'APPROVED', 'IN_PROGRESS', 'READY', 'DELIVERED', 'CANCELLED'];

/** Ordens de Serviço (mecânica, assistência técnica, recauchutagem…). */
@Injectable()
export class ServiceOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoiceService,
  ) {}

  list(schema: string, status?: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(status && STATUSES.includes(status)
        ? Prisma.sql`SELECT id, number, customer_name, equipment_label, status, total, assigned_to, source, created_at
                     FROM service_orders WHERE status = ${status} ORDER BY (source = 'ONLINE' AND status = 'OPEN') DESC, created_at DESC LIMIT 300`
        : Prisma.sql`SELECT id, number, customer_name, equipment_label, status, total, assigned_to, source, created_at
                     FROM service_orders ORDER BY (source = 'ONLINE' AND status = 'OPEN') DESC, created_at DESC LIMIT 300`),
    );
  }

  async create(
    schema: string,
    opener: { id: string | null; name: string },
    dto: { customerName?: string; customerPhone?: string; equipmentType?: string; equipmentLabel?: string; equipmentRef?: string; problem?: string; assignedTo?: string; source?: string },
  ) {
    const source = dto.source === 'ONLINE' ? 'ONLINE' : 'MANUAL';
    return this.prisma.runInTenant(schema, async (tx) => {
      const year = new Date().getFullYear();
      const cnt = await tx.$queryRaw<{ n: number }[]>(
        Prisma.sql`SELECT COUNT(*)::int AS n FROM service_orders WHERE date_part('year', created_at) = ${year}`);
      const number = `OS/${year}/${String((cnt[0]?.n ?? 0) + 1).padStart(4, '0')}`;
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO service_orders (number, customer_name, customer_phone, equipment_type, equipment_label, equipment_ref, problem, assigned_to, opened_by, opened_by_name, source)
        VALUES (${number}, ${dto.customerName?.trim() || null}, ${dto.customerPhone?.trim() || null},
                ${dto.equipmentType || null}, ${dto.equipmentLabel?.trim() || null}, ${dto.equipmentRef?.trim() || null},
                ${dto.problem?.trim() || null}, ${dto.assignedTo?.trim() || null}, ${opener.id}::uuid, ${opener.name}, ${source})
        RETURNING id`);
      return rows[0];
    });
  }

  /** Nº de ordens de serviço vindas da LOJA ONLINE ainda por tratar (status OPEN). */
  async pendingOnline(schema: string): Promise<number> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM service_orders WHERE source = 'ONLINE' AND status = 'OPEN'`));
    return rows[0]?.n ?? 0;
  }

  async get(schema: string, id: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const o = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT * FROM service_orders WHERE id = ${id}::uuid`);
      if (!o[0]) throw new NotFoundException('Ordem de serviço não encontrada.');
      const items = await tx.$queryRaw(Prisma.sql`SELECT id, kind, product_code, description, unit_price, quantity, created_at
        FROM service_order_items WHERE order_id = ${id}::uuid ORDER BY created_at`);
      return { order: o[0], items };
    });
  }

  /**
   * Fatura a OS (documento fiscal AGT) e marca-a ENTREGUE. As peças com código
   * de produto saem como linhas de produto (baixam stock); a mão-de-obra/serviços
   * saem como linhas LIVRES (o preço guardado tem IVA incluído → converte p/ líquido).
   */
  async invoice(schema: string, orderId: string, opener: { id: string | null; name: string }) {
    const detail = await this.get(schema, orderId);
    const o = detail.order as Record<string, unknown>;
    if (o.invoice_id) throw new BadRequestException('Esta ordem de serviço já foi faturada.');
    const items = detail.items as { kind: string; product_code: string | null; description: string; unit_price: string; quantity: string }[];
    if (!items.length) throw new BadRequestException('A OS não tem itens para faturar.');
    const lines: EmitLineInput[] = items.map((it) => {
      if (it.kind === 'PART' && it.product_code) {
        return { productCode: it.product_code, quantity: Number(it.quantity) };
      }
      const net = round2(Number(it.unit_price) / (1 + IVA_RATE.NOR / 100)); // preço guardado é c/ IVA
      return { description: it.description, unitPrice: net, ivaCode: IvaCode.NOR, quantity: Number(it.quantity) };
    });
    const inv = await this.invoices.emit(schema, {
      docType: DocumentType.FT, series: 'A',
      customerId: (o.customer_id as string) ?? null,
      cashierId: opener.id, cashierName: opener.name,
      paymentType: 'CASH', lines,
    });
    await this.prisma.runInTenant(schema, (tx) => tx.$executeRaw(Prisma.sql`
      UPDATE service_orders SET invoice_id = ${inv.id}::uuid, status = 'DELIVERED', delivered_at = now(), updated_at = now()
      WHERE id = ${orderId}::uuid`));
    return { invoiceId: inv.id, invoiceNumber: inv.number };
  }

  private async recompute(tx: Prisma.TransactionClient, id: string) {
    await tx.$executeRaw(Prisma.sql`UPDATE service_orders SET total = COALESCE(
      (SELECT SUM(unit_price * quantity) FROM service_order_items WHERE order_id = ${id}::uuid), 0), updated_at = now()
      WHERE id = ${id}::uuid`);
  }

  async addItem(
    schema: string,
    orderId: string,
    dto: { kind?: string; productCode?: string; description?: string; unitPrice?: number; quantity?: number },
  ) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const ord = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status FROM service_orders WHERE id = ${orderId}::uuid`);
      if (!ord[0]) throw new NotFoundException('OS não encontrada.');
      const qty = dto.quantity && dto.quantity > 0 ? dto.quantity : 1;
      let kind = (dto.kind || 'SERVICE').toUpperCase();
      let description = dto.description?.trim() || '';
      let price = dto.unitPrice ?? 0;
      let productId: string | null = null;
      let productCode: string | null = null;
      if (dto.productCode) {
        // Peça do stock: busca preço c/ IVA e descrição do produto.
        const p = await tx.$queryRaw<{ id: string; name: string; unit_price: string; iva_code: string }[]>(
          Prisma.sql`SELECT id, name, unit_price, iva_code FROM products WHERE code = ${dto.productCode} AND is_active = TRUE LIMIT 1`);
        if (!p[0]) throw new NotFoundException('Peça/produto não encontrado.');
        productId = p[0].id; productCode = dto.productCode; kind = 'PART';
        description = description || p[0].name;
        price = Math.round(Number(p[0].unit_price) * (1 + (IVA_RATE[p[0].iva_code] ?? 14) / 100) * 100) / 100;
      }
      if (!description) throw new BadRequestException('Indique a descrição do item.');
      await tx.$executeRaw(Prisma.sql`INSERT INTO service_order_items (order_id, kind, product_id, product_code, description, unit_price, quantity)
        VALUES (${orderId}::uuid, ${kind}, ${productId}::uuid, ${productCode}, ${description}, ${price}, ${qty})`);
      await this.recompute(tx, orderId);
      return { ok: true };
    });
  }

  async removeItem(schema: string, itemId: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const it = await tx.$queryRaw<{ order_id: string }[]>(Prisma.sql`SELECT order_id FROM service_order_items WHERE id = ${itemId}::uuid`);
      if (!it[0]) return { ok: true };
      await tx.$executeRaw(Prisma.sql`DELETE FROM service_order_items WHERE id = ${itemId}::uuid`);
      await this.recompute(tx, it[0].order_id);
      return { ok: true };
    });
  }

  async setStatus(schema: string, id: string, status: string) {
    if (!STATUSES.includes(status)) throw new BadRequestException('Estado inválido.');
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE service_orders SET status = ${status}, updated_at = now(),
        delivered_at = CASE WHEN ${status} = 'DELIVERED' THEN now() ELSE delivered_at END WHERE id = ${id}::uuid`));
    return { ok: true };
  }

  async update(schema: string, id: string, dto: { diagnosis?: string; assignedTo?: string; notes?: string }) {
    const sets: Prisma.Sql[] = [];
    if (dto.diagnosis !== undefined) sets.push(Prisma.sql`diagnosis = ${dto.diagnosis}`);
    if (dto.assignedTo !== undefined) sets.push(Prisma.sql`assigned_to = ${dto.assignedTo}`);
    if (dto.notes !== undefined) sets.push(Prisma.sql`notes = ${dto.notes}`);
    if (!sets.length) return { ok: true };
    sets.push(Prisma.sql`updated_at = now()`);
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE service_orders SET ${Prisma.join(sets, ', ')} WHERE id = ${id}::uuid`));
    return { ok: true };
  }
}
