import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DocumentType, IvaCode, round2 } from '@nexus/agt-xml';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceService, type EmitLineInput } from '../pos/invoice.service';

const IVA_RATE: Record<string, number> = { NOR: 14, INT: 7, RED: 5, ISE: 0, NS: 0 };
const RES_STATUS = ['BOOKED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'];
const nightsBetween = (ci: string, co: string): number => {
  const a = new Date(ci + 'T00:00:00'), b = new Date(co + 'T00:00:00');
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000));
};

/** Hotelaria — quartos, reservas e conta do hóspede (folio). */
@Injectable()
export class HotelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoiceService,
  ) {}

  // ── Quartos ────────────────────────────────────────────────
  listRooms(schema: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`SELECT id, code, name, room_type, category, floor, capacity, rate, photo_url, status, sort_order
        FROM hotel_rooms WHERE is_active = TRUE ORDER BY sort_order, code`));
  }

  async createRoom(schema: string, dto: { code?: string; name: string; roomType?: string; category?: string; floor?: string; capacity?: number; rate?: number; photoUrl?: string }) {
    if (!dto.name?.trim()) throw new BadRequestException('Indique o nome do quarto.');
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`INSERT INTO hotel_rooms (code, name, room_type, category, floor, capacity, rate, photo_url)
        VALUES (${dto.code?.trim() || dto.name.trim()}, ${dto.name.trim()}, ${dto.roomType?.trim() || null},
                ${dto.category?.trim() || null}, ${dto.floor?.trim() || null}, ${dto.capacity ?? 2}, ${dto.rate ?? 0}, ${dto.photoUrl || null})
        RETURNING id, code, name, room_type, category, floor, capacity, rate, photo_url, status, sort_order`));
  }

  /** Muda o estado físico do quarto (livre/reservado/ocupado/limpeza/manutenção/bloqueado). */
  async setRoomStatus(schema: string, id: string, status: string) {
    const ok = ['AVAILABLE', 'RESERVED', 'OCCUPIED', 'CLEANING', 'MAINTENANCE', 'BLOCKED'];
    if (!ok.includes(status)) throw new BadRequestException('Estado de quarto inválido.');
    await this.prisma.runInTenant(schema, (tx) => tx.$executeRaw(Prisma.sql`UPDATE hotel_rooms SET status = ${status} WHERE id = ${id}::uuid`));
    return { ok: true };
  }

  async removeRoom(schema: string, id: string) {
    await this.prisma.runInTenant(schema, (tx) => tx.$executeRaw(Prisma.sql`UPDATE hotel_rooms SET is_active = FALSE WHERE id = ${id}::uuid`));
    return { ok: true };
  }

  /** Mapa de quartos com a reserva ativa (CHECKED_IN) de cada um. */
  roomMap(schema: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT r.id, r.code, r.name, r.room_type, r.category, r.floor, r.capacity, r.rate, r.status,
          res.id AS reservation_id, res.guest_name, res.check_out, res.total AS res_total
        FROM hotel_rooms r
        LEFT JOIN LATERAL (
          SELECT id, guest_name, check_out, total FROM hotel_reservations
          WHERE room_id = r.id AND status = 'CHECKED_IN' ORDER BY check_in DESC LIMIT 1
        ) res ON TRUE
        WHERE r.is_active = TRUE ORDER BY r.sort_order, r.code`));
  }

  // ── Reservas ───────────────────────────────────────────────
  list(schema: string, status?: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(status && RES_STATUS.includes(status)
        ? Prisma.sql`SELECT id, number, room_name, guest_name, check_in, check_out, nights, status, total, source
                     FROM hotel_reservations WHERE status = ${status} ORDER BY (source = 'ONLINE' AND status = 'BOOKED') DESC, check_in DESC LIMIT 300`
        : Prisma.sql`SELECT id, number, room_name, guest_name, check_in, check_out, nights, status, total, source
                     FROM hotel_reservations ORDER BY (source = 'ONLINE' AND status = 'BOOKED') DESC, check_in DESC LIMIT 300`));
  }

  /** Nº de reservas vindas da LOJA ONLINE ainda por confirmar (status BOOKED). */
  async pendingOnline(schema: string): Promise<number> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM hotel_reservations WHERE source = 'ONLINE' AND status = 'BOOKED'`));
    return rows[0]?.n ?? 0;
  }

  /**
   * Quartos públicos (booking) para a loja. Se forem dadas datas, devolve só os
   * quartos LIVRES nesse período (sem reservas BOOKED/CHECKED_IN a sobrepor) e
   * exclui os bloqueados/manutenção. Sem datas, lista os ativos não bloqueados.
   */
  publicRooms(schema: string, checkIn?: string, checkOut?: string) {
    const validDates = checkIn && checkOut && /^\d{4}-\d{2}-\d{2}$/.test(checkIn) && /^\d{4}-\d{2}-\d{2}$/.test(checkOut) && checkOut > checkIn;
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(validDates
        ? Prisma.sql`SELECT id, code, name, room_type, category, floor, capacity, rate, photo_url
                     FROM hotel_rooms r
                     WHERE r.is_active = TRUE AND r.status NOT IN ('MAINTENANCE','BLOCKED')
                       AND NOT EXISTS (
                         SELECT 1 FROM hotel_reservations res
                         WHERE res.room_id = r.id AND res.status IN ('BOOKED','CHECKED_IN')
                           AND NOT (res.check_out <= ${checkIn}::date OR res.check_in >= ${checkOut}::date))
                     ORDER BY r.sort_order, r.code`
        : Prisma.sql`SELECT id, code, name, room_type, category, floor, capacity, rate, photo_url
                     FROM hotel_rooms WHERE is_active = TRUE AND status NOT IN ('MAINTENANCE','BLOCKED') ORDER BY sort_order, code`));
  }

  async create(schema: string, by: string | null, dto: { roomId: string; guestName?: string; guestPhone?: string; checkIn: string; checkOut: string; guests?: number; source?: string }) {
    const source = dto.source === 'ONLINE' ? 'ONLINE' : 'MANUAL';
    if (!dto.checkIn || !dto.checkOut) throw new BadRequestException('Indique as datas de entrada e saída.');
    const nights = nightsBetween(dto.checkIn, dto.checkOut);
    return this.prisma.runInTenant(schema, async (tx) => {
      const room = await tx.$queryRaw<{ name: string; rate: string }[]>(Prisma.sql`SELECT name, rate FROM hotel_rooms WHERE id = ${dto.roomId}::uuid`);
      if (!room[0]) throw new NotFoundException('Quarto não encontrado.');
      // Evita sobreposição de datas com reservas ativas no mesmo quarto.
      const clash = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM hotel_reservations WHERE room_id = ${dto.roomId}::uuid AND status IN ('BOOKED','CHECKED_IN')
          AND NOT (check_out <= ${dto.checkIn}::date OR check_in >= ${dto.checkOut}::date) LIMIT 1`);
      if (clash[0]) throw new BadRequestException('O quarto já tem reserva nessas datas.');
      const year = new Date().getFullYear();
      const cnt = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM hotel_reservations WHERE date_part('year', created_at) = ${year}`);
      const number = `RES/${year}/${String((cnt[0]?.n ?? 0) + 1).padStart(4, '0')}`;
      const rate = Number(room[0].rate);
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO hotel_reservations (number, room_id, room_name, guest_name, guest_phone, check_in, check_out, nights, rate, guests, total, created_by, source)
        VALUES (${number}, ${dto.roomId}::uuid, ${room[0].name}, ${dto.guestName?.trim() || null}, ${dto.guestPhone?.trim() || null},
                ${dto.checkIn}::date, ${dto.checkOut}::date, ${nights}, ${rate}, ${dto.guests ?? 1}, ${rate * nights}, ${by}::uuid, ${source})
        RETURNING id`);
      // Reserva criada → quarto fica RESERVADO (se estava livre).
      await tx.$executeRaw(Prisma.sql`UPDATE hotel_rooms SET status = 'RESERVED' WHERE id = ${dto.roomId}::uuid AND status = 'AVAILABLE'`);
      return rows[0];
    });
  }

  async get(schema: string, id: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const r = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT * FROM hotel_reservations WHERE id = ${id}::uuid`);
      if (!r[0]) throw new NotFoundException('Reserva não encontrada.');
      const folio = await tx.$queryRaw(Prisma.sql`SELECT id, product_code, description, unit_price, quantity, created_at
        FROM hotel_folio_items WHERE reservation_id = ${id}::uuid ORDER BY created_at`);
      return { reservation: r[0], folio };
    });
  }

  /**
   * Fatura a reserva (documento fiscal AGT) e faz check-out. A estadia e os
   * extras manuais saem como linhas LIVRES (preço c/ IVA → convertido p/ líquido);
   * os consumos com produto saem como linhas de produto (baixam stock).
   */
  async invoice(schema: string, reservationId: string, opener: { id: string | null; name: string }) {
    const detail = await this.get(schema, reservationId);
    const r = detail.reservation as Record<string, unknown>;
    if (r.invoice_id) throw new BadRequestException('Esta reserva já foi faturada.');
    const nights = Number(r.nights) || 1;
    const rateGross = Number(r.rate) || 0;
    const lines: EmitLineInput[] = [];
    if (rateGross > 0) {
      lines.push({
        description: `Estadia (${nights} noite(s)) - ${(r.room_name as string) ?? 'Quarto'}`,
        unitPrice: round2(rateGross / (1 + IVA_RATE.NOR / 100)), ivaCode: IvaCode.NOR, quantity: nights,
      });
    }
    const folio = detail.folio as { product_code: string | null; description: string; unit_price: string; quantity: string }[];
    for (const it of folio) {
      if (it.product_code) lines.push({ productCode: it.product_code, quantity: Number(it.quantity) });
      else lines.push({ description: it.description, unitPrice: round2(Number(it.unit_price) / (1 + IVA_RATE.NOR / 100)), ivaCode: IvaCode.NOR, quantity: Number(it.quantity) });
    }
    if (!lines.length) throw new BadRequestException('A reserva não tem valores para faturar.');
    const inv = await this.invoices.emit(schema, {
      docType: DocumentType.FT, series: 'A',
      customerId: (r.customer_id as string) ?? null,
      cashierId: opener.id, cashierName: opener.name,
      paymentType: 'CASH', lines,
    });
    await this.prisma.runInTenant(schema, async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        UPDATE hotel_reservations SET invoice_id = ${inv.id}::uuid, status = 'CHECKED_OUT', updated_at = now()
        WHERE id = ${reservationId}::uuid`);
      // Check-out → quarto vai para LIMPEZA + gera tarefa de housekeeping.
      await this.applyRoomLifecycle(tx, (r.room_id as string) ?? null, (r.room_name as string) ?? null, 'CHECKED_OUT');
    });
    return { invoiceId: inv.id, invoiceNumber: inv.number };
  }

  private async recompute(tx: Prisma.TransactionClient, id: string) {
    await tx.$executeRaw(Prisma.sql`UPDATE hotel_reservations SET total = (nights * rate) + COALESCE(
      (SELECT SUM(unit_price * quantity) FROM hotel_folio_items WHERE reservation_id = ${id}::uuid), 0), updated_at = now()
      WHERE id = ${id}::uuid`);
  }

  async addFolio(schema: string, id: string, dto: { productCode?: string; description?: string; unitPrice?: number; quantity?: number }) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const res = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status FROM hotel_reservations WHERE id = ${id}::uuid`);
      if (!res[0]) throw new NotFoundException('Reserva não encontrada.');
      const qty = dto.quantity && dto.quantity > 0 ? dto.quantity : 1;
      let description = dto.description?.trim() || '';
      let price = dto.unitPrice ?? 0;
      let productId: string | null = null; let productCode: string | null = null;
      if (dto.productCode) {
        const p = await tx.$queryRaw<{ id: string; name: string; unit_price: string; iva_code: string }[]>(
          Prisma.sql`SELECT id, name, unit_price, iva_code FROM products WHERE code = ${dto.productCode} AND is_active = TRUE LIMIT 1`);
        if (!p[0]) throw new NotFoundException('Produto não encontrado.');
        productId = p[0].id; productCode = dto.productCode; description = description || p[0].name;
        price = Math.round(Number(p[0].unit_price) * (1 + (IVA_RATE[p[0].iva_code] ?? 14) / 100) * 100) / 100;
      }
      if (!description) throw new BadRequestException('Indique a descrição do consumo.');
      await tx.$executeRaw(Prisma.sql`INSERT INTO hotel_folio_items (reservation_id, product_id, product_code, description, unit_price, quantity)
        VALUES (${id}::uuid, ${productId}::uuid, ${productCode}, ${description}, ${price}, ${qty})`);
      await this.recompute(tx, id);
      return { ok: true };
    });
  }

  async removeFolio(schema: string, itemId: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const it = await tx.$queryRaw<{ reservation_id: string }[]>(Prisma.sql`SELECT reservation_id FROM hotel_folio_items WHERE id = ${itemId}::uuid`);
      if (!it[0]) return { ok: true };
      await tx.$executeRaw(Prisma.sql`DELETE FROM hotel_folio_items WHERE id = ${itemId}::uuid`);
      await this.recompute(tx, it[0].reservation_id);
      return { ok: true };
    });
  }

  async setStatus(schema: string, id: string, status: string) {
    if (!RES_STATUS.includes(status)) throw new BadRequestException('Estado inválido.');
    await this.prisma.runInTenant(schema, async (tx) => {
      await tx.$executeRaw(Prisma.sql`UPDATE hotel_reservations SET status = ${status}, updated_at = now() WHERE id = ${id}::uuid`);
      const r = await tx.$queryRaw<{ room_id: string | null; room_name: string | null }[]>(
        Prisma.sql`SELECT room_id, room_name FROM hotel_reservations WHERE id = ${id}::uuid`);
      await this.applyRoomLifecycle(tx, r[0]?.room_id ?? null, r[0]?.room_name ?? null, status);
    });
    return { ok: true };
  }

  /**
   * Sincroniza o estado FÍSICO do quarto com o ciclo da reserva e gera a tarefa
   * de limpeza no check-out (fluxo: reserva→ocupado→limpeza→disponível).
   */
  private async applyRoomLifecycle(tx: Prisma.TransactionClient, roomId: string | null, roomName: string | null, resStatus: string): Promise<void> {
    if (!roomId) return;
    const map: Record<string, string> = { BOOKED: 'RESERVED', CHECKED_IN: 'OCCUPIED', CHECKED_OUT: 'CLEANING', CANCELLED: 'AVAILABLE' };
    const roomStatus = map[resStatus];
    if (!roomStatus) return;
    await tx.$executeRaw(Prisma.sql`UPDATE hotel_rooms SET status = ${roomStatus} WHERE id = ${roomId}::uuid`);
    if (resStatus === 'CHECKED_OUT') {
      // Gera tarefa de limpeza se ainda não houver uma pendente para este quarto.
      const pend = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM hotel_housekeeping WHERE room_id = ${roomId}::uuid AND status = 'PENDING' LIMIT 1`);
      if (!pend[0]) {
        await tx.$executeRaw(Prisma.sql`INSERT INTO hotel_housekeeping (room_id, room_name, task, status)
          VALUES (${roomId}::uuid, ${roomName}, 'CLEAN', 'PENDING')`);
      }
    }
  }

  // ── Housekeeping (limpeza) ─────────────────────────────────
  listHousekeeping(schema: string, status?: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(status === 'DONE' || status === 'PENDING'
        ? Prisma.sql`SELECT id, room_id, room_name, task, status, assigned_to, notes, created_at, done_at
                     FROM hotel_housekeeping WHERE status = ${status} ORDER BY created_at DESC LIMIT 300`
        : Prisma.sql`SELECT id, room_id, room_name, task, status, assigned_to, notes, created_at, done_at
                     FROM hotel_housekeeping ORDER BY (status='PENDING') DESC, created_at DESC LIMIT 300`));
  }

  async createHousekeeping(schema: string, dto: { roomId: string; task?: string; assignedTo?: string; notes?: string }) {
    const task = ['CLEAN', 'CHANGE_LINEN', 'INSPECT'].includes(dto.task ?? '') ? dto.task : 'CLEAN';
    return this.prisma.runInTenant(schema, async (tx) => {
      const room = await tx.$queryRaw<{ name: string }[]>(Prisma.sql`SELECT name FROM hotel_rooms WHERE id = ${dto.roomId}::uuid`);
      if (!room[0]) throw new NotFoundException('Quarto não encontrado.');
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`INSERT INTO hotel_housekeeping (room_id, room_name, task, status, assigned_to, notes)
        VALUES (${dto.roomId}::uuid, ${room[0].name}, ${task}, 'PENDING', ${dto.assignedTo?.trim() || null}, ${dto.notes?.trim() || null}) RETURNING id`);
      // Quarto entra em limpeza enquanto a tarefa estiver pendente.
      await tx.$executeRaw(Prisma.sql`UPDATE hotel_rooms SET status = 'CLEANING' WHERE id = ${dto.roomId}::uuid AND status NOT IN ('OCCUPIED','MAINTENANCE','BLOCKED')`);
      return rows[0];
    });
  }

  /** Conclui a limpeza: se não restarem tarefas pendentes, o quarto fica disponível. */
  async doneHousekeeping(schema: string, id: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const hk = await tx.$queryRaw<{ room_id: string | null }[]>(Prisma.sql`SELECT room_id FROM hotel_housekeeping WHERE id = ${id}::uuid`);
      if (!hk[0]) throw new NotFoundException('Tarefa não encontrada.');
      await tx.$executeRaw(Prisma.sql`UPDATE hotel_housekeeping SET status = 'DONE', done_at = now() WHERE id = ${id}::uuid`);
      const roomId = hk[0].room_id;
      if (roomId) {
        const pend = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM hotel_housekeeping WHERE room_id = ${roomId}::uuid AND status = 'PENDING'`);
        if ((pend[0]?.n ?? 0) === 0) {
          // Só liberta o quarto se não estiver ocupado/manutenção/bloqueado.
          await tx.$executeRaw(Prisma.sql`UPDATE hotel_rooms SET status = 'AVAILABLE' WHERE id = ${roomId}::uuid AND status = 'CLEANING'`);
        }
      }
      return { ok: true };
    });
  }

  // ── Manutenção ─────────────────────────────────────────────
  listMaintenance(schema: string, status?: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(['OPEN', 'IN_REPAIR', 'DONE'].includes(status ?? '')
        ? Prisma.sql`SELECT id, room_id, room_name, problem, status, assigned_to, created_at, done_at
                     FROM hotel_maintenance WHERE status = ${status} ORDER BY created_at DESC LIMIT 300`
        : Prisma.sql`SELECT id, room_id, room_name, problem, status, assigned_to, created_at, done_at
                     FROM hotel_maintenance ORDER BY (status<>'DONE') DESC, created_at DESC LIMIT 300`));
  }

  async createMaintenance(schema: string, dto: { roomId: string; problem: string; assignedTo?: string }) {
    if (!dto.problem?.trim()) throw new BadRequestException('Descreva o problema.');
    return this.prisma.runInTenant(schema, async (tx) => {
      const room = await tx.$queryRaw<{ name: string }[]>(Prisma.sql`SELECT name FROM hotel_rooms WHERE id = ${dto.roomId}::uuid`);
      if (!room[0]) throw new NotFoundException('Quarto não encontrado.');
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`INSERT INTO hotel_maintenance (room_id, room_name, problem, status, assigned_to)
        VALUES (${dto.roomId}::uuid, ${room[0].name}, ${dto.problem.trim()}, 'OPEN', ${dto.assignedTo?.trim() || null}) RETURNING id`);
      await tx.$executeRaw(Prisma.sql`UPDATE hotel_rooms SET status = 'MAINTENANCE' WHERE id = ${dto.roomId}::uuid AND status NOT IN ('OCCUPIED')`);
      return rows[0];
    });
  }

  /** Muda o estado da manutenção; ao concluir, liberta o quarto (se já não houver avarias abertas). */
  async setMaintenanceStatus(schema: string, id: string, status: string) {
    if (!['OPEN', 'IN_REPAIR', 'DONE'].includes(status)) throw new BadRequestException('Estado inválido.');
    return this.prisma.runInTenant(schema, async (tx) => {
      const mt = await tx.$queryRaw<{ room_id: string | null }[]>(Prisma.sql`SELECT room_id FROM hotel_maintenance WHERE id = ${id}::uuid`);
      if (!mt[0]) throw new NotFoundException('Manutenção não encontrada.');
      await tx.$executeRaw(Prisma.sql`UPDATE hotel_maintenance SET status = ${status}, done_at = ${status === 'DONE' ? Prisma.sql`now()` : Prisma.sql`NULL`} WHERE id = ${id}::uuid`);
      const roomId = mt[0].room_id;
      if (roomId && status === 'DONE') {
        const open = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM hotel_maintenance WHERE room_id = ${roomId}::uuid AND status <> 'DONE'`);
        if ((open[0]?.n ?? 0) === 0) {
          await tx.$executeRaw(Prisma.sql`UPDATE hotel_rooms SET status = 'AVAILABLE' WHERE id = ${roomId}::uuid AND status = 'MAINTENANCE'`);
        }
      }
      return { ok: true };
    });
  }
}
