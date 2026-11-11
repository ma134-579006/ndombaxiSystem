import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomInt } from 'node:crypto';
import { MailService } from '../common/mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorefrontService } from './storefront.service';
import { SOLD_STATUSES } from './affiliates.service';

/**
 * LPS KWANZA — marketplace central de associados (todas as empresas que aderirem).
 *  • Cada empresa publica, no seu painel LPS Vendas, os produtos para associados: % de comissão,
 *    afiliação aberta ou restrita (aprovação), "venda no teu preço" e materiais de divulgação.
 *  • O associado tem uma conta global (telefone + senha), escolhe produtos de qualquer empresa e
 *    partilha a ligação: o cliente compra na loja da empresa (entrega pela equipa dela, com GPS).
 *  • A comissão é registada quando a encomenda é criada; fica disponível quando a empresa marca a
 *    encomenda como vendida (paga) e o saque é pedido a cada empresa, que o paga e anexa o comprovativo.
 */
const T = (name: string) => Prisma.raw(`nexus_public."${name}"`);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const num = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const phoneNorm = (p: string) => p.replace(/[^\d+]/g, '').replace(/^\+?244/, '');

export interface KwanzaClaims { sub: string; typ: 'kwanza'; name: string }
export interface AssociateRow {
  id: string; name: string; phone: string; email: string | null; code: string; photoUrl: string | null; taxId: string | null;
  province: string | null; municipality: string | null; address: string | null; bio: string | null; status: string; createdAt: Date;
}
export interface ListingInput { published: boolean; percent?: number | null; mode?: 'OPEN' | 'RESTRICTED'; allowMarkup?: boolean; maxMarkupPct?: number | null; materials?: string[] }

@Injectable()
export class KwanzaService implements OnModuleInit {
  private readonly log = new Logger('LPS Kwanza');
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly storefront: StorefrontService,
  ) {}

  /** Mantém os preços/stock do marketplace alinhados com as lojas (a cada 10 min). */
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const t = setInterval(() => { void this.syncAll().catch((e) => this.log.warn(`sync: ${(e as Error).message}`)); }, 10 * 60_000);
    t.unref?.();
  }

  private get secret(): string { return `${this.config.get('JWT_ACCESS_SECRET')}::kwanza`; }
  private sign(a: { id: string; name: string }) {
    return this.jwt.signAsync({ sub: a.id, typ: 'kwanza', name: a.name }, { secret: this.secret, expiresIn: '30d' });
  }
  private publicAssociate(a: AssociateRow) {
    return { id: a.id, name: a.name, phone: a.phone, email: a.email, code: a.code, photoUrl: a.photoUrl, taxId: a.taxId, province: a.province, municipality: a.municipality, address: a.address, bio: a.bio, createdAt: a.createdAt };
  }

  /* ═══════════════ contas de associado ═══════════════ */
  async register(p: { name: string; phone: string; email?: string; password: string }) {
    const name = (p.name ?? '').trim().slice(0, 120);
    const phone = phoneNorm(p.phone ?? '');
    const email = (p.email ?? '').trim().toLowerCase() || null;
    if (name.length < 3) throw new BadRequestException('Indique o seu nome.');
    if (!/^9\d{8}$/.test(phone)) throw new BadRequestException('Telefone inválido (9 dígitos, começa por 9).');
    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestException('Email inválido.');
    if ((p.password ?? '').length < 6) throw new BadRequestException('A senha tem de ter pelo menos 6 caracteres.');
    const dup = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT 1 AS n FROM ${T('kwanza_associates')} WHERE phone = ${phone} OR (${email}::text IS NOT NULL AND email = ${email}) LIMIT 1`);
    if (dup.length) throw new ConflictException('Já existe uma conta com este telefone ou email. Entre ou recupere a senha.');
    const hash = await argon2.hash(p.password);
    for (let i = 0; i < 8; i++) {
      const code = genCode();
      try {
        const rows = await this.prisma.$queryRaw<AssociateRow[]>(Prisma.sql`
          INSERT INTO ${T('kwanza_associates')} (id, name, phone, email, "passwordHash", code, status, "createdAt", "updatedAt")
          VALUES (gen_random_uuid(), ${name}, ${phone}, ${email}, ${hash}, ${code}, 'ACTIVE', now(), now())
          RETURNING id, name, phone, email, code, "photoUrl", "taxId", province, municipality, address, bio, status, "createdAt"`);
        return { token: await this.sign(rows[0]), associate: this.publicAssociate(rows[0]) };
      } catch (e) { if (!String((e as Error).message).includes('code')) throw e; }
    }
    throw new BadRequestException('Não foi possível criar a conta. Tente de novo.');
  }

  async login(p: { login: string; password: string }) {
    const l = (p.login ?? '').trim().toLowerCase();
    const phone = phoneNorm(l);
    const rows = await this.prisma.$queryRaw<(AssociateRow & { passwordHash: string })[]>(Prisma.sql`
      SELECT id, name, phone, email, code, "photoUrl", "taxId", province, municipality, address, bio, status, "createdAt", "passwordHash"
      FROM ${T('kwanza_associates')} WHERE phone = ${phone} OR email = ${l} LIMIT 1`);
    const a = rows[0];
    if (!a || !(await argon2.verify(a.passwordHash, p.password ?? '').catch(() => false))) throw new UnauthorizedException('Telefone/email ou senha errados.');
    if (a.status !== 'ACTIVE') throw new UnauthorizedException('Conta bloqueada. Contacte o suporte.');
    return { token: await this.sign(a), associate: this.publicAssociate(a) };
  }

  async verify(auth?: string): Promise<AssociateRow> {
    const token = (auth ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('Sessão em falta.');
    let c: KwanzaClaims;
    try { c = await this.jwt.verifyAsync<KwanzaClaims>(token, { secret: this.secret }); } catch { throw new UnauthorizedException('Sessão expirada. Entre de novo.'); }
    if (c.typ !== 'kwanza') throw new UnauthorizedException('Sessão inválida.');
    const rows = await this.prisma.$queryRaw<AssociateRow[]>(Prisma.sql`
      SELECT id, name, phone, email, code, "photoUrl", "taxId", province, municipality, address, bio, status, "createdAt" FROM ${T('kwanza_associates')} WHERE id = ${c.sub}::uuid`);
    if (!rows[0] || rows[0].status !== 'ACTIVE') throw new UnauthorizedException('Conta indisponível.');
    return rows[0];
  }

  async me(a: AssociateRow) { return this.publicAssociate(a); }

  async updateProfile(a: AssociateRow, p: Partial<Pick<AssociateRow, 'name' | 'email' | 'photoUrl' | 'taxId' | 'province' | 'municipality' | 'address' | 'bio'>>) {
    const clip = (v: unknown, n: number) => (v === undefined ? undefined : (String(v ?? '').trim().slice(0, n) || null));
    const email = p.email === undefined ? undefined : (String(p.email ?? '').trim().toLowerCase() || null);
    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new BadRequestException('Email inválido.');
    if (email) {
      const d = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT 1 AS n FROM ${T('kwanza_associates')} WHERE email = ${email} AND id <> ${a.id}::uuid`);
      if (d.length) throw new ConflictException('Este email já está noutra conta.');
    }
    const name = clip(p.name, 120);
    if (name === null) throw new BadRequestException('O nome não pode ficar vazio.');
    const photo = p.photoUrl === undefined ? undefined : (p.photoUrl ? String(p.photoUrl).slice(0, 1_500_000) : null);
    const rows = await this.prisma.$queryRaw<AssociateRow[]>(Prisma.sql`
      UPDATE ${T('kwanza_associates')} SET
        name = COALESCE(${name ?? null}, name),
        email = CASE WHEN ${email !== undefined} THEN ${email ?? null} ELSE email END,
        "photoUrl" = CASE WHEN ${photo !== undefined} THEN ${photo ?? null} ELSE "photoUrl" END,
        "taxId" = CASE WHEN ${p.taxId !== undefined} THEN ${clip(p.taxId, 20) ?? null} ELSE "taxId" END,
        province = CASE WHEN ${p.province !== undefined} THEN ${clip(p.province, 60) ?? null} ELSE province END,
        municipality = CASE WHEN ${p.municipality !== undefined} THEN ${clip(p.municipality, 60) ?? null} ELSE municipality END,
        address = CASE WHEN ${p.address !== undefined} THEN ${clip(p.address, 200) ?? null} ELSE address END,
        bio = CASE WHEN ${p.bio !== undefined} THEN ${clip(p.bio, 400) ?? null} ELSE bio END,
        "updatedAt" = now()
      WHERE id = ${a.id}::uuid
      RETURNING id, name, phone, email, code, "photoUrl", "taxId", province, municipality, address, bio, status, "createdAt"`);
    return this.publicAssociate(rows[0]);
  }

  async changePassword(a: AssociateRow, current: string, next: string) {
    const rows = await this.prisma.$queryRaw<{ h: string }[]>(Prisma.sql`SELECT "passwordHash" AS h FROM ${T('kwanza_associates')} WHERE id = ${a.id}::uuid`);
    if (!(await argon2.verify(rows[0].h, current ?? '').catch(() => false))) throw new BadRequestException('A senha atual está errada.');
    if ((next ?? '').length < 6) throw new BadRequestException('A nova senha tem de ter pelo menos 6 caracteres.');
    await this.prisma.$executeRaw(Prisma.sql`UPDATE ${T('kwanza_associates')} SET "passwordHash" = ${await argon2.hash(next)}, "updatedAt" = now() WHERE id = ${a.id}::uuid`);
    return { ok: true as const };
  }

  /** Recuperar a senha: código de 6 dígitos por email (a conta tem de ter email). */
  async recoverRequest(login: string) {
    const l = (login ?? '').trim().toLowerCase();
    const rows = await this.prisma.$queryRaw<{ id: string; email: string | null }[]>(Prisma.sql`SELECT id, email FROM ${T('kwanza_associates')} WHERE phone = ${phoneNorm(l)} OR email = ${l} LIMIT 1`);
    const a = rows[0];
    // Resposta igual exista ou não a conta (não revela quem está registado).
    if (!a || !a.email) return { sent: true as const, viaEmail: false };
    if (!(await this.mail.isEnabled().catch(() => false))) throw new BadRequestException('A recuperação por email não está disponível de momento. Contacte o suporte.');
    const code = String(randomInt(100000, 1000000));
    await this.prisma.$executeRaw(Prisma.sql`UPDATE ${T('kwanza_password_resets')} SET "usedAt" = now() WHERE "associateId" = ${a.id}::uuid AND "usedAt" IS NULL`);
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${T('kwanza_password_resets')} (id, "associateId", "codeHash", attempts, "expiresAt", "createdAt")
      VALUES (gen_random_uuid(), ${a.id}::uuid, ${sha(code)}, 0, now() + interval '15 minutes', now())`);
    await this.mail.send(a.email, 'LPS Kwanza — código para recuperar a senha', `O seu código é: ${code}\n\nVálido durante 15 minutos. Se não pediu, ignore este email.`);
    return { sent: true as const, viaEmail: true };
  }

  async recoverConfirm(login: string, code: string, password: string) {
    if ((password ?? '').length < 6) throw new BadRequestException('A nova senha tem de ter pelo menos 6 caracteres.');
    const l = (login ?? '').trim().toLowerCase();
    const acc = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM ${T('kwanza_associates')} WHERE phone = ${phoneNorm(l)} OR email = ${l} LIMIT 1`);
    if (!acc[0]) throw new BadRequestException('Código inválido ou expirado.');
    const rs = await this.prisma.$queryRaw<{ id: string; h: string; attempts: number }[]>(Prisma.sql`
      SELECT id, "codeHash" AS h, attempts FROM ${T('kwanza_password_resets')}
      WHERE "associateId" = ${acc[0].id}::uuid AND "usedAt" IS NULL AND "expiresAt" > now() ORDER BY "createdAt" DESC LIMIT 1`);
    const r = rs[0];
    if (!r || r.attempts >= 5) throw new BadRequestException('Código inválido ou expirado.');
    if (r.h !== sha((code ?? '').trim())) {
      await this.prisma.$executeRaw(Prisma.sql`UPDATE ${T('kwanza_password_resets')} SET attempts = attempts + 1 WHERE id = ${r.id}::uuid`);
      throw new BadRequestException('Código inválido ou expirado.');
    }
    await this.prisma.$executeRaw(Prisma.sql`UPDATE ${T('kwanza_password_resets')} SET "usedAt" = now() WHERE id = ${r.id}::uuid`);
    await this.prisma.$executeRaw(Prisma.sql`UPDATE ${T('kwanza_associates')} SET "passwordHash" = ${await argon2.hash(password)}, "updatedAt" = now() WHERE id = ${acc[0].id}::uuid`);
    return { ok: true as const };
  }

  /* ═══════════════ mercado ═══════════════ */
  async market() {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT "companyCode", "companyName", "productCode", name, description, "imageUrl", gallery, category, "grossPrice", "listPrice", "inStock",
             "commissionPct", affiliation, "allowMarkup", "maxMarkupPct", materials, views, sold
      FROM ${T('kwanza_listings')} l
      WHERE active = TRUE AND EXISTS (SELECT 1 FROM nexus_public.companies c WHERE c.id = l."companyId" AND c.status = 'ACTIVE')
      ORDER BY sold DESC, views DESC LIMIT 2000`);
    return rows.map((r) => ({
      companyCode: r.companyCode, companyName: r.companyName, productCode: r.productCode, name: r.name, description: r.description,
      imageUrl: r.imageUrl, gallery: Array.isArray(r.gallery) ? r.gallery : [], category: r.category, grossPrice: num(r.grossPrice),
      listPrice: r.listPrice == null ? null : num(r.listPrice), inStock: !!r.inStock, commissionPct: num(r.commissionPct),
      affiliation: r.affiliation, allowMarkup: !!r.allowMarkup, maxMarkupPct: r.maxMarkupPct == null ? null : num(r.maxMarkupPct),
      materials: Array.isArray(r.materials) ? r.materials : [], views: num(r.views), sold: num(r.sold),
    }));
  }

  async view(companyCode: string, productCode: string) {
    await this.prisma.$executeRaw(Prisma.sql`UPDATE ${T('kwanza_listings')} SET views = views + 1 WHERE "companyCode" = ${companyCode} AND "productCode" = ${productCode}`);
    const c = await this.prisma.company.findUnique({ where: { code: companyCode } });
    if (c) await this.storefront.countView(c.schemaName, productCode).catch(() => undefined);
    return { ok: true as const };
  }

  private async listingOf(companyCode: string, productCode: string) {
    const r = await this.prisma.$queryRaw<{ companyId: string; affiliation: string; allowMarkup: boolean; maxMarkupPct: unknown; commissionPct: unknown }[]>(Prisma.sql`
      SELECT "companyId", affiliation, "allowMarkup", "maxMarkupPct", "commissionPct" FROM ${T('kwanza_listings')}
      WHERE "companyCode" = ${companyCode} AND "productCode" = ${productCode} AND active = TRUE`);
    if (!r[0]) throw new NotFoundException('Produto indisponível no marketplace.');
    return r[0];
  }

  /* ═══════════════ afiliações (associar-me / pedidos) ═══════════════ */
  async affiliate(a: AssociateRow, companyCode: string, productCode: string, note?: string) {
    const l = await this.listingOf(companyCode, productCode);
    const status = l.affiliation === 'RESTRICTED' ? 'PENDING' : 'APPROVED';
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${T('kwanza_affiliations')} (id, "associateId", "companyId", "productCode", status, note, "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${a.id}::uuid, ${l.companyId}::uuid, ${productCode}, ${status}, ${(note ?? '').slice(0, 300) || null}, now(), now())
      ON CONFLICT ("associateId", "companyId", "productCode") DO UPDATE SET
        status = CASE WHEN ${T('kwanza_affiliations')}.status = 'APPROVED' THEN 'APPROVED' ELSE EXCLUDED.status END,
        note = COALESCE(EXCLUDED.note, ${T('kwanza_affiliations')}.note), "updatedAt" = now()`);
    return { status };
  }

  async setMarkup(a: AssociateRow, companyCode: string, productCode: string, markupPct: number | null) {
    const l = await this.listingOf(companyCode, productCode);
    if (!l.allowMarkup) throw new BadRequestException('Esta empresa não permite preço próprio neste produto.');
    const max = l.maxMarkupPct == null ? 100 : num(l.maxMarkupPct);
    const m = markupPct == null || markupPct <= 0 ? null : Math.min(max, r2(markupPct));
    const n = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE ${T('kwanza_affiliations')} SET "markupPct" = ${m}, "updatedAt" = now()
      WHERE "associateId" = ${a.id}::uuid AND "companyId" = ${l.companyId}::uuid AND "productCode" = ${productCode} AND status = 'APPROVED'`);
    if (!n) throw new BadRequestException('Associe-se primeiro a este produto.');
    return { markupPct: m };
  }

  async myAffiliations(a: AssociateRow) {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT f.id, f.status, f."productCode", f."commissionPct" AS "ownPct", f."markupPct", f.note, l."companyCode", l."companyName", l.name, l."imageUrl",
             l."grossPrice", l."commissionPct", l.affiliation, l."allowMarkup", l."maxMarkupPct"
      FROM ${T('kwanza_affiliations')} f JOIN ${T('kwanza_listings')} l ON l."companyId" = f."companyId" AND l."productCode" = f."productCode"
      WHERE f."associateId" = ${a.id}::uuid ORDER BY f."updatedAt" DESC`);
    return rows.map((r) => ({
      id: r.id, status: r.status, companyCode: r.companyCode, companyName: r.companyName, productCode: r.productCode, name: r.name, imageUrl: r.imageUrl,
      grossPrice: num(r.grossPrice), commissionPct: r.ownPct == null ? num(r.commissionPct) : num(r.ownPct), negotiated: r.ownPct != null,
      markupPct: r.markupPct == null ? null : num(r.markupPct), affiliation: r.affiliation, allowMarkup: !!r.allowMarkup,
      maxMarkupPct: r.maxMarkupPct == null ? null : num(r.maxMarkupPct),
    }));
  }

  /** Preço próprio aprovado do associado (só produtos publicados que o permitem): { códigoProduto: % }. */
  async markupsFor(companyId: string, rawCode: string | undefined): Promise<Record<string, number>> {
    const code = (rawCode ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return {};
    const rows = await this.prisma.$queryRaw<{ p: string; mk: unknown; max: unknown }[]>(Prisma.sql`
      SELECT f."productCode" AS p, f."markupPct" AS mk, l."maxMarkupPct" AS max
      FROM ${T('kwanza_affiliations')} f
      JOIN ${T('kwanza_associates')} a ON a.id = f."associateId" AND a.code = ${code} AND a.status = 'ACTIVE'
      JOIN ${T('kwanza_listings')} l ON l."companyId" = f."companyId" AND l."productCode" = f."productCode" AND l.active = TRUE AND l."allowMarkup" = TRUE
      WHERE f."companyId" = ${companyId}::uuid AND f.status = 'APPROVED' AND f."markupPct" > 0`);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.p] = Math.min(num(r.mk), r.max == null ? 100 : num(r.max));
    return out;
  }

  /* ═══════════════ atribuição na encomenda (chamada pelo checkout de cada loja) ═══════════════ */
  async attribute(tenant: { companyId: string; schema: string }, companyCode: string, orderId: string, rawCode: string | undefined, buyerEmail: string | null, markups: Record<string, number> = {}) {
    const code = (rawCode ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return;
    // Código de um associado da própria loja: já tratado pelo programa da loja (sem comissão a dobrar).
    const local = await this.prisma.runInTenant(tenant.schema, (tx) => tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT 1 AS n FROM customers WHERE affiliate_code = ${code} LIMIT 1`)).catch(() => []);
    if (local.length) return;
    const as = await this.prisma.$queryRaw<{ id: string; email: string | null; status: string }[]>(Prisma.sql`SELECT id, email, status FROM ${T('kwanza_associates')} WHERE code = ${code}`);
    const a = as[0];
    if (!a || a.status !== 'ACTIVE') return;
    if (buyerEmail && a.email && buyerEmail.toLowerCase() === a.email) return; // sem comissão das próprias compras
    const items = await this.prisma.runInTenant(tenant.schema, (tx) => tx.$queryRaw<{ code: string; name: string; q: unknown; g: unknown; n: string }[]>(Prisma.sql`
      SELECT wi.product_code AS code, wi.description AS name, wi.quantity AS q, wi.gross_amount AS g, wo.order_number AS n
      FROM web_order_items wi JOIN web_orders wo ON wo.id = wi.order_id WHERE wi.order_id = ${orderId}::uuid`));
    let any = false;
    for (const it of items) {
      const ls = await this.prisma.$queryRaw<{ pct: unknown; aff: string }[]>(Prisma.sql`
        SELECT "commissionPct" AS pct, affiliation AS aff FROM ${T('kwanza_listings')} WHERE "companyId" = ${tenant.companyId}::uuid AND "productCode" = ${it.code} AND active = TRUE`);
      const l = ls[0];
      if (!l) continue;
      const fs = await this.prisma.$queryRaw<{ status: string; pct: unknown; mk: unknown }[]>(Prisma.sql`
        SELECT status, "commissionPct" AS pct, "markupPct" AS mk FROM ${T('kwanza_affiliations')}
        WHERE "associateId" = ${a.id}::uuid AND "companyId" = ${tenant.companyId}::uuid AND "productCode" = ${it.code}`);
      const f = fs[0];
      // Restrita: só com afiliação aprovada pela empresa. Aberta: basta a ligação.
      if (l.aff === 'RESTRICTED' && f?.status !== 'APPROVED') continue;
      if (f && f.status === 'REJECTED') continue;
      const pct = f?.pct == null ? num(l.pct) : num(f.pct);
      if (pct <= 0) continue;
      // Com preço próprio, a linha já vem com o acréscimo: a comissão é sobre o preço base
      // e o acréscimo inteiro fica para o associado.
      const mk = markups[it.code] ?? 0;
      const gross = num(it.g);
      const base = mk > 0 ? r2(gross / (1 + mk / 100)) : gross;
      const markupAmount = r2(gross - base);
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO ${T('kwanza_commissions')} (id, "associateId", "companyId", "companyCode", "orderId", "orderNumber", "productCode", "productName", quantity, "baseAmount", percent, amount, "markupAmount", "createdAt")
        VALUES (gen_random_uuid(), ${a.id}::uuid, ${tenant.companyId}::uuid, ${companyCode}, ${orderId}::uuid, ${it.n}, ${it.code}, ${it.name}, ${num(it.q)}, ${base}, ${pct}, ${r2((base * pct) / 100 + markupAmount)}, ${markupAmount}, now())
        ON CONFLICT ("companyId", "orderId", "productCode") DO NOTHING`);
      await this.prisma.$executeRaw(Prisma.sql`UPDATE ${T('kwanza_listings')} SET sold = sold + ${Math.max(1, Math.round(num(it.q)))} WHERE "companyId" = ${tenant.companyId}::uuid AND "productCode" = ${it.code}`);
      any = true;
    }
    if (any) await this.prisma.runInTenant(tenant.schema, (tx) => tx.$executeRaw(Prisma.sql`UPDATE web_orders SET affiliate_code = ${code} WHERE id = ${orderId}::uuid AND affiliate_code IS NULL`)).catch(() => undefined);
  }

  /* ═══════════════ painel do associado (todas as empresas) ═══════════════ */
  async dashboard(a: AssociateRow) {
    const cs = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT k."companyId", k."companyCode", c.name AS "companyName", c."schemaName", k."orderId", k."orderNumber", k."productName", k.quantity, k.amount, k."createdAt"
      FROM ${T('kwanza_commissions')} k JOIN nexus_public.companies c ON c.id = k."companyId"
      WHERE k."associateId" = ${a.id}::uuid ORDER BY k."createdAt" DESC LIMIT 1000`);
    // Estado de cada encomenda lido na loja da empresa (fonte de verdade).
    const bySchema = new Map<string, string[]>();
    for (const c of cs) { const s = String(c.schemaName); bySchema.set(s, [...(bySchema.get(s) ?? []), String(c.orderId)]); }
    const status = new Map<string, string>();
    for (const [schema, ids] of bySchema) {
      const rows = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<{ id: string; status: string }[]>(Prisma.sql`SELECT id::text, status FROM web_orders WHERE id = ANY(${ids}::uuid[])`)).catch(() => []);
      for (const r of rows) status.set(r.id, r.status);
    }
    const wd = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT w.id, w."companyId", c.code AS "companyCode", c.name AS "companyName", w.amount, w.method, w.details, w.status, w.note, w."proofUrl", w."createdAt"
      FROM ${T('kwanza_withdrawals')} w JOIN nexus_public.companies c ON c.id = w."companyId" WHERE w."associateId" = ${a.id}::uuid ORDER BY w."createdAt" DESC LIMIT 300`);
    const perCompany = new Map<string, { companyId: string; companyCode: string; companyName: string; pending: number; available: number; withdrawn: number; requested: number; balance: number }>();
    const company = (id: string, code: string, name: string) => {
      if (!perCompany.has(id)) perCompany.set(id, { companyId: id, companyCode: code, companyName: name, pending: 0, available: 0, withdrawn: 0, requested: 0, balance: 0 });
      return perCompany.get(id)!;
    };
    const sales = cs.map((c) => {
      const st = status.get(String(c.orderId)) ?? 'PENDING';
      const state = SOLD_STATUSES.includes(st) ? 'AVAILABLE' : st === 'CANCELLED' ? 'CANCELLED' : 'PENDING';
      const pc = company(String(c.companyId), String(c.companyCode), String(c.companyName));
      if (state === 'PENDING') pc.pending += num(c.amount);
      if (state === 'AVAILABLE') pc.available += num(c.amount);
      return { companyCode: c.companyCode, companyName: c.companyName, orderNumber: c.orderNumber, product: c.productName, quantity: num(c.quantity), amount: num(c.amount), date: (c.createdAt as Date).toISOString(), state };
    });
    for (const w of wd) {
      const pc = company(String(w.companyId), String(w.companyCode), String(w.companyName));
      if (w.status === 'PAID') pc.withdrawn += num(w.amount);
      if (w.status === 'REQUESTED') pc.requested += num(w.amount);
    }
    const companies = [...perCompany.values()].map((p) => ({ ...p, pending: r2(p.pending), available: r2(p.available), withdrawn: r2(p.withdrawn), requested: r2(p.requested), balance: r2(Math.max(0, p.available - p.withdrawn - p.requested)) }));
    const tot = (k: 'pending' | 'available' | 'withdrawn' | 'requested' | 'balance') => r2(companies.reduce((s, p) => s + p[k], 0));
    return {
      code: a.code, pending: tot('pending'), available: tot('available'), withdrawn: tot('withdrawn'), requested: tot('requested'), balance: tot('balance'),
      companies, sales,
      withdrawals: wd.map((w) => ({ id: w.id, companyCode: w.companyCode, companyName: w.companyName, amount: num(w.amount), method: w.method, details: w.details, status: w.status, note: w.note, proofUrl: w.proofUrl, date: (w.createdAt as Date).toISOString() })),
    };
  }

  /* ═══════════════ contas para saque e saques (pagos por cada empresa) ═══════════════ */
  async accounts(a: AssociateRow) {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT id, method, bank, holder, details, "createdAt" FROM ${T('kwanza_payout_accounts')} WHERE "associateId" = ${a.id}::uuid ORDER BY "createdAt"`);
    return rows.map((r) => ({ id: r.id, method: r.method, bank: r.bank, holder: r.holder, details: r.details, createdAt: (r.createdAt as Date).toISOString() }));
  }
  async addAccount(a: AssociateRow, p: { method: string; bank?: string; holder: string; details: string }) {
    const method = (p.method ?? '').trim().slice(0, 40); const holder = (p.holder ?? '').trim().slice(0, 120); const details = (p.details ?? '').trim().slice(0, 60);
    if (!method || holder.length < 3 || details.length < 6) throw new BadRequestException('Preencha o titular e o número da conta.');
    const n = await this.prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS n FROM ${T('kwanza_payout_accounts')} WHERE "associateId" = ${a.id}::uuid`);
    if (Number(n[0]?.n ?? 0) >= 3) throw new BadRequestException('Pode ter no máximo 3 contas.');
    await this.prisma.$executeRaw(Prisma.sql`INSERT INTO ${T('kwanza_payout_accounts')} (id, "associateId", method, bank, holder, details, "createdAt") VALUES (gen_random_uuid(), ${a.id}::uuid, ${method}, ${(p.bank ?? '').trim().slice(0, 60) || null}, ${holder}, ${details}, now())`);
    return { ok: true as const };
  }
  async removeAccount(a: AssociateRow, id: string) {
    const n = await this.prisma.$executeRaw(Prisma.sql`DELETE FROM ${T('kwanza_payout_accounts')} WHERE id = ${id}::uuid AND "associateId" = ${a.id}::uuid`);
    if (!n) throw new NotFoundException('Conta não encontrada.');
    return { ok: true as const };
  }
  async withdraw(a: AssociateRow, companyCode: string, amount: number, accountId: string) {
    const d = await this.dashboard(a);
    const pc = d.companies.find((c) => c.companyCode === companyCode);
    const v = r2(amount);
    if (!(v > 0)) throw new BadRequestException('Indique o valor do saque.');
    if (!pc || v > pc.balance) throw new BadRequestException('O valor é maior do que o saldo disponível nesta empresa.');
    const acc = (await this.accounts(a)).find((x) => x.id === accountId);
    if (!acc) throw new BadRequestException('Escolha uma conta para receber.');
    const label = acc.method === 'Multicaixa Express' ? String(acc.method) : `${acc.method}${acc.bank ? ` · ${acc.bank}` : ''}`;
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${T('kwanza_withdrawals')} (id, "associateId", "companyId", amount, method, details, status, "createdAt")
      VALUES (gen_random_uuid(), ${a.id}::uuid, ${pc.companyId}::uuid, ${v}, ${label}, ${`${acc.details} · ${acc.holder}`}, 'REQUESTED', now())`);
    return { ok: true as const };
  }

  /* ═══════════════ painel da empresa (LPS Vendas → LPS Kwanza) ═══════════════ */
  async companyProducts(schema: string, q?: string) {
    const term = `%${(q ?? '').trim().toLowerCase()}%`;
    const rows = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT code, name, image_url, kwanza_published AS pub, affiliate_percent AS pct, affiliate_mode AS mode, allow_markup AS mk, max_markup_pct AS maxmk, affiliate_materials AS mats
      FROM products WHERE is_active = TRUE AND (lower(name) LIKE ${term} OR lower(code) LIKE ${term})
      ORDER BY kwanza_published DESC, name LIMIT 80`));
    return rows.map((r) => ({ code: r.code, name: r.name, imageUrl: r.image_url, published: !!r.pub, percent: r.pct == null ? null : num(r.pct), mode: r.mode ?? 'OPEN', allowMarkup: !!r.mk, maxMarkupPct: r.maxmk == null ? null : num(r.maxmk), materials: Array.isArray(r.mats) ? r.mats : [] }));
  }

  async saveCompanyProduct(tenant: { companyId: string; schema: string }, productCode: string, p: ListingInput) {
    const pct = p.percent == null || p.percent <= 0 ? null : Math.min(90, r2(p.percent));
    if (p.published && !pct) throw new BadRequestException('Defina a % de comissão para publicar no LPS Kwanza.');
    const mats = (p.materials ?? []).map((m) => String(m).trim()).filter((m) => /^https?:\/\//i.test(m)).slice(0, 10);
    const n = await this.prisma.runInTenant(tenant.schema, (tx) => tx.$executeRaw(Prisma.sql`
      UPDATE products SET kwanza_published = ${!!p.published}, affiliate_percent = ${pct}, affiliate_mode = ${p.mode === 'RESTRICTED' ? 'RESTRICTED' : 'OPEN'},
        allow_markup = ${!!p.allowMarkup}, max_markup_pct = ${p.maxMarkupPct == null ? null : Math.min(100, r2(p.maxMarkupPct))}, affiliate_materials = ${JSON.stringify(mats)}::jsonb
      WHERE code = ${productCode}`));
    if (!n) throw new NotFoundException('Produto não encontrado.');
    await this.syncCompany(tenant.companyId);
    return { ok: true as const };
  }

  /** Copia para o marketplace os produtos publicados da empresa (preço com IVA e promoções do catálogo). */
  async syncCompany(companyId: string) {
    const c = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!c) return;
    const pubs = await this.prisma.runInTenant(c.schemaName, (tx) => tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT code, affiliate_percent AS pct, affiliate_mode AS mode, allow_markup AS mk, max_markup_pct AS maxmk, affiliate_materials AS mats
      FROM products WHERE kwanza_published = TRUE AND is_active = TRUE`)).catch(() => []);
    const catalog = pubs.length ? await this.storefront.catalog(c.schemaName).catch(() => []) : [];
    const byCode = new Map(catalog.map((p) => [p.code, p]));
    const live: string[] = [];
    for (const p of pubs) {
      const cp = byCode.get(String(p.code));
      if (!cp) continue;
      live.push(cp.code);
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO ${T('kwanza_listings')} (id, "companyId", "companyCode", "companyName", "productCode", name, description, "imageUrl", gallery, category, "grossPrice", "listPrice", "inStock",
          "commissionPct", affiliation, "allowMarkup", "maxMarkupPct", materials, views, sold, active, "updatedAt")
        VALUES (gen_random_uuid(), ${c.id}::uuid, ${c.code}, ${c.name}, ${cp.code}, ${cp.name}, ${cp.description}, ${cp.imageUrl}, ${JSON.stringify(cp.gallery ?? [])}::jsonb, ${cp.category ?? null},
          ${cp.grossPrice}, ${cp.listPrice ?? null}, ${cp.inStock || !!cp.madeToOrder}, ${num(p.pct)}, ${p.mode === 'RESTRICTED' ? 'RESTRICTED' : 'OPEN'}, ${!!p.mk},
          ${p.maxmk == null ? null : num(p.maxmk)}, ${JSON.stringify(Array.isArray(p.mats) ? p.mats : [])}::jsonb, ${cp.views ?? 0}, ${cp.sold ?? 0}, TRUE, now())
        ON CONFLICT ("companyId", "productCode") DO UPDATE SET "companyName" = EXCLUDED."companyName", name = EXCLUDED.name, description = EXCLUDED.description,
          "imageUrl" = EXCLUDED."imageUrl", gallery = EXCLUDED.gallery, category = EXCLUDED.category, "grossPrice" = EXCLUDED."grossPrice", "listPrice" = EXCLUDED."listPrice",
          "inStock" = EXCLUDED."inStock", "commissionPct" = EXCLUDED."commissionPct", affiliation = EXCLUDED.affiliation, "allowMarkup" = EXCLUDED."allowMarkup",
          "maxMarkupPct" = EXCLUDED."maxMarkupPct", materials = EXCLUDED.materials, views = GREATEST(${T('kwanza_listings')}.views, EXCLUDED.views), active = TRUE, "updatedAt" = now()`);
    }
    await this.prisma.$executeRaw(Prisma.sql`UPDATE ${T('kwanza_listings')} SET active = FALSE, "updatedAt" = now() WHERE "companyId" = ${c.id}::uuid AND NOT ("productCode" = ANY(${live}::text[]))`);
  }

  async syncAll() {
    const ids = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT DISTINCT "companyId"::text AS id FROM ${T('kwanza_listings')}`);
    for (const r of ids) await this.syncCompany(r.id).catch(() => undefined);
  }

  async companyRequests(companyId: string) {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT f.id, f.status, f."productCode", f."commissionPct", f."markupPct", f.note, f."createdAt", a.name AS associate, a.phone, a."photoUrl", l.name AS product, l."commissionPct" AS "basePct"
      FROM ${T('kwanza_affiliations')} f JOIN ${T('kwanza_associates')} a ON a.id = f."associateId"
      LEFT JOIN ${T('kwanza_listings')} l ON l."companyId" = f."companyId" AND l."productCode" = f."productCode"
      WHERE f."companyId" = ${companyId}::uuid ORDER BY (f.status = 'PENDING') DESC, f."updatedAt" DESC LIMIT 500`);
    return rows.map((r) => ({ id: r.id, status: r.status, productCode: r.productCode, product: r.product, associate: r.associate, phone: r.phone, photoUrl: r.photoUrl, note: r.note,
      commissionPct: r.commissionPct == null ? null : num(r.commissionPct), basePct: num(r.basePct), markupPct: r.markupPct == null ? null : num(r.markupPct), date: (r.createdAt as Date).toISOString() }));
  }

  async decideRequest(companyId: string, id: string, p: { status?: 'APPROVED' | 'REJECTED'; commissionPct?: number | null }) {
    const pct = p.commissionPct === undefined ? undefined : p.commissionPct == null || p.commissionPct <= 0 ? null : Math.min(90, r2(p.commissionPct));
    const n = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE ${T('kwanza_affiliations')} SET
        status = COALESCE(${p.status ?? null}, status),
        "commissionPct" = CASE WHEN ${pct !== undefined} THEN ${pct ?? null} ELSE "commissionPct" END, "updatedAt" = now()
      WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid`);
    if (!n) throw new NotFoundException('Pedido não encontrado.');
    return { ok: true as const };
  }

  async companyAssociates(companyId: string, schema: string) {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT a.id, a.name, a.phone, a.code, a."photoUrl", k."orderId", k.amount
      FROM ${T('kwanza_commissions')} k JOIN ${T('kwanza_associates')} a ON a.id = k."associateId" WHERE k."companyId" = ${companyId}::uuid`);
    const ids = [...new Set(rows.map((r) => String(r.orderId)))];
    const st = new Map<string, string>();
    if (ids.length) {
      const os = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<{ id: string; status: string }[]>(Prisma.sql`SELECT id::text, status FROM web_orders WHERE id = ANY(${ids}::uuid[])`));
      for (const o of os) st.set(o.id, o.status);
    }
    const wds = await this.prisma.$queryRaw<{ a: string; s: string; v: unknown }[]>(Prisma.sql`SELECT "associateId"::text AS a, status AS s, amount AS v FROM ${T('kwanza_withdrawals')} WHERE "companyId" = ${companyId}::uuid`);
    const map = new Map<string, { id: string; name: string; phone: string; code: string; photoUrl: string | null; orders: Set<string>; pending: number; available: number; paid: number; requested: number }>();
    for (const r of rows) {
      const k = String(r.id);
      if (!map.has(k)) map.set(k, { id: k, name: String(r.name), phone: String(r.phone), code: String(r.code), photoUrl: (r.photoUrl as string) ?? null, orders: new Set(), pending: 0, available: 0, paid: 0, requested: 0 });
      const m = map.get(k)!;
      const s = st.get(String(r.orderId)) ?? 'PENDING';
      if (s !== 'CANCELLED') m.orders.add(String(r.orderId));
      if (SOLD_STATUSES.includes(s)) m.available += num(r.amount); else if (s !== 'CANCELLED') m.pending += num(r.amount);
    }
    for (const w of wds) { const m = map.get(w.a); if (!m) continue; if (w.s === 'PAID') m.paid += num(w.v); if (w.s === 'REQUESTED') m.requested += num(w.v); }
    return [...map.values()].map((m) => ({ id: m.id, name: m.name, phone: m.phone, code: m.code, photoUrl: m.photoUrl, sales: m.orders.size, pending: r2(m.pending), available: r2(m.available), paid: r2(m.paid), requested: r2(m.requested), balance: r2(Math.max(0, m.available - m.paid - m.requested)) }));
  }

  async companySales(companyId: string) {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT k."orderNumber", k."productName", k.quantity, k.amount, k."createdAt", a.name AS associate, a.code
      FROM ${T('kwanza_commissions')} k JOIN ${T('kwanza_associates')} a ON a.id = k."associateId" WHERE k."companyId" = ${companyId}::uuid ORDER BY k."createdAt" DESC LIMIT 500`);
    return rows.map((r) => ({ orderNumber: r.orderNumber, product: r.productName, quantity: num(r.quantity), amount: num(r.amount), associate: r.associate, code: r.code, date: (r.createdAt as Date).toISOString() }));
  }

  async companyWithdrawals(companyId: string) {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT w.id, a.name, w.amount, w.method, w.details, w.status, w.note, w."proofUrl", w."createdAt" FROM ${T('kwanza_withdrawals')} w
      JOIN ${T('kwanza_associates')} a ON a.id = w."associateId" WHERE w."companyId" = ${companyId}::uuid ORDER BY (w.status = 'REQUESTED') DESC, w."createdAt" DESC LIMIT 300`);
    return rows.map((r) => ({ id: r.id, name: r.name, amount: num(r.amount), method: r.method, details: r.details, status: r.status, note: r.note, proofUrl: r.proofUrl, date: (r.createdAt as Date).toISOString() }));
  }

  async decideWithdrawal(companyId: string, id: string, paid: boolean, note?: string, proofUrl?: string) {
    const n = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE ${T('kwanza_withdrawals')} SET status = ${paid ? 'PAID' : 'REJECTED'}, note = ${(note ?? '').trim().slice(0, 300) || null}, "proofUrl" = ${paid ? (proofUrl || null) : null}, "decidedAt" = now()
      WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid AND status = 'REQUESTED'`);
    if (!n) throw new NotFoundException('Pedido de saque não encontrado ou já decidido.');
    return { ok: true as const };
  }
}
