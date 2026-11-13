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
import { AdminNotificationsService } from './admin-notifications';

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
/** Stock total do produto (todas as lojas); sem saldos por loja, o stock da ficha. */
const STOCK = Prisma.sql`COALESCE((SELECT SUM(si.quantity) FROM stock_items si WHERE si.product_id = p.id), p.stock_qty, 0)`;

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
    private readonly adminNotes: AdminNotificationsService,
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
  /**
   * Produtos do marketplace. Os associados (com sessão) veem todos para se afiliarem;
   * os clientes sem sessão de associado só veem os produtos que já têm um associado aprovado.
   */
  /* ── tempo real ──
   * O marketplace lê um retrato (kwanza_listings) dos produtos de cada empresa. Antes de o
   * servir, volta a copiar preços, stock, nomes e imagens das empresas cujo retrato tem mais
   * de FRESH_MS — sem ninguém ter de carregar em "Atualizar". Um só refrescamento de cada vez. */
  private static readonly FRESH_MS = 8_000;
  private readonly syncedAt = new Map<string, number>();
  private refreshing: Promise<void> | null = null;
  private refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const ids = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT DISTINCT "companyId"::text AS id FROM ${T('kwanza_listings')} WHERE active = TRUE`);
      await Promise.all(ids.map(async ({ id }) => {
        if (Date.now() - (this.syncedAt.get(id) ?? 0) < KwanzaService.FRESH_MS) return;
        this.syncedAt.set(id, Date.now());
        await this.syncCompany(id).catch(() => this.syncedAt.delete(id));
      }));
    })().catch(() => undefined).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  /** Um produto aberto pela ligação de um associado (ou sem associado): para o cliente sem conta. */
  async listing(companyCode: string, productCode: string, associateCode?: string) {
    await this.refresh();
    if (associateCode && /^[A-Za-z0-9]{6}$/.test(associateCode)) {
      const p = await this.posts({ companyCode, productCode, associateCode });
      if (p[0]) return p[0];
    }
    const all = await this.market(true);
    const l = all.find((x) => x.companyCode === companyCode && x.productCode === productCode);
    if (!l) throw new NotFoundException('Produto indisponível no marketplace.');
    return l;
  }

  async market(forAssociate = false) {
    await this.refresh();
    if (!forAssociate) return this.posts();
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT "companyCode", "companyName", "productCode", name, description, "imageUrl", gallery, category, "grossPrice", "listPrice", "inStock",
             "commissionPct", affiliation, "allowMarkup", "maxMarkupPct", materials, views, sold,
             (SELECT COUNT(*) FROM ${T('kwanza_affiliations')} f WHERE f."companyId" = l."companyId" AND f."productCode" = l."productCode" AND f.status = 'APPROVED') AS associates
      FROM ${T('kwanza_listings')} l
      WHERE active = TRUE AND EXISTS (SELECT 1 FROM nexus_public.companies c WHERE c.id = l."companyId" AND c.status = 'ACTIVE')
      ORDER BY sold DESC, views DESC LIMIT 2000`);
    return rows.map((r) => ({
      companyCode: r.companyCode, companyName: r.companyName, productCode: r.productCode, name: r.name, description: r.description,
      imageUrl: r.imageUrl, gallery: Array.isArray(r.gallery) ? r.gallery : [], category: r.category, grossPrice: num(r.grossPrice),
      listPrice: r.listPrice == null ? null : num(r.listPrice), inStock: !!r.inStock, commissionPct: num(r.commissionPct),
      affiliation: r.affiliation, allowMarkup: !!r.allowMarkup, maxMarkupPct: r.maxMarkupPct == null ? null : num(r.maxMarkupPct),
      materials: Array.isArray(r.materials) ? r.materials : [], views: num(r.views), sold: num(r.sold), associates: num(r.associates),
    }));
  }

  /**
   * Publicações dos associados (o que o cliente normal vê e compra): o preço é o do associado
   * (nunca abaixo do da empresa), com as suas imagens, vídeo e texto. A compra leva o código
   * do associado, por isso a comissão e a diferença do preço ficam atribuídas automaticamente.
   */
  async posts(only?: { companyCode: string; productCode: string; associateCode: string }) {
    // `only`: a ligação de UM associado para um produto (mesmo sem publicação) — o cliente
    // que a abre vê o produto ao preço desse associado e a compra fica atribuída.
    const filter = only
      ? Prisma.sql`f.status = 'APPROVED' AND l."companyCode" = ${only.companyCode} AND l."productCode" = ${only.productCode} AND a.code = ${only.associateCode.toUpperCase()}`
      : Prisma.sql`f.status = 'APPROVED' AND f.published = TRUE`;
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT f.id AS "postId", f."markupPct", f."postImages", f."postVideo", f."postCaption", f."publishedAt",
             a.code AS "aCode", a.name AS "aName", a."photoUrl" AS "aPhoto",
             l."companyCode", l."companyName", l."productCode", l.name, l.description, l."imageUrl", l.gallery, l.category, l."grossPrice", l."listPrice", l."inStock",
             COALESCE(f."commissionPct", l."commissionPct") AS "commissionPct", l.affiliation, l."allowMarkup", l."maxMarkupPct", l.materials, l.views, l.sold
      FROM ${T('kwanza_affiliations')} f
      JOIN ${T('kwanza_associates')} a ON a.id = f."associateId" AND a.status = 'ACTIVE'
      JOIN ${T('kwanza_listings')} l ON l."companyId" = f."companyId" AND l."productCode" = f."productCode" AND l.active = TRUE
      WHERE ${filter}
        AND EXISTS (SELECT 1 FROM nexus_public.companies c WHERE c.id = l."companyId" AND c.status = 'ACTIVE')
      ORDER BY f."publishedAt" DESC NULLS LAST LIMIT 3000`);
    return rows.map((r) => {
      const base = num(r.grossPrice);
      const mk = r.allowMarkup && r.markupPct != null ? Math.min(num(r.markupPct), r.maxMarkupPct == null ? 100 : num(r.maxMarkupPct)) : 0;
      const imgs = (Array.isArray(r.postImages) ? r.postImages : []).filter((x): x is string => typeof x === 'string');
      const gallery = Array.isArray(r.gallery) ? (r.gallery as string[]) : [];
      return {
        postId: r.postId, companyCode: r.companyCode, companyName: r.companyName, productCode: r.productCode, name: r.name, description: r.description,
        imageUrl: imgs[0] ?? r.imageUrl, gallery: [...imgs.slice(1), ...(r.imageUrl && imgs.length ? [r.imageUrl as string] : []), ...gallery],
        category: r.category, grossPrice: r2(base * (1 + mk / 100)), basePrice: base, listPrice: null, inStock: !!r.inStock,
        commissionPct: num(r.commissionPct), affiliation: r.affiliation, allowMarkup: !!r.allowMarkup, maxMarkupPct: r.maxMarkupPct == null ? null : num(r.maxMarkupPct),
        materials: [], views: num(r.views), sold: num(r.sold), associates: 1,
        associate: { code: r.aCode, name: r.aName, photoUrl: r.aPhoto ?? null },
        videoUrl: r.postVideo ?? null, caption: r.postCaption ?? null, publishedAt: r.publishedAt ? (r.publishedAt as Date).toISOString() : null,
      };
    });
  }

  /**
   * O associado publica o produto: o seu preço (≥ preço da empresa e ≤ limite que a empresa
   * definir), imagens publicitárias, vídeo e texto. Só com a afiliação aprovada.
   */
  async savePost(a: AssociateRow, companyCode: string, productCode: string, d: { price?: number | null; images?: string[]; videoUrl?: string | null; caption?: string | null; published: boolean }) {
    const l = await this.prisma.$queryRaw<{ companyId: string; grossPrice: unknown; allowMarkup: boolean; maxMarkupPct: unknown }[]>(Prisma.sql`
      SELECT "companyId", "grossPrice", "allowMarkup", "maxMarkupPct" FROM ${T('kwanza_listings')} WHERE "companyCode" = ${companyCode} AND "productCode" = ${productCode} AND active = TRUE`);
    if (!l[0]) throw new NotFoundException('Produto indisponível no marketplace.');
    // O preço mínimo é o da empresa AGORA (não o do último retrato).
    await this.syncCompany(l[0].companyId).catch(() => undefined);
    const fresh = await this.prisma.$queryRaw<{ grossPrice: unknown }[]>(Prisma.sql`SELECT "grossPrice" FROM ${T('kwanza_listings')} WHERE "companyCode" = ${companyCode} AND "productCode" = ${productCode} AND active = TRUE`);
    if (!fresh[0]) throw new NotFoundException('Produto indisponível no marketplace.');
    l[0].grossPrice = fresh[0].grossPrice;
    const base = num(l[0].grossPrice);
    const max = l[0].maxMarkupPct == null ? 100 : num(l[0].maxMarkupPct);
    let mk: number | null = null;
    if (d.price != null && d.price > 0) {
      const price = r2(d.price);
      if (price < base) throw new BadRequestException(`O preço não pode ser abaixo do preço da empresa (${base.toLocaleString('pt-PT')} Kz).`);
      if (price > base) {
        if (!l[0].allowMarkup) throw new BadRequestException('Esta empresa não permite preço próprio neste produto.');
        mk = r2((price / base - 1) * 100);
        if (mk > max) throw new BadRequestException(`O preço máximo permitido é ${r2(base * (1 + max / 100)).toLocaleString('pt-PT')} Kz.`);
      }
    }
    const images = (d.images ?? []).filter((x) => typeof x === 'string' && (/^https:\/\//i.test(x) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(x)));
    if (images.length > 6) throw new BadRequestException('Máximo de 6 imagens.');
    if (images.some((x) => x.length > 1_200_000)) throw new BadRequestException('Cada imagem pode ter até ~900 KB.');
    const video = (d.videoUrl ?? '').trim();
    if (video && (!/^https:\/\/\S+$/i.test(video) || video.length > 500)) throw new BadRequestException('Indique uma ligação https válida para o vídeo.');
    const caption = (d.caption ?? '').trim().slice(0, 600) || null;
    const n = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE ${T('kwanza_affiliations')} SET "markupPct" = ${mk}, "postImages" = ${JSON.stringify(images)}::jsonb, "postVideo" = ${video || null}, "postCaption" = ${caption},
        published = ${!!d.published}, "publishedAt" = CASE WHEN ${!!d.published} THEN COALESCE("publishedAt", now()) ELSE NULL END, "updatedAt" = now()
      WHERE "associateId" = ${a.id}::uuid AND "companyId" = ${l[0].companyId}::uuid AND "productCode" = ${productCode} AND status = 'APPROVED'`);
    if (!n) throw new BadRequestException('A afiliação a este produto ainda não foi aprovada.');
    return { ok: true as const, price: r2(base * (1 + (mk ?? 0) / 100)), published: !!d.published };
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
    if (status === 'PENDING') await this.notifyCompany(l.companyId, { kind: 'KWANZA_REQUEST', title: `Pedido de afiliação de ${a.name}`, body: `Produto ${productCode}${note ? ` — “${note.slice(0, 120)}”` : ''}`, section: 'kwanza', ref: 'requests' });
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
    await this.refresh();
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT f.id, f.status, f."productCode", f."commissionPct" AS "ownPct", f."markupPct", f.note, f.published, f."postImages", f."postVideo", f."postCaption",
             l."companyCode", l."companyName", l.name, l."imageUrl",
             l."grossPrice", l."commissionPct", l.affiliation, l."allowMarkup", l."maxMarkupPct"
      FROM ${T('kwanza_affiliations')} f JOIN ${T('kwanza_listings')} l ON l."companyId" = f."companyId" AND l."productCode" = f."productCode"
      WHERE f."associateId" = ${a.id}::uuid ORDER BY f."updatedAt" DESC`);
    return rows.map((r) => ({
      id: r.id, status: r.status, companyCode: r.companyCode, companyName: r.companyName, productCode: r.productCode, name: r.name, imageUrl: r.imageUrl,
      grossPrice: num(r.grossPrice), commissionPct: r.ownPct == null ? num(r.commissionPct) : num(r.ownPct), negotiated: r.ownPct != null,
      markupPct: r.markupPct == null ? null : num(r.markupPct), affiliation: r.affiliation, allowMarkup: !!r.allowMarkup,
      maxMarkupPct: r.maxMarkupPct == null ? null : num(r.maxMarkupPct),
      published: !!r.published, postImages: Array.isArray(r.postImages) ? r.postImages : [], postVideo: r.postVideo ?? null, postCaption: r.postCaption ?? null,
      price: r2(num(r.grossPrice) * (1 + (r.markupPct == null ? 0 : num(r.markupPct)) / 100)),
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
    if (any) await this.notifyAssociate(a.id, { kind: 'SALE', title: 'Nova venda pela tua ligação', body: `Encomenda ${items[0]?.n ?? ''} — a comissão fica disponível quando a loja a marcar como vendida.`, link: '#/vendas' });
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
    const detail = new Map<string, { claimed: boolean; at: Date }>();
    for (const [schema, ids] of bySchema) {
      const rows = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<{ id: string; status: string; claimed: boolean; upd: Date }[]>(Prisma.sql`SELECT w.id::text, w.status, (w.payment_claimed_at IS NOT NULL OR EXISTS (SELECT 1 FROM payment_proofs pp WHERE pp.order_id = w.id AND pp.status = 'PENDING')) AS claimed, w.updated_at AS upd FROM web_orders w WHERE w.id = ANY(${ids}::uuid[])`)).catch(() => []);
      for (const r of rows) { status.set(r.id, r.status); detail.set(r.id, { claimed: r.claimed, at: r.upd }); }
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
      return { companyCode: c.companyCode, companyName: c.companyName, orderNumber: c.orderNumber, product: c.productName, quantity: num(c.quantity), amount: num(c.amount), date: (c.createdAt as Date).toISOString(), state,
        // Estado da encomenda na empresa, para o associado acompanhar passo a passo.
        orderStatus: st, paymentClaimed: detail.get(String(c.orderId))?.claimed ?? false, updatedAt: (detail.get(String(c.orderId))?.at ?? (c.createdAt as Date)).toISOString() };
    });
    for (const w of wd) {
      const pc = company(String(w.companyId), String(w.companyCode), String(w.companyName));
      if (w.status === 'PAID') pc.withdrawn += num(w.amount);
      if (w.status === 'REQUESTED') pc.requested += num(w.amount);
    }
    const companies = [...perCompany.values()].map((p) => ({ ...p, pending: r2(p.pending), available: r2(p.available), withdrawn: r2(p.withdrawn), requested: r2(p.requested), balance: r2(Math.max(0, p.available - p.withdrawn - p.requested)) }));
    // Saldo congelado pela empresa (reclamações em análise, fraude…): o saque fica bloqueado.
    const fz = await this.prisma.$queryRaw<{ code: string; reason: string }[]>(Prisma.sql`SELECT c.code, f.reason FROM ${T('kwanza_freezes')} f JOIN nexus_public.companies c ON c.id = f."companyId" WHERE f."associateId" = ${a.id}::uuid`);
    const frozen: Record<string, string> = Object.fromEntries(fz.map((r) => [r.code, r.reason]));
    const tot = (k: 'pending' | 'available' | 'withdrawn' | 'requested' | 'balance') => r2(companies.reduce((s, p) => s + p[k], 0));
    return {
      code: a.code, pending: tot('pending'), available: tot('available'), withdrawn: tot('withdrawn'), requested: tot('requested'), balance: tot('balance'),
      companies, sales, frozen,
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
    const v = r2(amount);
    if (!(v > 0)) throw new BadRequestException('Indique o valor do saque.');
    // Um pedido de cada vez por associado: sem isto, vários pedidos simultâneos liam o
    // mesmo saldo e eram todos aceites (pedia-se 3× o saldo). O lock é da transação e
    // só se solta depois de o pedido ficar gravado; um segundo pedido em paralelo não
    // espera (não prende ligações do pool) — é recusado e o associado tenta de novo.
    const res = await this.prisma.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<{ ok: boolean }[]>(Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext(${`kwanza_wd:${a.id}`})) AS ok`);
      if (!lock[0]?.ok) throw new BadRequestException('Já há um pedido de saque a ser processado. Tente de novo dentro de instantes.');
      const d = await this.dashboard(a);
      const pc = d.companies.find((c) => c.companyCode === companyCode);
      if (d.frozen[companyCode] !== undefined) throw new BadRequestException(`O seu saldo nesta empresa está congelado: ${d.frozen[companyCode]}`);
      if (!pc || v > pc.balance) throw new BadRequestException('O valor é maior do que o saldo disponível nesta empresa.');
      const acc = (await this.accounts(a)).find((x) => x.id === accountId);
      if (!acc) throw new BadRequestException('Escolha uma conta para receber.');
      const label = acc.method === 'Multicaixa Express' ? String(acc.method) : `${acc.method}${acc.bank ? ` · ${acc.bank}` : ''}`;
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO ${T('kwanza_withdrawals')} (id, "associateId", "companyId", amount, method, details, status, "createdAt")
        VALUES (gen_random_uuid(), ${a.id}::uuid, ${pc.companyId}::uuid, ${v}, ${label}, ${`${acc.details} · ${acc.holder}`}, 'REQUESTED', now())`);
      return { pc, label };
    }, { timeout: 20_000 });
    const { pc, label } = res;
    await this.notifyCompany(pc.companyId, { kind: 'KWANZA_WITHDRAWAL', title: `Pedido de saque de ${a.name}`, body: `${v.toLocaleString('pt-PT')} Kz · ${label}`, section: 'kwanza', ref: 'withdrawals' });
    return { ok: true as const };
  }

  /* ═══════════════ painel da empresa (LPS Vendas → LPS Kwanza) ═══════════════ */
  async companyProducts(schema: string, q?: string) {
    const term = `%${(q ?? '').trim().toLowerCase()}%`;
    const rows = await this.prisma.runInTenant(schema, async (tx) => tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT p.id::text AS id, code, name, image_url, kwanza_published AS pub, affiliate_percent AS pct, affiliate_mode AS mode, allow_markup AS mk, max_markup_pct AS maxmk, affiliate_materials AS mats,
             ${STOCK}::float8 AS stock, ${await this.madeToOrder(tx)} AS mto
      FROM products p WHERE is_active = TRUE AND (lower(name) LIKE ${term} OR lower(code) LIKE ${term})
      ORDER BY kwanza_published DESC, name LIMIT 500`));
    return rows.map((r) => ({ id: r.id, stock: num(r.stock), canPublish: num(r.stock) > 0 || !!r.mto, code: r.code, name: r.name, imageUrl: r.image_url, published: !!r.pub, percent: r.pct == null ? null : num(r.pct), mode: r.mode ?? 'OPEN', allowMarkup: !!r.mk, maxMarkupPct: r.maxmk == null ? null : num(r.maxmk), materials: Array.isArray(r.mats) ? r.mats : [] }));
  }

  /** Produto feito por encomenda (ficha técnica): vende-se sem stock próprio. */
  private async madeToOrder(tx: Prisma.TransactionClient): Promise<Prisma.Sql> {
    const reg = await tx.$queryRaw<{ r: string | null }[]>(Prisma.sql`SELECT to_regclass('product_recipes')::text AS r`);
    return reg[0]?.r ? Prisma.sql`EXISTS (SELECT 1 FROM product_recipes r WHERE r.product_id = p.id)` : Prisma.sql`FALSE`;
  }

  async saveCompanyProduct(tenant: { companyId: string; schema: string }, productCode: string, p: ListingInput) {
    const pct = p.percent == null || p.percent <= 0 ? null : Math.min(90, r2(p.percent));
    if (p.published && !pct) throw new BadRequestException('Defina a % de comissão para publicar no LPS Kwanza.');
    if (p.published) {
      // Sem stock não se publica (o associado ia divulgar um produto que a empresa não tem).
      const st = await this.prisma.runInTenant(tenant.schema, async (tx) => tx.$queryRaw<{ ok: boolean }[]>(Prisma.sql`
        SELECT (${STOCK} > 0 OR ${await this.madeToOrder(tx)}) AS ok FROM products p WHERE code = ${productCode}`));
      if (st[0] && !st[0].ok) throw new BadRequestException('Produto sem stock: adicione stock antes de publicar no LPS Kwanza.');
    }
    const mats = (p.materials ?? []).map((m) => String(m).trim()).filter((m) => /^https?:\/\//i.test(m)).slice(0, 10);
    const n = await this.prisma.runInTenant(tenant.schema, (tx) => tx.$executeRaw(Prisma.sql`
      UPDATE products SET kwanza_published = ${!!p.published}, show_online = (show_online OR ${!!p.published}), affiliate_percent = ${pct}, affiliate_mode = ${p.mode === 'RESTRICTED' ? 'RESTRICTED' : 'OPEN'},
        allow_markup = ${!!p.allowMarkup}, max_markup_pct = ${p.maxMarkupPct == null ? null : Math.min(100, r2(p.maxMarkupPct))}, affiliate_materials = ${JSON.stringify(mats)}::jsonb
      WHERE code = ${productCode}`));
    if (!n) throw new NotFoundException('Produto não encontrado.');
    this.storefront.forgetCatalog(tenant.schema);
    await this.syncCompany(tenant.companyId);
    return { ok: true as const };
  }

  /**
   * Configura VÁRIOS produtos de uma vez: os marcados (`codes`) ou todos os ativos (`all`,
   * opcionalmente só os que correspondem à pesquisa `q`). Só mexe nos campos enviados; os
   * outros ficam como estão em cada produto. Publicar exige comissão: os produtos sem % (e
   * sem % neste pedido) ficam de fora e são contados em `skipped`.
   */
  async saveCompanyProductsBulk(tenant: { companyId: string; schema: string }, p: { codes?: string[]; all?: boolean; q?: string; published?: boolean; percent?: number | null; mode?: 'OPEN' | 'RESTRICTED'; allowMarkup?: boolean; maxMarkupPct?: number | null }) {
    const codes = [...new Set((p.codes ?? []).map((c) => String(c)))];
    if (!p.all && !codes.length) throw new BadRequestException('Escolha pelo menos um produto.');
    const sets: Prisma.Sql[] = [];
    const mto = await this.prisma.runInTenant(tenant.schema, (tx) => this.madeToOrder(tx));
    const pct = p.percent === undefined ? undefined : p.percent == null || p.percent <= 0 ? null : Math.min(90, r2(p.percent));
    if (pct !== undefined) sets.push(Prisma.sql`affiliate_percent = ${pct}`);
    if (p.mode !== undefined) sets.push(Prisma.sql`affiliate_mode = ${p.mode === 'RESTRICTED' ? 'RESTRICTED' : 'OPEN'}`);
    if (p.allowMarkup !== undefined) sets.push(Prisma.sql`allow_markup = ${!!p.allowMarkup}`);
    if (p.maxMarkupPct !== undefined) sets.push(Prisma.sql`max_markup_pct = ${p.maxMarkupPct == null ? null : Math.min(100, r2(p.maxMarkupPct))}`);
    if (p.published !== undefined) {
      // Publicar só o que fica com comissão (a nova, ou a que o produto já tem).
      sets.push(p.published
        ? Prisma.sql`kwanza_published = ((${pct ?? null}::numeric IS NOT NULL OR (${pct === undefined} AND COALESCE(affiliate_percent, 0) > 0)) AND (${STOCK} > 0 OR ${mto}))`
        : Prisma.sql`kwanza_published = FALSE`);
      // A compra faz-se na loja online da empresa: o que se publica aqui tem de estar lá.
      if (p.published) sets.push(Prisma.sql`show_online = (show_online OR ((${pct ?? null}::numeric IS NOT NULL OR (${pct === undefined} AND COALESCE(affiliate_percent, 0) > 0)) AND (${STOCK} > 0 OR ${mto})))`);
    }
    if (!sets.length) throw new BadRequestException('Nada para alterar.');
    void mto;
    if (p.published && pct === null) throw new BadRequestException('Defina a % de comissão para publicar no LPS Kwanza.');
    const term = `%${(p.q ?? '').trim().toLowerCase()}%`;
    const where = p.all
      ? Prisma.sql`is_active = TRUE AND (lower(name) LIKE ${term} OR lower(code) LIKE ${term})`
      : Prisma.sql`is_active = TRUE AND code = ANY(${codes}::text[])`;
    const res = await this.prisma.runInTenant(tenant.schema, async (tx) => {
      const updated = await tx.$executeRaw(Prisma.sql`UPDATE products p SET ${Prisma.join(sets, ', ')}, updated_at = now() WHERE ${where}`);
      const skipped = p.published
        ? await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM products WHERE ${where} AND kwanza_published = FALSE`)
        : [{ n: 0 }];
      return { updated: Number(updated), skipped: skipped[0]?.n ?? 0 };
    });
    this.storefront.forgetCatalog(tenant.schema);
    await this.syncCompany(tenant.companyId);
    return { ok: true as const, ...res };
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
    const f = await this.prisma.$queryRaw<{ a: string; p: string; c: string }[]>(Prisma.sql`SELECT f."associateId"::text AS a, f."productCode" AS p, c.name AS c FROM ${T('kwanza_affiliations')} f JOIN nexus_public.companies c ON c.id = f."companyId" WHERE f.id = ${id}::uuid`);
    if (f[0] && p.status) await this.notifyAssociate(f[0].a, { kind: p.status === 'APPROVED' ? 'AFF_APPROVED' : 'AFF_REJECTED', title: p.status === 'APPROVED' ? `Afiliação aprovada por ${f[0].c}` : `Afiliação recusada por ${f[0].c}`, body: `Produto ${f[0].p}`, link: '#/afiliacoes' });
    else if (f[0] && pct !== undefined) await this.notifyAssociate(f[0].a, { kind: 'AFF_COMMISSION', title: `${f[0].c} negociou a tua comissão`, body: `Produto ${f[0].p}: ${pct ?? 'base'}%`, link: '#/afiliacoes' });
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
    const w = await this.prisma.$queryRaw<{ a: string; v: unknown; c: string }[]>(Prisma.sql`SELECT w."associateId"::text AS a, w.amount AS v, c.name AS c FROM ${T('kwanza_withdrawals')} w JOIN nexus_public.companies c ON c.id = w."companyId" WHERE w.id = ${id}::uuid`);
    if (w[0]) await this.notifyAssociate(w[0].a, { kind: paid ? 'WITHDRAWAL_PAID' : 'WITHDRAWAL_REJECTED', title: paid ? `${w[0].c} pagou o teu saque` : `${w[0].c} recusou o teu saque`, body: `${num(w[0].v).toLocaleString('pt-PT')} Kz${note ? ` — ${note.slice(0, 120)}` : ''}`, link: '#/saques' });
    return { ok: true as const };
  }

  /* ═══════════════ notificações ═══════════════ */
  private async notifyCompany(companyId: string, n: { kind: string; title: string; body?: string; section?: string; ref?: string }) {
    const c = await this.prisma.company.findUnique({ where: { id: companyId } }).catch(() => null);
    if (c) await this.adminNotes.push(c.schemaName, n);
  }
  private async notifyAssociate(associateId: string, n: { kind: string; title: string; body?: string; link?: string }) {
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${T('kwanza_notifications')} (id, "associateId", kind, title, body, link, "createdAt")
      VALUES (gen_random_uuid(), ${associateId}::uuid, ${n.kind}, ${n.title.slice(0, 160)}, ${(n.body ?? '').slice(0, 400) || null}, ${n.link ?? null}, now())`).catch(() => undefined);
  }
  async notifications(a: AssociateRow) {
    const items = await this.prisma.$queryRaw<{ id: string; kind: string; title: string; body: string | null; link: string | null; readAt: Date | null; createdAt: Date }[]>(Prisma.sql`
      SELECT id, kind, title, body, link, "readAt", "createdAt" FROM ${T('kwanza_notifications')} WHERE "associateId" = ${a.id}::uuid ORDER BY "createdAt" DESC LIMIT 200`);
    return { unread: items.filter((i) => !i.readAt).length, items: items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, body: i.body, link: i.link, read: !!i.readAt, createdAt: i.createdAt.toISOString() })) };
  }
  async markNotifications(a: AssociateRow, ids: string[] | 'all', read = true) {
    if (ids === 'all') await this.prisma.$executeRaw(Prisma.sql`UPDATE ${T('kwanza_notifications')} SET "readAt" = now() WHERE "associateId" = ${a.id}::uuid AND "readAt" IS NULL`);
    else if (ids.length) await this.prisma.$executeRaw(Prisma.sql`UPDATE ${T('kwanza_notifications')} SET "readAt" = ${read ? new Date() : null} WHERE "associateId" = ${a.id}::uuid AND id = ANY(${ids}::uuid[])`);
    return { ok: true as const };
  }
  async deleteNotifications(a: AssociateRow, ids: string[] | 'all') {
    if (ids === 'all') await this.prisma.$executeRaw(Prisma.sql`DELETE FROM ${T('kwanza_notifications')} WHERE "associateId" = ${a.id}::uuid`);
    else if (ids.length) await this.prisma.$executeRaw(Prisma.sql`DELETE FROM ${T('kwanza_notifications')} WHERE "associateId" = ${a.id}::uuid AND id = ANY(${ids}::uuid[])`);
    return { ok: true as const };
  }

  /* ═══════════════ chat associado ↔ empresa ═══════════════ */
  private async companyByCode(code: string) {
    const c = await this.prisma.company.findUnique({ where: { code } });
    if (!c || c.status !== 'ACTIVE') throw new NotFoundException('Empresa não encontrada.');
    return c;
  }
  async associateChats(a: AssociateRow) {
    const rows = await this.prisma.$queryRaw<{ cid: string; code: string; name: string; last: string; at: Date; unread: bigint }[]>(Prisma.sql`
      SELECT m."companyId"::text AS cid, c.code, c.name,
        (SELECT body FROM ${T('kwanza_messages')} x WHERE x."associateId" = m."associateId" AND x."companyId" = m."companyId" ORDER BY "createdAt" DESC LIMIT 1) AS last,
        MAX(m."createdAt") AS at,
        COUNT(*) FILTER (WHERE m.sender = 'COMPANY' AND m."readAt" IS NULL) AS unread
      FROM ${T('kwanza_messages')} m JOIN nexus_public.companies c ON c.id = m."companyId"
      WHERE m."associateId" = ${a.id}::uuid GROUP BY m."companyId", m."associateId", c.code, c.name ORDER BY at DESC`);
    // Empresas com quem já trabalha (afiliações) aparecem mesmo sem mensagens.
    const affs = await this.prisma.$queryRaw<{ code: string; name: string }[]>(Prisma.sql`
      SELECT DISTINCT c.code, c.name FROM ${T('kwanza_affiliations')} f JOIN nexus_public.companies c ON c.id = f."companyId" WHERE f."associateId" = ${a.id}::uuid`);
    const out = rows.map((r) => ({ companyCode: r.code, companyName: r.name, last: r.last, at: r.at.toISOString(), unread: Number(r.unread) }));
    for (const f of affs) if (!out.some((o) => o.companyCode === f.code)) out.push({ companyCode: f.code, companyName: f.name, last: '', at: '', unread: 0 });
    return out;
  }
  async associateThread(a: AssociateRow, companyCode: string) {
    const c = await this.companyByCode(companyCode);
    await this.prisma.$executeRaw(Prisma.sql`UPDATE ${T('kwanza_messages')} SET "readAt" = now() WHERE "associateId" = ${a.id}::uuid AND "companyId" = ${c.id}::uuid AND sender = 'COMPANY' AND "readAt" IS NULL`);
    // Abrir a conversa marca como lidos os avisos dessa conversa.
    await this.prisma.$executeRaw(Prisma.sql`UPDATE ${T('kwanza_notifications')} SET "readAt" = now() WHERE "associateId" = ${a.id}::uuid AND kind = 'MESSAGE' AND link = ${`#/mensagens/${c.code}`} AND "readAt" IS NULL`).catch(() => undefined);
    return this.thread(a.id, c.id);
  }
  async associateSend(a: AssociateRow, companyCode: string, body: string) {
    const c = await this.companyByCode(companyCode);
    const text = (body ?? '').trim().slice(0, 2000);
    if (!text) throw new BadRequestException('Escreva a mensagem.');
    await this.prisma.$executeRaw(Prisma.sql`INSERT INTO ${T('kwanza_messages')} (id, "associateId", "companyId", sender, "senderName", body, "createdAt") VALUES (gen_random_uuid(), ${a.id}::uuid, ${c.id}::uuid, 'ASSOCIATE', ${a.name}, ${text}, now())`);
    await this.adminNotes.push(c.schemaName, { kind: 'KWANZA_MESSAGE', title: `Mensagem de ${a.name}`, body: text.slice(0, 160), section: 'kwanza', ref: `chat:${a.id}` });
    return this.thread(a.id, c.id);
  }
  private async thread(associateId: string, companyId: string) {
    const rows = await this.prisma.$queryRaw<{ id: string; sender: string; senderName: string; body: string; createdAt: Date }[]>(Prisma.sql`
      SELECT id, sender, "senderName", body, "createdAt" FROM ${T('kwanza_messages')} WHERE "associateId" = ${associateId}::uuid AND "companyId" = ${companyId}::uuid ORDER BY "createdAt" ASC LIMIT 500`);
    return rows.map((r) => ({ id: r.id, sender: r.sender, senderName: r.senderName, body: r.body, createdAt: r.createdAt.toISOString() }));
  }
  async companyChats(companyId: string) {
    const rows = await this.prisma.$queryRaw<{ aid: string; name: string; phone: string; photo: string | null; last: string; at: Date; unread: bigint }[]>(Prisma.sql`
      SELECT a.id::text AS aid, a.name, a.phone, a."photoUrl" AS photo,
        (SELECT body FROM ${T('kwanza_messages')} x WHERE x."associateId" = a.id AND x."companyId" = ${companyId}::uuid ORDER BY "createdAt" DESC LIMIT 1) AS last,
        MAX(m."createdAt") AS at, COUNT(*) FILTER (WHERE m.sender = 'ASSOCIATE' AND m."readAt" IS NULL) AS unread
      FROM ${T('kwanza_messages')} m JOIN ${T('kwanza_associates')} a ON a.id = m."associateId"
      WHERE m."companyId" = ${companyId}::uuid GROUP BY a.id ORDER BY at DESC`);
    return rows.map((r) => ({ associateId: r.aid, name: r.name, phone: r.phone, photoUrl: r.photo, last: r.last, at: r.at.toISOString(), unread: Number(r.unread) }));
  }
  async companyThread(companyId: string, associateId: string) {
    await this.prisma.$executeRaw(Prisma.sql`UPDATE ${T('kwanza_messages')} SET "readAt" = now() WHERE "associateId" = ${associateId}::uuid AND "companyId" = ${companyId}::uuid AND sender = 'ASSOCIATE' AND "readAt" IS NULL`);
    const co = await this.prisma.company.findUnique({ where: { id: companyId }, select: { schemaName: true } });
    if (co?.schemaName) {
      await this.prisma.runInTenant(co.schemaName, (tx) => tx.$executeRaw(Prisma.sql`UPDATE admin_notifications SET read_at = now() WHERE kind = 'KWANZA_MESSAGE' AND ref = ${`chat:${associateId}`} AND read_at IS NULL`)).catch(() => undefined);
    }
    return this.thread(associateId, companyId);
  }
  async companySend(companyId: string, associateId: string, senderName: string, body: string) {
    const text = (body ?? '').trim().slice(0, 2000);
    if (!text) throw new BadRequestException('Escreva a mensagem.');
    const ok = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT 1 AS n FROM ${T('kwanza_associates')} WHERE id = ${associateId}::uuid`);
    if (!ok.length) throw new NotFoundException('Associado não encontrado.');
    const c = await this.prisma.company.findUnique({ where: { id: companyId } });
    await this.prisma.$executeRaw(Prisma.sql`INSERT INTO ${T('kwanza_messages')} (id, "associateId", "companyId", sender, "senderName", body, "createdAt") VALUES (gen_random_uuid(), ${associateId}::uuid, ${companyId}::uuid, 'COMPANY', ${c?.name ?? senderName}, ${text}, now())`);
    await this.notifyAssociate(associateId, { kind: 'MESSAGE', title: `Mensagem de ${c?.name ?? 'uma empresa'}`, body: text.slice(0, 160), link: `#/mensagens/${c?.code ?? ''}` });
    return this.thread(associateId, companyId);
  }
}
