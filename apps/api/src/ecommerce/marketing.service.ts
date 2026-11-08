import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Cupão como guardado (store_coupons). */
export interface CouponRow {
  id: string; code: string; type: 'PERCENT' | 'AMOUNT'; value: string; min_order: string;
  max_uses: number | null; per_customer: number; starts_at: Date | null; ends_at: Date | null;
  is_public: boolean; is_active: boolean; created_at: Date; uses?: number;
}

export interface CouponInput {
  code?: string; type?: 'PERCENT' | 'AMOUNT'; value?: number; minOrder?: number;
  maxUses?: number | null; perCustomer?: number; startsAt?: string | null; endsAt?: string | null;
  isPublic?: boolean; isActive?: boolean;
}

/** Estados de encomenda que contam como compra feita (para poder avaliar). */
const BOUGHT = Prisma.sql`('PAID','SHIPPED','DELIVERED')`;

export const normCode = (c: string) => c.trim().toUpperCase().replace(/\s+/g, '');

/** Nome público de quem avalia: primeiro nome + inicial do último ("Ana S."). */
export function publicName(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Cliente';
  const first = parts[0].slice(0, 24);
  return parts.length > 1 ? `${first} ${parts[parts.length - 1][0].toUpperCase()}.` : first;
}

/** Desconto de um cupão sobre um total (com IVA), nunca acima do total. */
export function couponDiscount(c: Pick<CouponRow, 'type' | 'value'>, total: number): number {
  const v = Number(c.value);
  const d = c.type === 'PERCENT' ? (total * Math.min(100, Math.max(0, v))) / 100 : Math.max(0, v);
  return Math.round(Math.min(total, d) * 100) / 100;
}

/** Valida um cupão para um cliente e total; devolve o motivo em português se não servir. */
export async function checkCoupon(
  tx: Prisma.TransactionClient, rawCode: string, email: string, total: number, lock = false,
): Promise<{ coupon: CouponRow; discount: number }> {
  const code = normCode(rawCode);
  if (!code) throw new BadRequestException('Indique o código do cupão.');
  const reg = await tx.$queryRaw<{ r: string | null }[]>(Prisma.sql`SELECT to_regclass('store_coupons')::text AS r`);
  if (!reg[0]?.r) throw new BadRequestException('Cupão inválido.');
  const rows = await tx.$queryRaw<CouponRow[]>(
    lock
      ? Prisma.sql`SELECT * FROM store_coupons WHERE code = ${code} FOR UPDATE`
      : Prisma.sql`SELECT * FROM store_coupons WHERE code = ${code}`,
  );
  const c = rows[0];
  const now = Date.now();
  if (!c || !c.is_active) throw new BadRequestException('Cupão inválido.');
  if (c.starts_at && c.starts_at.getTime() > now) throw new BadRequestException('Este cupão ainda não está activo.');
  if (c.ends_at && c.ends_at.getTime() < now) throw new BadRequestException('Este cupão expirou.');
  if (total < Number(c.min_order)) {
    throw new BadRequestException(`Este cupão exige compras a partir de ${Number(c.min_order).toLocaleString('pt-PT', { minimumFractionDigits: 2 })} Kz.`);
  }
  const used = await tx.$queryRaw<{ total_n: number; mine: number }[]>(
    Prisma.sql`SELECT COUNT(*)::int AS total_n,
                      COUNT(*) FILTER (WHERE lower(customer_email) = ${email.toLowerCase()})::int AS mine
               FROM web_orders WHERE coupon_code = ${code} AND status <> 'CANCELLED'`,
  );
  if (c.max_uses != null && (used[0]?.total_n ?? 0) >= c.max_uses) throw new BadRequestException('Este cupão esgotou.');
  if ((used[0]?.mine ?? 0) >= Math.max(1, c.per_customer)) throw new BadRequestException('Já usou este cupão.');
  const discount = couponDiscount(c, total);
  if (discount <= 0) throw new BadRequestException('Cupão inválido.');
  return { coupon: c, discount };
}

@Injectable()
export class MarketingService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Cupões (gestão) ──────────────────────────────────────
  listCoupons(schema: string): Promise<CouponRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<CouponRow[]>(
        Prisma.sql`SELECT c.*, (SELECT COUNT(*)::int FROM web_orders o WHERE o.coupon_code = c.code AND o.status <> 'CANCELLED') AS uses
                   FROM store_coupons c ORDER BY c.created_at DESC`,
      ),
    );
  }

  private validate(dto: CouponInput, partial: boolean): void {
    if (!partial || dto.code !== undefined) {
      const code = normCode(dto.code ?? '');
      if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new BadRequestException('Código: 3 a 32 letras, números, "-" ou "_".');
    }
    if (!partial || dto.type !== undefined) {
      if (dto.type !== 'PERCENT' && dto.type !== 'AMOUNT') throw new BadRequestException('Tipo inválido.');
    }
    if (!partial || dto.value !== undefined) {
      const v = Number(dto.value);
      if (!Number.isFinite(v) || v <= 0) throw new BadRequestException('Indique o valor do desconto.');
      if (dto.type === 'PERCENT' && v > 100) throw new BadRequestException('A percentagem não pode passar de 100.');
    }
    if (dto.minOrder !== undefined && (!Number.isFinite(Number(dto.minOrder)) || Number(dto.minOrder) < 0)) throw new BadRequestException('Valor mínimo inválido.');
    if (dto.maxUses != null && (!Number.isInteger(Number(dto.maxUses)) || Number(dto.maxUses) < 1)) throw new BadRequestException('Limite de usos inválido.');
    if (dto.perCustomer !== undefined && (!Number.isInteger(Number(dto.perCustomer)) || Number(dto.perCustomer) < 1)) throw new BadRequestException('Usos por cliente inválido.');
    if (dto.startsAt && dto.endsAt && Date.parse(dto.endsAt) <= Date.parse(dto.startsAt)) throw new BadRequestException('O fim tem de ser depois do início.');
  }

  createCoupon(schema: string, dto: CouponInput): Promise<CouponRow> {
    this.validate(dto, false);
    return this.prisma.runInTenant(schema, async (tx) => {
      const code = normCode(dto.code!);
      const dup = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM store_coupons WHERE code = ${code}`);
      if (dup.length) throw new BadRequestException('Já existe um cupão com esse código.');
      const rows = await tx.$queryRaw<CouponRow[]>(
        Prisma.sql`INSERT INTO store_coupons (code, type, value, min_order, max_uses, per_customer, starts_at, ends_at, is_public, is_active)
                   VALUES (${code}, ${dto.type}, ${Number(dto.value)}, ${Number(dto.minOrder ?? 0)}, ${dto.maxUses ?? null},
                           ${Number(dto.perCustomer ?? 1)}, ${dto.startsAt ?? null}::timestamptz, ${dto.endsAt ?? null}::timestamptz,
                           ${dto.isPublic ?? false}, ${dto.isActive ?? true})
                   RETURNING *`,
      );
      return rows[0];
    });
  }

  updateCoupon(schema: string, id: string, dto: CouponInput): Promise<CouponRow> {
    this.validate(dto, true);
    return this.prisma.runInTenant(schema, async (tx) => {
      const cur = await tx.$queryRaw<CouponRow[]>(Prisma.sql`SELECT * FROM store_coupons WHERE id = ${id}::uuid`);
      if (!cur[0]) throw new NotFoundException('Cupão não encontrado.');
      const c = cur[0];
      const type = dto.type ?? c.type;
      const value = dto.value !== undefined ? Number(dto.value) : Number(c.value);
      if (type === 'PERCENT' && value > 100) throw new BadRequestException('A percentagem não pode passar de 100.');
      const rows = await tx.$queryRaw<CouponRow[]>(
        Prisma.sql`UPDATE store_coupons SET
                     type = ${type}, value = ${value},
                     min_order = ${dto.minOrder !== undefined ? Number(dto.minOrder) : Number(c.min_order)},
                     max_uses = ${dto.maxUses !== undefined ? dto.maxUses : c.max_uses},
                     per_customer = ${dto.perCustomer !== undefined ? Number(dto.perCustomer) : c.per_customer},
                     starts_at = ${dto.startsAt !== undefined ? dto.startsAt : c.starts_at?.toISOString() ?? null}::timestamptz,
                     ends_at = ${dto.endsAt !== undefined ? dto.endsAt : c.ends_at?.toISOString() ?? null}::timestamptz,
                     is_public = ${dto.isPublic ?? c.is_public}, is_active = ${dto.isActive ?? c.is_active},
                     updated_at = now()
                   WHERE id = ${id}::uuid RETURNING *`,
      );
      return rows[0];
    });
  }

  removeCoupon(schema: string, id: string): Promise<{ id: string }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`DELETE FROM store_coupons WHERE id = ${id}::uuid RETURNING id`);
      if (!rows[0]) throw new NotFoundException('Cupão não encontrado.');
      return rows[0];
    });
  }

  // ── Cupões (montra) ──────────────────────────────────────
  /** Cupões que a loja escolheu mostrar na montra (activos e válidos agora). */
  publicCoupons(schema: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const reg = await tx.$queryRaw<{ r: string | null }[]>(Prisma.sql`SELECT to_regclass('store_coupons')::text AS r`);
      if (!reg[0]?.r) return [];
      const rows = await tx.$queryRaw<CouponRow[]>(
        Prisma.sql`SELECT * FROM store_coupons
                   WHERE is_active AND is_public AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
                   ORDER BY min_order, created_at DESC LIMIT 12`,
      );
      return rows.map((c) => ({
        code: c.code, type: c.type, value: Number(c.value), minOrder: Number(c.min_order),
        endsAt: c.ends_at?.toISOString() ?? null,
      }));
    });
  }

  /** Pré-visualização do desconto no checkout (o checkout volta a validar). */
  previewCoupon(schema: string, code: string, email: string, total: number) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const { coupon, discount } = await checkCoupon(tx, code, email, total);
      return { code: coupon.code, type: coupon.type, value: Number(coupon.value), minOrder: Number(coupon.min_order), discount };
    });
  }

  // ── Avaliações ───────────────────────────────────────────
  async productReviews(schema: string, productCode: string, email?: string | null) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const reg = await tx.$queryRaw<{ r: string | null }[]>(Prisma.sql`SELECT to_regclass('store_reviews')::text AS r`);
      const empty = { average: 0, count: 0, distribution: [0, 0, 0, 0, 0], items: [] as unknown[], mine: null as unknown, canReview: false };
      const prod = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM products WHERE code = ${productCode} AND is_active AND show_online`);
      if (!prod[0] || !reg[0]?.r) return empty;
      const pid = prod[0].id;
      const rows = await tx.$queryRaw<{ id: string; customer_name: string | null; customer_email: string; rating: number; comment: string | null; created_at: Date; is_hidden: boolean }[]>(
        Prisma.sql`SELECT id, customer_name, customer_email, rating, comment, created_at, is_hidden
                   FROM store_reviews WHERE product_id = ${pid}::uuid ORDER BY created_at DESC LIMIT 200`,
      );
      const visible = rows.filter((r) => !r.is_hidden);
      const distribution = [0, 0, 0, 0, 0];
      for (const r of visible) distribution[r.rating - 1] += 1;
      const average = visible.length ? Math.round((visible.reduce((s, r) => s + r.rating, 0) / visible.length) * 10) / 10 : 0;
      const em = email?.toLowerCase() ?? null;
      const mineRow = em ? rows.find((r) => r.customer_email.toLowerCase() === em) : undefined;
      const canReview = em ? await this.hasBought(tx, pid, em) : false;
      return {
        average, count: visible.length, distribution,
        items: visible.slice(0, 50).map((r) => ({
          id: r.id, name: publicName(r.customer_name), rating: r.rating, comment: r.comment, date: r.created_at.toISOString(),
        })),
        mine: mineRow ? { rating: mineRow.rating, comment: mineRow.comment } : null,
        canReview,
      };
    });
  }

  private async hasBought(tx: Prisma.TransactionClient, productId: string, email: string): Promise<boolean> {
    const r = await tx.$queryRaw<{ n: number }[]>(
      Prisma.sql`SELECT COUNT(*)::int AS n FROM web_order_items wi JOIN web_orders wo ON wo.id = wi.order_id
                 WHERE wi.product_id = ${productId}::uuid AND lower(wo.customer_email) = ${email} AND wo.status IN ${BOUGHT}`,
    );
    return (r[0]?.n ?? 0) > 0;
  }

  async submitReview(schema: string, productCode: string, email: string, name: string, rating: number, comment?: string | null) {
    const r = Math.round(Number(rating));
    if (!(r >= 1 && r <= 5)) throw new BadRequestException('Escolha de 1 a 5 estrelas.');
    const text = (comment ?? '').trim().slice(0, 1000) || null;
    return this.prisma.runInTenant(schema, async (tx) => {
      const prod = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM products WHERE code = ${productCode} AND is_active AND show_online`);
      if (!prod[0]) throw new NotFoundException('Produto não encontrado.');
      const em = email.toLowerCase();
      if (!(await this.hasBought(tx, prod[0].id, em))) throw new ForbiddenException('Só quem comprou este produto pode avaliá-lo.');
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO store_reviews (product_id, customer_email, customer_name, rating, comment)
                   VALUES (${prod[0].id}::uuid, ${em}, ${name.slice(0, 120)}, ${r}, ${text})
                   ON CONFLICT (product_id, customer_email)
                   DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, customer_name = EXCLUDED.customer_name, updated_at = now()`,
      );
      return { ok: true };
    });
  }

  /** Gestão: últimas avaliações (incluindo ocultas), com o produto. */
  listReviews(schema: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<unknown[]>(
        Prisma.sql`SELECT r.id, r.rating, r.comment, r.customer_name, r.customer_email, r.is_hidden, r.created_at,
                          p.code AS product_code, p.name AS product_name
                   FROM store_reviews r JOIN products p ON p.id = r.product_id
                   ORDER BY r.created_at DESC LIMIT 300`,
      ),
    );
  }

  setReviewHidden(schema: string, id: string, hidden: boolean) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const n = await tx.$executeRaw(Prisma.sql`UPDATE store_reviews SET is_hidden = ${hidden}, updated_at = now() WHERE id = ${id}::uuid`);
      if (!n) throw new NotFoundException('Avaliação não encontrada.');
      return { id, hidden };
    });
  }
}
