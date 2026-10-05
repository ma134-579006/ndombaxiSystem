import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IVA_RATE, type IvaCode } from '@nexus/agt-xml';
import { PasswordService } from '../auth/password.service';
import { TenantAuditService } from '../cashbox/tenant-audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { PromotionsService } from '../promotions/promotions.service';
import { ROLE_LEVEL, Role } from '../rbac/roles.enum';
import type { JwtPayload } from '@nexus/types';

/** Folga de arredondamento entre o desconto da promoção calculado no posto e aqui. */
const TOLERANCE = 0.005;
/** A partir de supervisor de turno, o próprio pode dar desconto manual. */
const MAX_LEVEL_SELF = ROLE_LEVEL[Role.SHIFT_SUPERVISOR];

interface Line { productCode?: string; quantity: number; discountRate?: number }

/**
 * Descontos na venda: o posto envia `discountRate` por linha. Até agora o
 * servidor aceitava qualquer valor — um caixa podia, por pedido direto à API,
 * vender com 90 % de desconto. Regras:
 *   • desconto ≤ ao da promoção ativa para esse artigo → aceite (é a promoção);
 *   • acima disso é DESCONTO MANUAL: só supervisor/gerente, ou um caixa com o
 *     PIN de um supervisor/gerente da loja (aprovação no balcão);
 *   • fica sempre na auditoria (quem deu, quem aprovou, quanto).
 * Vendas offline a subir da fila não são recusadas (a promoção pode ter mudado
 * entretanto e a mercadoria já saiu): ficam auditadas como "não verificadas".
 */
@Injectable()
export class DiscountGuardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promotions: PromotionsService,
    private readonly passwords: PasswordService,
    private readonly audit: TenantAuditService,
  ) {}

  async check(
    schema: string,
    actor: JwtPayload,
    lines: Line[],
    opts: { approvalPin?: string | null; offline?: boolean },
  ): Promise<void> {
    const wanted = lines.filter((l) => l.productCode && (l.discountRate ?? 0) > 0);
    if (!wanted.length) return;

    const codes = [...new Set(wanted.map((l) => l.productCode!))];
    const products = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ id: string; code: string; category_id: string | null; unit_price: string; iva_code: string }[]>(
        Prisma.sql`SELECT id::text AS id, code, category_id::text AS category_id, unit_price, iva_code
                   FROM products WHERE code IN (${Prisma.join(codes)})`,
      ),
    );
    const byCode = new Map(products.map((p) => [p.code, p]));
    const quoteLines = wanted.flatMap((l) => {
      const p = byCode.get(l.productCode!);
      if (!p) return [];
      const rate = IVA_RATE[p.iva_code as IvaCode] ?? 0;
      return [{ productId: p.id, categoryId: p.category_id, unitGross: Number(p.unit_price) * (1 + rate / 100), quantity: l.quantity }];
    });
    const quote = await this.promotions.quote(schema, quoteLines).catch(() => null);
    const allowed = new Map<string, number>();
    for (const r of quote?.lines ?? []) allowed.set(r.productId, r.grossBefore > 0 ? r.discount / r.grossBefore : 0);

    const manual = wanted
      .map((l) => {
        const p = byCode.get(l.productCode!);
        const promo = p ? allowed.get(p.id) ?? 0 : 0;
        return { code: l.productCode!, rate: l.discountRate ?? 0, promo };
      })
      .filter((x) => x.rate > x.promo + TOLERANCE);
    if (!manual.length) return;

    const details = { lines: manual.map((m) => ({ code: m.code, discount: Math.round(m.rate * 10000) / 100, promo: Math.round(m.promo * 10000) / 100 })) };
    const level = ROLE_LEVEL[actor.role as Role] ?? 99;
    if (level <= MAX_LEVEL_SELF) {
      await this.audit.record(schema, { actorId: actor.sub, actorName: actor.name ?? actor.email, action: 'MANUAL_DISCOUNT', entity: 'sale', details: { ...details, approvedBy: 'self' } });
      return;
    }
    const approver = opts.approvalPin ? await this.findApprover(schema, actor, opts.approvalPin) : null;
    if (approver) {
      await this.audit.record(schema, {
        actorId: actor.sub, actorName: actor.name ?? actor.email, action: 'MANUAL_DISCOUNT', entity: 'sale',
        details: { ...details, approvedBy: { id: approver.id, name: approver.name } },
      });
      return;
    }
    if (opts.offline) {
      await this.audit.record(schema, { actorId: actor.sub, actorName: actor.name ?? actor.email, action: 'MANUAL_DISCOUNT_UNVERIFIED', entity: 'sale', details });
      return;
    }
    throw new ForbiddenException(
      opts.approvalPin
        ? 'PIN de aprovação inválido: tem de ser o PIN de um supervisor ou gerente desta loja.'
        : 'Desconto manual precisa da aprovação de um supervisor ou gerente (PIN).',
    );
  }

  /** Confirma no balcão o PIN de quem aprova (resposta imediata ao caixa). */
  async approve(schema: string, actor: JwtPayload, pin: string): Promise<{ approverName: string; self: boolean }> {
    if ((ROLE_LEVEL[actor.role as Role] ?? 99) <= MAX_LEVEL_SELF) return { approverName: actor.name ?? actor.email ?? '', self: true };
    const a = await this.findApprover(schema, actor, pin);
    if (!a) throw new ForbiddenException('PIN inválido: tem de ser o PIN de um supervisor ou gerente desta loja.');
    return { approverName: a.name, self: false };
  }

  /** Supervisor/gerente da loja (ou de nível regional/empresa) cujo PIN coincide. */
  private async findApprover(schema: string, actor: JwtPayload, pin: string): Promise<{ id: string; name: string } | null> {
    const roles = Object.values(Role).filter((r) => ROLE_LEVEL[r] <= MAX_LEVEL_SELF && r !== Role.SUPER_ADMIN);
    const storeId = actor.storeId ?? null;
    const candidates = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ id: string; name: string; pin_hash: string }[]>(
        Prisma.sql`SELECT id::text AS id, name, pin_hash FROM users
                   WHERE is_active = TRUE AND pin_hash IS NOT NULL AND id::text <> ${actor.sub}
                     AND role IN (${Prisma.join(roles)})
                     AND (${storeId}::uuid IS NULL OR store_id IS NULL OR store_id = ${storeId}::uuid OR role IN ('COMPANY_ADMIN','REGIONAL_MANAGER'))
                   ORDER BY role, name LIMIT 40`,
      ),
    );
    for (const c of candidates) {
      if (await this.passwords.verify(c.pin_hash, pin.trim())) return { id: c.id, name: c.name };
    }
    return null;
  }
}
