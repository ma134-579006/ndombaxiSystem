import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { applyPromotions, type Promotion, type PromoCartLine } from './promo-engine';
import { DEFAULT_LOYALTY, pointsEarned, redeemPoints } from './loyalty-engine';

export interface PromoRow {
  id: string; name: string; type: string; scope: string; target_id: string | null;
  percent: string | null; amount: string | null; buy_qty: number | null; pay_qty: number | null;
  min_qty: number | null; tier_percent: string | null; priority: number; is_active: boolean;
  starts_at: Date | null; ends_at: Date | null; weekdays: number[] | null;
  start_time: string | null; end_time: string | null;
}

function toEngine(r: PromoRow): Promotion {
  return {
    id: r.id, name: r.name, type: r.type as Promotion['type'], scope: r.scope as Promotion['scope'],
    targetId: r.target_id, percent: r.percent != null ? Number(r.percent) : null,
    amount: r.amount != null ? Number(r.amount) : null, buyQty: r.buy_qty, payQty: r.pay_qty,
    minQty: r.min_qty, tierPercent: r.tier_percent != null ? Number(r.tier_percent) : null,
    priority: r.priority, active: r.is_active,
    startsAt: r.starts_at?.toISOString() ?? null, endsAt: r.ends_at?.toISOString() ?? null,
    weekdays: r.weekdays, startTime: r.start_time, endTime: r.end_time,
  };
}

@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── CRUD de promoções (gestor) ─────────────────────────────
  list(schema: string): Promise<PromoRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<PromoRow[]>(Prisma.sql`SELECT * FROM promotions ORDER BY priority DESC, created_at DESC`),
    );
  }

  create(schema: string, dto: Record<string, unknown>): Promise<PromoRow> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<PromoRow[]>(
        Prisma.sql`INSERT INTO promotions
            (name, type, scope, target_id, percent, amount, buy_qty, pay_qty, min_qty, tier_percent,
             priority, is_active, starts_at, ends_at, weekdays, start_time, end_time)
          VALUES (${dto.name as string}, ${dto.type as string}, ${(dto.scope as string) ?? 'ALL'},
                  ${(dto.targetId as string) ?? null}::uuid, ${(dto.percent as number) ?? null},
                  ${(dto.amount as number) ?? null}, ${(dto.buyQty as number) ?? null},
                  ${(dto.payQty as number) ?? null}, ${(dto.minQty as number) ?? null},
                  ${(dto.tierPercent as number) ?? null}, ${(dto.priority as number) ?? 0},
                  ${(dto.isActive as boolean) ?? true}, ${(dto.startsAt as string) ?? null}::timestamptz,
                  ${(dto.endsAt as string) ?? null}::timestamptz, ${(dto.weekdays as number[]) ?? null},
                  ${(dto.startTime as string) ?? null}, ${(dto.endTime as string) ?? null})
          RETURNING *`,
      );
      return rows[0];
    });
  }

  async update(schema: string, id: string, dto: Record<string, unknown>): Promise<PromoRow> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<PromoRow[]>(
        Prisma.sql`UPDATE promotions SET
            name = COALESCE(${(dto.name as string) ?? null}, name),
            is_active = COALESCE(${(dto.isActive as boolean) ?? null}, is_active),
            percent = ${dto.percent === undefined ? Prisma.sql`percent` : Prisma.sql`${dto.percent as number}`},
            priority = COALESCE(${(dto.priority as number) ?? null}, priority),
            updated_at = now()
          WHERE id = ${id}::uuid RETURNING *`,
      );
      if (!rows[0]) throw new NotFoundException('Promoção não encontrada');
      return rows[0];
    });
  }

  remove(schema: string, id: string): Promise<{ id: string }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`DELETE FROM promotions WHERE id = ${id}::uuid RETURNING id`,
      );
      if (!rows[0]) throw new NotFoundException('Promoção não encontrada');
      return rows[0];
    });
  }

  /** Promoções activas (para o POS pré-calcular descontos). */
  async activeForPos(schema: string): Promise<Promotion[]> {
    const rows = await this.list(schema);
    return rows.map(toEngine).filter((p) => p.active !== false);
  }

  /** Calcula os descontos de um carrinho (usado pelo POS/loja). */
  async quote(schema: string, lines: PromoCartLine[]) {
    const promos = (await this.list(schema)).map(toEngine);
    return applyPromotions(lines, promos);
  }

  // ── Fidelização ────────────────────────────────────────────
  findCard(schema: string, code: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; card_code: string; holder_name: string | null; points: number }[]>(
        Prisma.sql`SELECT id, card_code, holder_name, points FROM loyalty_cards
                   WHERE card_code = ${code} AND is_active = TRUE LIMIT 1`,
      );
      if (!rows[0]) throw new NotFoundException('Cartão não encontrado');
      return rows[0];
    });
  }

  createCard(schema: string, dto: { cardCode: string; holderName?: string; phone?: string; customerId?: string }) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; card_code: string; points: number }[]>(
        Prisma.sql`INSERT INTO loyalty_cards (card_code, holder_name, phone, customer_id)
          VALUES (${dto.cardCode}, ${dto.holderName ?? null}, ${dto.phone ?? null}, ${dto.customerId ?? null}::uuid)
          RETURNING id, card_code, points`,
      );
      return rows[0];
    }).catch(() => { throw new BadRequestException('Já existe um cartão com esse código.'); });
  }

  /** Credita pontos por uma compra. */
  earn(schema: string, cardId: string, grossTotal: number, reference?: string) {
    const pts = pointsEarned(grossTotal, DEFAULT_LOYALTY);
    if (pts <= 0) return Promise.resolve({ points: pts });
    return this.prisma.runInTenant(schema, async (tx) => {
      await tx.$executeRaw(Prisma.sql`UPDATE loyalty_cards SET points = points + ${pts} WHERE id = ${cardId}::uuid`);
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO loyalty_movements (card_id, points, reason, reference)
                   VALUES (${cardId}::uuid, ${pts}, 'EARN', ${reference ?? null})`,
      );
      return { points: pts };
    });
  }

  /** Resgata pontos como desconto. */
  redeem(schema: string, cardId: string, requestedPoints: number, grossTotal: number) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ points: number }[]>(
        Prisma.sql`SELECT points FROM loyalty_cards WHERE id = ${cardId}::uuid FOR UPDATE`,
      );
      if (!rows[0]) throw new NotFoundException('Cartão não encontrado');
      const result = redeemPoints(requestedPoints, rows[0].points, grossTotal, DEFAULT_LOYALTY);
      if (result.pointsUsed > 0) {
        await tx.$executeRaw(Prisma.sql`UPDATE loyalty_cards SET points = points - ${result.pointsUsed} WHERE id = ${cardId}::uuid`);
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO loyalty_movements (card_id, points, reason) VALUES (${cardId}::uuid, ${-result.pointsUsed}, 'REDEEM')`,
        );
      }
      return result;
    });
  }
}
