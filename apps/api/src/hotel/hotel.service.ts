import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const IVA_RATE: Record<string, number> = { NOR: 14, INT: 7, RED: 5, ISE: 0, NS: 0 };
const RES_STATUS = ['BOOKED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'];
const nightsBetween = (ci: string, co: string): number => {
  const a = new Date(ci + 'T00:00:00'), b = new Date(co + 'T00:00:00');
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000));
};

/** Hotelaria — quartos, reservas e conta do hóspede (folio). */
@Injectable()
export class HotelService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Quartos ────────────────────────────────────────────────
  listRooms(schema: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`SELECT id, code, name, room_type, capacity, rate, status, sort_order
        FROM hotel_rooms WHERE is_active = TRUE ORDER BY sort_order, code`));
  }

  async createRoom(schema: string, dto: { code?: string; name: string; roomType?: string; capacity?: number; rate?: number }) {
    if (!dto.name?.trim()) throw new BadRequestException('Indique o nome do quarto.');
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`INSERT INTO hotel_rooms (code, name, room_type, capacity, rate)
        VALUES (${dto.code?.trim() || dto.name.trim()}, ${dto.name.trim()}, ${dto.roomType?.trim() || null}, ${dto.capacity ?? 2}, ${dto.rate ?? 0})
        RETURNING id, code, name, room_type, capacity, rate, status, sort_order`));
  }

  async removeRoom(schema: string, id: string) {
    await this.prisma.runInTenant(schema, (tx) => tx.$executeRaw(Prisma.sql`UPDATE hotel_rooms SET is_active = FALSE WHERE id = ${id}::uuid`));
    return { ok: true };
  }

  /** Mapa de quartos com a reserva ativa (CHECKED_IN) de cada um. */
  roomMap(schema: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT r.id, r.code, r.name, r.room_type, r.capacity, r.rate, r.status,
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
        ? Prisma.sql`SELECT id, number, room_name, guest_name, check_in, check_out, nights, status, total
                     FROM hotel_reservations WHERE status = ${status} ORDER BY check_in DESC LIMIT 300`
        : Prisma.sql`SELECT id, number, room_name, guest_name, check_in, check_out, nights, status, total
                     FROM hotel_reservations ORDER BY check_in DESC LIMIT 300`));
  }

  async create(schema: string, by: string, dto: { roomId: string; guestName?: string; guestPhone?: string; checkIn: string; checkOut: string; guests?: number }) {
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
        INSERT INTO hotel_reservations (number, room_id, room_name, guest_name, guest_phone, check_in, check_out, nights, rate, guests, total, created_by)
        VALUES (${number}, ${dto.roomId}::uuid, ${room[0].name}, ${dto.guestName?.trim() || null}, ${dto.guestPhone?.trim() || null},
                ${dto.checkIn}::date, ${dto.checkOut}::date, ${nights}, ${rate}, ${dto.guests ?? 1}, ${rate * nights}, ${by}::uuid)
        RETURNING id`);
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
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE hotel_reservations SET status = ${status}, updated_at = now() WHERE id = ${id}::uuid`));
    return { ok: true };
  }
}
