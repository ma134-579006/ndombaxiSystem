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

  /**
   * CENTRO DE COMANDO dos Serviços (mesma engenharia do restaurante/hotel/
   * clínica): pipeline da oficina, urgências e vendas do dia — só LEITURA.
   */
  async dashboard(schema: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const reg = await tx.$queryRaw<{ r: string | null }[]>(
        Prisma.sql`SELECT to_regclass('service_orders')::text AS r`);
      const hasSo = !!reg[0]?.r;

      // Pipeline: quantas OS e quanto valor há em cada fase do funil.
      const pipeline = hasSo
        ? await tx.$queryRaw<{ status: string; n: number; value: number }[]>(Prisma.sql`
            SELECT status, COUNT(*)::int AS n, COALESCE(SUM(total),0)::float8 AS value
            FROM service_orders
            WHERE status IN ('OPEN','QUOTED','APPROVED','IN_PROGRESS','READY')
            GROUP BY status`)
        : [];
      const byStatus = new Map(pipeline.map((p) => [p.status, p]));
      const stage = (s: string) => ({
        count: byStatus.get(s)?.n ?? 0,
        value: Math.round((byStatus.get(s)?.value ?? 0) * 100) / 100,
      });

      // Pedidos ONLINE por aceitar + OS em curso há mais tempo (atraso).
      const online = hasSo
        ? await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
            SELECT COUNT(*)::int AS n FROM service_orders WHERE source = 'ONLINE' AND status = 'OPEN'`)
        : [{ n: 0 }];
      const oldest = hasSo
        ? await tx.$queryRaw<{ days: number; number: string }[]>(Prisma.sql`
            SELECT FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 86400)::int AS days, number
            FROM service_orders WHERE status = 'IN_PROGRESS' ORDER BY created_at LIMIT 1`)
        : [];

      // Prontas por ENTREGAR (o dinheiro parado na prateleira).
      const ready = hasSo
        ? await tx.$queryRaw<{ id: string; number: string; customer_name: string | null; equipment_label: string | null; total: string }[]>(Prisma.sql`
            SELECT id, number, customer_name, equipment_label, total
            FROM service_orders WHERE status = 'READY' ORDER BY updated_at DESC LIMIT 6`)
        : [];

      // Equipamentos ativos em carteira.
      const regEq = await tx.$queryRaw<{ r: string | null }[]>(
        Prisma.sql`SELECT to_regclass('service_equipments')::text AS r`);
      const equipments = regEq[0]?.r
        ? await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
            SELECT COUNT(*)::int AS n FROM service_equipments WHERE is_active = TRUE`)
        : [{ n: 0 }];

      // Vendas de HOJE por canal (faturas FT/FS válidas) — igual ao restaurante.
      const regInv = await tx.$queryRaw<{ r: string | null }[]>(
        Prisma.sql`SELECT to_regclass('invoices')::text AS r`);
      const regWeb = await tx.$queryRaw<{ r: string | null }[]>(
        Prisma.sql`SELECT to_regclass('web_orders')::text AS r`);
      const onlineExpr = regWeb[0]?.r
        ? Prisma.sql`COALESCE(SUM(gross_total) FILTER (WHERE id IN (SELECT invoice_id FROM web_orders WHERE invoice_id IS NOT NULL)), 0)::float8`
        : Prisma.sql`0::float8`;
      const sales = regInv[0]?.r
        ? await tx.$queryRaw<{ total: number; online: number; invoices: number }[]>(Prisma.sql`
            SELECT COALESCE(SUM(gross_total), 0)::float8 AS total,
                   ${onlineExpr} AS online,
                   COUNT(*)::int AS invoices
            FROM invoices
            WHERE invoice_date = CURRENT_DATE AND status = 'N' AND doc_type IN ('FT','FS')`)
        : [{ total: 0, online: 0, invoices: 0 }];
      const sl = sales[0] ?? { total: 0, online: 0, invoices: 0 };
      const onlineSales = Math.round(sl.online);

      return {
        pipeline: {
          open: stage('OPEN'), quoted: stage('QUOTED'), approved: stage('APPROVED'),
          inProgress: stage('IN_PROGRESS'), ready: stage('READY'),
        },
        onlinePending: online[0]?.n ?? 0,
        oldestInProgress: oldest[0] ? { days: oldest[0].days, number: oldest[0].number } : null,
        readyToDeliver: ready.map((r) => ({
          id: r.id, number: r.number, customerName: r.customer_name,
          equipment: r.equipment_label, total: Number(r.total),
        })),
        equipments: equipments[0]?.n ?? 0,
        sales: {
          total: Math.round(sl.total), online: onlineSales,
          counter: Math.round(sl.total) - onlineSales, invoices: sl.invoices,
        },
      };
    });
  }

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
    dto: { customerId?: string; customerName?: string; customerPhone?: string; equipmentId?: string; equipmentType?: string; equipmentLabel?: string; equipmentRef?: string; problem?: string; assignedTo?: string; warrantyDays?: number; source?: string },
  ) {
    const source = dto.source === 'ONLINE' ? 'ONLINE' : 'MANUAL';
    const warranty = [0, 90, 180, 365].includes(dto.warrantyDays ?? 0) ? (dto.warrantyDays ?? 0) : 0;
    return this.prisma.runInTenant(schema, async (tx) => {
      // Se vier um equipamento registado, copia os dados (tipo/etiqueta/ref) e o cliente.
      let { equipmentType, equipmentLabel, equipmentRef, customerName, customerPhone } = dto;
      let customerId = dto.customerId ?? null;
      if (dto.equipmentId) {
        const eq = await tx.$queryRaw<{ kind: string; label: string; serial: string | null; plate: string | null; customer_id: string | null; customer_name: string | null }[]>(
          Prisma.sql`SELECT kind, label, serial, plate, customer_id, customer_name FROM service_equipments WHERE id = ${dto.equipmentId}::uuid`);
        if (eq[0]) {
          equipmentType = equipmentType || eq[0].kind;
          equipmentLabel = equipmentLabel || eq[0].label;
          equipmentRef = equipmentRef || eq[0].plate || eq[0].serial || undefined;
          customerId = customerId || eq[0].customer_id;
          customerName = customerName || eq[0].customer_name || undefined;
        }
      }
      const year = new Date().getFullYear();
      const cnt = await tx.$queryRaw<{ n: number }[]>(
        Prisma.sql`SELECT COUNT(*)::int AS n FROM service_orders WHERE date_part('year', created_at) = ${year}`);
      const number = `OS/${year}/${String((cnt[0]?.n ?? 0) + 1).padStart(4, '0')}`;
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO service_orders (number, customer_id, customer_name, customer_phone, equipment_id, equipment_type, equipment_label, equipment_ref, problem, assigned_to, warranty_days, opened_by, opened_by_name, source)
        VALUES (${number}, ${customerId}::uuid, ${customerName?.trim() || null}, ${customerPhone?.trim() || null},
                ${dto.equipmentId ?? null}::uuid, ${equipmentType || null}, ${equipmentLabel?.trim() || null}, ${equipmentRef?.trim() || null},
                ${dto.problem?.trim() || null}, ${dto.assignedTo?.trim() || null}, ${warranty}, ${opener.id}::uuid, ${opener.name}, ${source})
        RETURNING id`);
      return rows[0];
    });
  }

  // ── Equipamentos / viaturas (registo reutilizável por cliente) ──
  listEquipments(schema: string, customerId?: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(customerId
        ? Prisma.sql`SELECT id, customer_id, customer_name, kind, label, brand, model, serial, plate, vin, color, year, km, next_service_km, notes
                     FROM service_equipments WHERE is_active = TRUE AND customer_id = ${customerId}::uuid ORDER BY label`
        : Prisma.sql`SELECT id, customer_id, customer_name, kind, label, brand, model, serial, plate, vin, color, year, km, next_service_km, notes
                     FROM service_equipments WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 500`));
  }

  async createEquipment(schema: string, dto: { customerId?: string; customerName?: string; kind?: string; label: string; brand?: string; model?: string; serial?: string; plate?: string; vin?: string; color?: string; year?: number; km?: number; nextServiceKm?: number; notes?: string }) {
    if (!dto.label?.trim()) throw new BadRequestException('Indique o equipamento.');
    const kind = ['VEHICLE', 'DEVICE', 'OTHER'].includes(dto.kind ?? '') ? dto.kind : 'DEVICE';
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO service_equipments (customer_id, customer_name, kind, label, brand, model, serial, plate, vin, color, year, km, next_service_km, notes)
        VALUES (${dto.customerId ?? null}::uuid, ${dto.customerName?.trim() || null}, ${kind}, ${dto.label.trim()},
                ${dto.brand?.trim() || null}, ${dto.model?.trim() || null}, ${dto.serial?.trim() || null}, ${dto.plate?.trim() || null},
                ${dto.vin?.trim() || null}, ${dto.color?.trim() || null}, ${dto.year ?? null}, ${dto.km ?? null}, ${dto.nextServiceKm ?? null}, ${dto.notes?.trim() || null})
        RETURNING id`));
  }

  async updateEquipment(schema: string, id: string, dto: { km?: number; nextServiceKm?: number; notes?: string }) {
    const sets: Prisma.Sql[] = [];
    if (dto.km !== undefined) sets.push(Prisma.sql`km = ${dto.km}`);
    if (dto.nextServiceKm !== undefined) sets.push(Prisma.sql`next_service_km = ${dto.nextServiceKm}`);
    if (dto.notes !== undefined) sets.push(Prisma.sql`notes = ${dto.notes}`);
    if (!sets.length) return { ok: true };
    sets.push(Prisma.sql`updated_at = now()`);
    await this.prisma.runInTenant(schema, (tx) => tx.$executeRaw(Prisma.sql`UPDATE service_equipments SET ${Prisma.join(sets, ', ')} WHERE id = ${id}::uuid`));
    return { ok: true };
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
      // Ao ENTREGAR: marca a data de entrega e calcula o fim da garantia
      // (entrega + warranty_days). Só define se houver garantia configurada.
      tx.$executeRaw(Prisma.sql`UPDATE service_orders SET status = ${status}, updated_at = now(),
        delivered_at = CASE WHEN ${status} = 'DELIVERED' THEN now() ELSE delivered_at END,
        warranty_until = CASE WHEN ${status} = 'DELIVERED' AND warranty_days > 0
                              THEN (now()::date + warranty_days) ELSE warranty_until END
        WHERE id = ${id}::uuid`));
    return { ok: true };
  }

  async update(schema: string, id: string, dto: { diagnosis?: string; assignedTo?: string; notes?: string; warrantyDays?: number }) {
    const sets: Prisma.Sql[] = [];
    if (dto.diagnosis !== undefined) sets.push(Prisma.sql`diagnosis = ${dto.diagnosis}`);
    if (dto.assignedTo !== undefined) sets.push(Prisma.sql`assigned_to = ${dto.assignedTo}`);
    if (dto.notes !== undefined) sets.push(Prisma.sql`notes = ${dto.notes}`);
    if (dto.warrantyDays !== undefined && [0, 90, 180, 365].includes(dto.warrantyDays)) sets.push(Prisma.sql`warranty_days = ${dto.warrantyDays}`);
    if (!sets.length) return { ok: true };
    sets.push(Prisma.sql`updated_at = now()`);
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE service_orders SET ${Prisma.join(sets, ', ')} WHERE id = ${id}::uuid`));
    return { ok: true };
  }
}
