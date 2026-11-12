import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenancy/tenant-context';
import { AdminNotificationsService } from './admin-notifications';

/**
 * LPS Kwanza — confiança do comprador: avaliações com estrelas (só de quem comprou),
 * gostos/não gostos, reclamações, política de devolução de cada empresa e congelamento
 * do saldo de um associado pela empresa. Tabelas públicas (o marketplace é de todas as
 * empresas); a compra confirma-se nas encomendas da própria empresa.
 */
const T = (name: string) => Prisma.raw(`nexus_public."${name}"`);
const phoneNorm = (p: string) => String(p ?? '').replace(/[^\d+]/g, '').replace(/^\+?244/, '');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const DEFAULT_RETURN_DAYS = 7;
const KINDS = ['NOT_RECEIVED', 'DAMAGED', 'NOT_AS_DESCRIBED', 'REFUND', 'SELLER', 'OTHER'] as const;

interface Company { id: string; code: string; name: string; schemaName: string }

@Injectable()
export class KwanzaTrustService {
  constructor(private readonly prisma: PrismaService, private readonly notes: AdminNotificationsService) {}

  private async company(code: string): Promise<Company> {
    const c = await this.prisma.company.findUnique({ where: { code } });
    if (!c || c.status !== 'ACTIVE') throw new NotFoundException('Empresa não encontrada.');
    return { id: c.id, code: c.code, name: c.name, schemaName: c.schemaName };
  }

  /** O telefone comprou este produto (encomenda paga, enviada ou entregue)? */
  private async bought(c: Company, productCode: string, phone: string): Promise<boolean> {
    const tail = phone.slice(-9);
    if (tail.length < 9) return false;
    const r = await this.prisma.runInTenant(c.schemaName, (tx) => tx.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS n FROM web_orders o JOIN web_order_items i ON i.order_id = o.id
      WHERE i.product_code = ${productCode} AND o.status IN ('PAID','SHIPPED','DELIVERED')
        AND right(regexp_replace(COALESCE(o.customer_phone, ''), '[^0-9]', '', 'g'), 9) = ${tail}`)).catch(() => [{ n: 0 }]);
    return (r[0]?.n ?? 0) > 0;
  }

  async policy(companyId: string) {
    const r = await this.prisma.$queryRaw<{ returnDays: number; text: string | null }[]>(Prisma.sql`SELECT "returnDays", text FROM ${T('kwanza_policies')} WHERE "companyId" = ${companyId}::uuid`);
    return { returnDays: r[0]?.returnDays ?? DEFAULT_RETURN_DAYS, text: r[0]?.text ?? null };
  }

  async savePolicy(companyId: string, p: { returnDays: number; text?: string | null }) {
    const text = (p.text ?? '').trim().slice(0, 2000) || null;
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${T('kwanza_policies')} ("companyId", "returnDays", text, "updatedAt") VALUES (${companyId}::uuid, ${p.returnDays}, ${text}, now())
      ON CONFLICT ("companyId") DO UPDATE SET "returnDays" = EXCLUDED."returnDays", text = EXCLUDED.text, "updatedAt" = now()`);
    return this.policy(companyId);
  }

  /** Tudo o que a página do produto mostra: estrelas, avaliações, gostos e política de devolução. */
  async social(companyCode: string, productCode: string, device?: string) {
    const c = await this.company(companyCode);
    const [reviews, agg, react, mine, policy] = await Promise.all([
      this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT id, name, rating, comment, reply, "createdAt" FROM ${T('kwanza_reviews')} WHERE "companyId" = ${c.id}::uuid AND "productCode" = ${productCode} AND hidden = FALSE ORDER BY "createdAt" DESC LIMIT 100`),
      this.prisma.$queryRaw<{ rating: number; n: number }[]>(Prisma.sql`SELECT rating, COUNT(*)::int AS n FROM ${T('kwanza_reviews')} WHERE "companyId" = ${c.id}::uuid AND "productCode" = ${productCode} AND hidden = FALSE GROUP BY rating`),
      this.prisma.$queryRaw<{ value: number; n: number }[]>(Prisma.sql`SELECT value, COUNT(*)::int AS n FROM ${T('kwanza_reactions')} WHERE "companyId" = ${c.id}::uuid AND "productCode" = ${productCode} GROUP BY value`),
      device ? this.prisma.$queryRaw<{ value: number }[]>(Prisma.sql`SELECT value FROM ${T('kwanza_reactions')} WHERE "companyId" = ${c.id}::uuid AND "productCode" = ${productCode} AND device = ${device}`) : Promise.resolve([]),
      this.policy(c.id),
    ]);
    const count = agg.reduce((s, r) => s + r.n, 0);
    const stars: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of agg) stars[r.rating] = r.n;
    return {
      rating: count ? Math.round((agg.reduce((s, r) => s + r.rating * r.n, 0) / count) * 10) / 10 : 0, count, stars,
      likes: react.find((r) => r.value === 1)?.n ?? 0, dislikes: react.find((r) => r.value === -1)?.n ?? 0, mine: mine[0]?.value ?? 0,
      reviews: reviews.map((r) => ({ id: r.id, name: r.name, rating: r.rating, comment: r.comment, reply: r.reply, date: (r.createdAt as Date).toISOString() })),
      policy,
    };
  }

  async react(companyCode: string, productCode: string, device: string, value: number) {
    const c = await this.company(companyCode);
    if (!/^[A-Za-z0-9-]{16,64}$/.test(device)) throw new BadRequestException('Dispositivo inválido.');
    const ok = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM ${T('kwanza_listings')} WHERE "companyId" = ${c.id}::uuid AND "productCode" = ${productCode} AND active = TRUE`);
    if (!ok[0]?.n) throw new NotFoundException('Produto indisponível no marketplace.');
    if (value === 0) await this.prisma.$executeRaw(Prisma.sql`DELETE FROM ${T('kwanza_reactions')} WHERE "companyId" = ${c.id}::uuid AND "productCode" = ${productCode} AND device = ${device}`);
    else await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${T('kwanza_reactions')} (id, "companyId", "productCode", device, value, "createdAt") VALUES (gen_random_uuid(), ${c.id}::uuid, ${productCode}, ${device}, ${value}, now())
      ON CONFLICT ("companyId", "productCode", device) DO UPDATE SET value = EXCLUDED.value`);
    return this.social(companyCode, productCode, device);
  }

  /** Avaliação: só de quem comprou (telefone da encomenda); uma por telefone e produto (reenviar edita). */
  async review(companyCode: string, productCode: string, p: { name: string; phone: string; rating: number; comment?: string }) {
    const c = await this.company(companyCode);
    const phone = phoneNorm(p.phone);
    const name = p.name.trim();
    if (!name) throw new BadRequestException('Indique o seu nome.');
    if (!(await this.bought(c, productCode, phone))) throw new ForbiddenException('Só quem comprou este produto pode avaliar. Use o telefone da encomenda.');
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${T('kwanza_reviews')} (id, "companyId", "productCode", name, phone, rating, comment, hidden, "createdAt")
      VALUES (gen_random_uuid(), ${c.id}::uuid, ${productCode}, ${name.slice(0, 80)}, ${phone.slice(-9)}, ${p.rating}, ${(p.comment ?? '').trim().slice(0, 1000) || null}, FALSE, now())
      ON CONFLICT ("companyId", "productCode", phone) DO UPDATE SET name = EXCLUDED.name, rating = EXCLUDED.rating, comment = EXCLUDED.comment, "createdAt" = now()`);
    await this.notes.push(c.schemaName, { kind: 'KWANZA_REVIEW', title: `Nova avaliação: ${p.rating} estrela(s)`, body: `${name} · ${productCode}`, section: 'kwanza', ref: 'reviews' }).catch(() => undefined);
    return { ok: true as const };
  }

  async complain(p: { companyCode: string; productCode?: string; associateCode?: string; orderNumber?: string; name: string; phone: string; kind: string; body: string }) {
    const c = await this.company(p.companyCode);
    const phone = phoneNorm(p.phone);
    if (phone.replace(/\D/g, '').length < 9) throw new BadRequestException('Telefone inválido.');
    // No máximo 5 reclamações abertas por telefone e empresa (evita inundar a empresa).
    const open = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM ${T('kwanza_complaints')} WHERE "companyId" = ${c.id}::uuid AND phone = ${phone} AND status <> 'RESOLVED'`);
    if ((open[0]?.n ?? 0) >= 5) throw new BadRequestException('Já tem reclamações em aberto com esta empresa. Aguarde a resposta.');
    const code = genCode();
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${T('kwanza_complaints')} (id, code, "companyId", "productCode", "associateCode", "orderNumber", name, phone, kind, body, status, "createdAt")
      VALUES (gen_random_uuid(), ${code}, ${c.id}::uuid, ${p.productCode?.slice(0, 80) ?? null}, ${p.associateCode?.slice(0, 12) ?? null}, ${p.orderNumber?.trim().slice(0, 40) || null},
        ${p.name.trim().slice(0, 80)}, ${phone}, ${p.kind}, ${p.body.trim().slice(0, 2000)}, 'OPEN', now())`);
    await this.notes.push(c.schemaName, { kind: 'KWANZA_COMPLAINT', title: `Nova reclamação de ${p.name.trim().slice(0, 40)}`, body: p.body.trim().slice(0, 120), section: 'kwanza', ref: 'complaints' }).catch(() => undefined);
    return { ok: true as const, code };
  }

  /** O cliente acompanha a reclamação pelo código que recebeu (sem sessão). */
  async track(code: string) {
    const r = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT k.code, k.kind, k.body, k.status, k.reply, k."createdAt", k."repliedAt", c.name AS company
      FROM ${T('kwanza_complaints')} k JOIN nexus_public.companies c ON c.id = k."companyId" WHERE k.code = ${code.trim().toUpperCase()}`);
    if (!r[0]) throw new NotFoundException('Reclamação não encontrada.');
    const x = r[0];
    return { code: x.code, kind: x.kind, body: x.body, status: x.status, reply: x.reply, company: x.company, date: (x.createdAt as Date).toISOString(), repliedAt: x.repliedAt ? (x.repliedAt as Date).toISOString() : null };
  }

  /* ── painel da empresa ── */
  async companyComplaints(companyId: string) {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT k.*, l.name AS product, a.name AS associate FROM ${T('kwanza_complaints')} k
      LEFT JOIN ${T('kwanza_listings')} l ON l."companyId" = k."companyId" AND l."productCode" = k."productCode"
      LEFT JOIN ${T('kwanza_associates')} a ON a.code = k."associateCode"
      WHERE k."companyId" = ${companyId}::uuid ORDER BY (k.status = 'RESOLVED'), k."createdAt" DESC LIMIT 500`);
    return rows.map((k) => ({ id: k.id, code: k.code, kind: k.kind, body: k.body, status: k.status, reply: k.reply, name: k.name, phone: k.phone, orderNumber: k.orderNumber, productCode: k.productCode, product: k.product, associateCode: k.associateCode, associate: k.associate, date: (k.createdAt as Date).toISOString() }));
  }

  async answerComplaint(companyId: string, id: string, p: { reply?: string; status?: 'OPEN' | 'ANSWERED' | 'RESOLVED' }) {
    const reply = p.reply === undefined ? undefined : p.reply.trim().slice(0, 2000) || null;
    const status = p.status ?? (reply ? 'ANSWERED' : undefined);
    const n = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE ${T('kwanza_complaints')} SET
        reply = CASE WHEN ${reply !== undefined} THEN ${reply ?? null} ELSE reply END,
        "repliedAt" = CASE WHEN ${reply !== undefined && reply !== null} THEN now() ELSE "repliedAt" END,
        status = COALESCE(${status ?? null}, status)
      WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid`);
    if (!n) throw new NotFoundException('Reclamação não encontrada.');
    return { ok: true as const };
  }

  async companyReviews(companyId: string) {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT r.id, r."productCode", r.name, r.phone, r.rating, r.comment, r.reply, r.hidden, r."createdAt", l.name AS product
      FROM ${T('kwanza_reviews')} r LEFT JOIN ${T('kwanza_listings')} l ON l."companyId" = r."companyId" AND l."productCode" = r."productCode"
      WHERE r."companyId" = ${companyId}::uuid ORDER BY r."createdAt" DESC LIMIT 500`);
    return rows.map((r) => ({ id: r.id, productCode: r.productCode, product: r.product, name: r.name, phone: r.phone, rating: r.rating, comment: r.comment, reply: r.reply, hidden: r.hidden, date: (r.createdAt as Date).toISOString() }));
  }

  async moderateReview(companyId: string, id: string, p: { hidden?: boolean; reply?: string }) {
    const reply = p.reply === undefined ? undefined : p.reply.trim().slice(0, 1000) || null;
    const n = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE ${T('kwanza_reviews')} SET hidden = COALESCE(${p.hidden ?? null}::boolean, hidden), reply = CASE WHEN ${reply !== undefined} THEN ${reply ?? null} ELSE reply END
      WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid`);
    if (!n) throw new NotFoundException('Avaliação não encontrada.');
    return { ok: true as const };
  }

  /* ── congelar o saldo de um associado nesta empresa ── */
  async freezes(companyId: string) {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT "associateId"::text AS id, reason, "createdAt" FROM ${T('kwanza_freezes')} WHERE "companyId" = ${companyId}::uuid`);
    return rows.map((r) => ({ associateId: r.id, reason: r.reason, date: (r.createdAt as Date).toISOString() }));
  }

  async freeze(companyId: string, schema: string, associateId: string, reason: string, by: string) {
    // Só um associado que vende (ou vendeu) para esta empresa.
    const rel = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM ${T('kwanza_affiliations')} WHERE "companyId" = ${companyId}::uuid AND "associateId" = ${associateId}::uuid`);
    if (!rel[0]?.n) throw new NotFoundException('Associado não encontrado nesta empresa.');
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${T('kwanza_freezes')} ("companyId", "associateId", reason, "createdBy", "createdAt") VALUES (${companyId}::uuid, ${associateId}::uuid, ${reason.trim().slice(0, 300)}, ${by.slice(0, 120)}, now())
      ON CONFLICT ("companyId", "associateId") DO UPDATE SET reason = EXCLUDED.reason, "createdBy" = EXCLUDED."createdBy", "createdAt" = now()`);
    const c = await this.prisma.company.findUnique({ where: { id: companyId } });
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${T('kwanza_notifications')} (id, "associateId", kind, title, body, link, "createdAt")
      VALUES (gen_random_uuid(), ${associateId}::uuid, 'FREEZE', ${`Saldo congelado por ${c?.name ?? 'uma empresa'}`}, ${reason.trim().slice(0, 300)}, '#/withdraw', now())`).catch(() => undefined);
    void schema;
    return { ok: true as const };
  }

  async unfreeze(companyId: string, associateId: string) {
    const n = await this.prisma.$executeRaw(Prisma.sql`DELETE FROM ${T('kwanza_freezes')} WHERE "companyId" = ${companyId}::uuid AND "associateId" = ${associateId}::uuid`);
    if (n) {
      const c = await this.prisma.company.findUnique({ where: { id: companyId } });
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO ${T('kwanza_notifications')} (id, "associateId", kind, title, link, "createdAt")
        VALUES (gen_random_uuid(), ${associateId}::uuid, 'FREEZE', ${`Saldo descongelado por ${c?.name ?? 'uma empresa'}`}, '#/withdraw', now())`).catch(() => undefined);
    }
    return { ok: true as const };
  }

  /** Empresas (códigos) onde o saldo do associado está congelado, com o motivo. */
  async frozenFor(associateId: string): Promise<Record<string, string>> {
    const rows = await this.prisma.$queryRaw<{ code: string; reason: string }[]>(Prisma.sql`
      SELECT c.code, f.reason FROM ${T('kwanza_freezes')} f JOIN nexus_public.companies c ON c.id = f."companyId" WHERE f."associateId" = ${associateId}::uuid`);
    return Object.fromEntries(rows.map((r) => [r.code, r.reason]));
  }
}

/* ── DTO ── */
class ReactDto { @IsString() @MaxLength(64) device!: string; @Type(() => Number) @IsInt() @Min(-1) @Max(1) value!: number; }
class ReviewDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string; @IsString() @MaxLength(20) phone!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(5) rating!: number; @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}
class ComplaintDto {
  @IsString() @MaxLength(60) companyCode!: string; @IsOptional() @IsString() @MaxLength(80) productCode?: string; @IsOptional() @IsString() @MaxLength(12) associateCode?: string;
  @IsOptional() @IsString() @MaxLength(40) orderNumber?: string; @IsString() @MinLength(2) @MaxLength(80) name!: string; @IsString() @MaxLength(20) phone!: string;
  @IsIn(KINDS as unknown as string[]) kind!: string; @IsString() @MinLength(10) @MaxLength(2000) body!: string;
}
class AnswerDto { @IsOptional() @IsString() @MaxLength(2000) reply?: string; @IsOptional() @IsIn(['OPEN', 'ANSWERED', 'RESOLVED']) status?: 'OPEN' | 'ANSWERED' | 'RESOLVED'; }
class ModerateDto { @IsOptional() @IsBoolean() hidden?: boolean; @IsOptional() @IsString() @MaxLength(1000) reply?: string; }
class PolicyDto { @Type(() => Number) @IsInt() @Min(0) @Max(90) returnDays!: number; @IsOptional() @IsString() @MaxLength(2000) text?: string | null; }
class FreezeDto { @IsString() @MinLength(3) @MaxLength(300) reason!: string; }

@ApiTags('kwanza')
@Public()
@Controller('kwanza')
export class KwanzaTrustPublicController {
  constructor(private readonly t: KwanzaTrustService) {}
  @Get('social/:companyCode/:productCode') @ApiOperation({ summary: 'Estrelas, avaliações, gostos e política de devolução do produto' })
  social(@Param('companyCode') c: string, @Param('productCode') p: string, @Query('device') device?: string) { return this.t.social(c, p, device); }
  @Post('social/:companyCode/:productCode/react') @ApiOperation({ summary: 'Gosto / não gosto (um por dispositivo)' })
  react(@Param('companyCode') c: string, @Param('productCode') p: string, @Body() d: ReactDto) { return this.t.react(c, p, d.device, d.value); }
  @Post('social/:companyCode/:productCode/review') @ApiOperation({ summary: 'Avaliar um produto comprado' })
  review(@Param('companyCode') c: string, @Param('productCode') p: string, @Body() d: ReviewDto) { return this.t.review(c, p, d); }
  @Post('complaints') @ApiOperation({ summary: 'Abrir uma reclamação' })
  complain(@Body() d: ComplaintDto) { return this.t.complain(d); }
  @Get('complaints/:code') @ApiOperation({ summary: 'Acompanhar uma reclamação pelo código' })
  track(@Param('code') code: string) { return this.t.track(code); }
}

@ApiTags('kwanza')
@Controller('ecommerce/kwanza')
export class KwanzaTrustAdminController {
  constructor(private readonly t: KwanzaTrustService, private readonly ctx: TenantContext, private readonly prisma: PrismaService) {}
  private async tenant() {
    const schema = this.ctx.requireTenantSchema();
    const c = await this.prisma.company.findUnique({ where: { schemaName: schema } });
    return { companyId: c!.id, schema };
  }
  @Get('complaints') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Reclamações dos clientes' })
  async complaints() { return this.t.companyComplaints((await this.tenant()).companyId); }
  @Patch('complaints/:id') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Responde ou resolve uma reclamação' })
  async answer(@Param('id') id: string, @Body() d: AnswerDto) { return this.t.answerComplaint((await this.tenant()).companyId, id, d); }
  @Get('reviews') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Avaliações dos produtos' })
  async reviews() { return this.t.companyReviews((await this.tenant()).companyId); }
  @Patch('reviews/:id') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Oculta ou responde a uma avaliação' })
  async moderate(@Param('id') id: string, @Body() d: ModerateDto) { return this.t.moderateReview((await this.tenant()).companyId, id, d); }
  @Get('policy') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Política de devolução da empresa' })
  async policy() { return this.t.policy((await this.tenant()).companyId); }
  @Put('policy') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Define a política de devolução' })
  async savePolicy(@Body() d: PolicyDto) { return this.t.savePolicy((await this.tenant()).companyId, d); }
  @Get('freezes') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Associados com o saldo congelado' })
  async freezes() { return this.t.freezes((await this.tenant()).companyId); }
  @Post('associates/:id/freeze') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Congela o saldo de um associado' })
  async freeze(@Param('id') id: string, @Body() d: FreezeDto) { const t = await this.tenant(); return this.t.freeze(t.companyId, t.schema, id, d.reason, 'Empresa'); }
  @Post('associates/:id/unfreeze') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Descongela o saldo de um associado' })
  async unfreeze(@Param('id') id: string) { return this.t.unfreeze((await this.tenant()).companyId, id); }
}
