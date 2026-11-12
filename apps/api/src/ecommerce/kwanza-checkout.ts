import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AdminNotificationsService } from './admin-notifications';
import { KwanzaService } from './kwanza.service';
import { OrdersService } from './orders.service';
import { StorefrontService } from './storefront.service';
import type { CheckoutDto } from './dto/checkout.dto';

/**
 * LPS Kwanza — a compra faz-se TODA no marketplace (nunca na loja da empresa): o cliente,
 * sem conta, junta ao carrinho, dá os seus dados e a localização GPS (obrigatória) e a
 * encomenda nasce na loja da empresa já com o associado que a trouxe. O cliente acompanha
 * as compras com o código guardado no aparelho (ou telefone + n.º da encomenda) e envia a
 * localização em tempo real enquanto a entrega está ativa.
 */
const T = (name: string) => Prisma.raw(`nexus_public."${name}"`);
const digits = (p: string) => String(p ?? '').replace(/\D/g, '').replace(/^244(?=\d{9}$)/, '');
const num = (v: unknown) => Number(v ?? 0) || 0;

class LineDto {
  @IsString() @MaxLength(80) productCode!: string;
  @Type(() => Number) @IsNumber() @Min(0.001) @Max(10_000) quantity!: number;
}
class KCheckoutDto {
  @IsString() @MaxLength(60) companyCode!: string;
  @IsOptional() @IsString() @MaxLength(12) associateCode?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => LineDto) lines!: LineDto[];
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @MaxLength(20) phone!: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(80) province?: string;
  @IsOptional() @IsString() @MaxLength(80) municipality?: string;
  @IsOptional() @IsIn(['PICKUP', 'DELIVERY']) deliveryMethod?: 'PICKUP' | 'DELIVERY';
  @IsOptional() @IsString() @MaxLength(40) paymentMethod?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) geoLat!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) geoLng!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) geoAccuracy?: number;
  @Equals(true, { message: 'É obrigatório partilhar a localização GPS para concluir a encomenda.' }) geoConsent!: boolean;
  @IsOptional() @IsString() @MaxLength(64) device?: string;
}
class TokensDto { @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(64, { each: true }) tokens!: string[]; }
class FindDto { @IsString() @MaxLength(20) phone!: string; @IsString() @MaxLength(40) orderNumber!: string; }
class LocDto {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) accuracy?: number;
}

@Injectable()
export class KwanzaCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storefront: StorefrontService,
    private readonly kwanza: KwanzaService,
    private readonly orders: OrdersService,
    private readonly notes: AdminNotificationsService,
  ) {}

  private async company(code: string) {
    const c = await this.prisma.company.findUnique({ where: { code } });
    if (!c || c.status !== 'ACTIVE') throw new NotFoundException('Empresa não encontrada.');
    return c;
  }

  async checkout(d: KCheckoutDto) {
    const c = await this.company(d.companyCode);
    const phone = digits(d.phone);
    if (phone.length < 9) throw new BadRequestException('Indique um número de telemóvel válido.');
    if (d.deliveryMethod !== 'PICKUP' && (d.address ?? '').trim().length < 4) throw new BadRequestException('Indique a morada de entrega.');
    // Só produtos que a empresa publicou no LPS Kwanza.
    const codes = [...new Set(d.lines.map((l) => l.productCode))];
    const live = await this.prisma.$queryRaw<{ code: string }[]>(Prisma.sql`
      SELECT "productCode" AS code FROM ${T('kwanza_listings')} WHERE "companyId" = ${c.id}::uuid AND active = TRUE AND "productCode" = ANY(${codes}::text[])`);
    const missing = codes.filter((x) => !live.some((l) => l.code === x));
    if (missing.length) throw new BadRequestException('Há produtos no carrinho que já não estão à venda. Atualize o carrinho.');

    // Associado: só um ativo; sem comissão das próprias compras (mesmo telefone).
    let assoc = (d.associateCode ?? '').trim().toUpperCase();
    if (assoc) {
      const a = await this.prisma.$queryRaw<{ phone: string; status: string }[]>(Prisma.sql`SELECT phone, status FROM ${T('kwanza_associates')} WHERE code = ${assoc}`);
      if (!a[0] || a[0].status !== 'ACTIVE' || digits(a[0].phone).slice(-9) === phone.slice(-9)) assoc = '';
    }
    const markups = assoc ? await this.kwanza.markupsFor(c.id, assoc).catch(() => ({})) : {};
    const dto = {
      lines: d.lines.map((l) => ({ productCode: l.productCode, quantity: l.quantity })),
      customerName: d.name.trim(), customerPhone: phone, shippingAddress: d.address?.trim() || undefined,
      province: d.province?.trim() || undefined, municipality: d.municipality?.trim() || undefined,
      deliveryMethod: d.deliveryMethod === 'PICKUP' ? 'PICKUP' : 'DELIVERY', paymentMethod: d.paymentMethod || undefined,
      notes: [d.notes?.trim(), 'LPS Kwanza'].filter(Boolean).join(' · ').slice(0, 500),
      geoLat: d.geoLat, geoLng: d.geoLng, geoAccuracy: d.geoAccuracy, geoConsent: true,
      affiliateCode: assoc || undefined,
    } as unknown as CheckoutDto;
    const r = await this.storefront.checkout(c.schemaName, dto, null, markups);
    if (assoc) await this.kwanza.attribute({ companyId: c.id, schema: c.schemaName }, c.code, r.id, assoc, null, markups).catch(() => undefined);
    const token = randomBytes(18).toString('base64url');
    const associate = assoc ? await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM ${T('kwanza_associates')} WHERE code = ${assoc}`) : [];
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${T('kwanza_orders')} (id, token, "companyId", "companyCode", "orderId", "orderNumber", "associateId", phone, device, "createdAt")
      VALUES (gen_random_uuid(), ${token}, ${c.id}::uuid, ${c.code}, ${r.id}::uuid, ${r.orderNumber}, ${associate[0]?.id ?? null}::uuid, ${phone.slice(-9)}, ${d.device?.slice(0, 64) ?? null}, now())`);
    await this.notes.push(c.schemaName, {
      kind: 'ORDER', title: `Nova encomenda ${r.orderNumber} (LPS Kwanza)`,
      body: `${d.name.trim()} · ${num(r.grossTotal).toLocaleString('pt-PT')} Kz · GPS${assoc ? ` · associado ${assoc}` : ''}`, section: 'orders',
    }).catch(() => undefined);
    return { token, orderId: r.id, orderNumber: r.orderNumber, grossTotal: num(r.grossTotal), companyCode: c.code, companyName: c.name };
  }

  /** As compras guardadas neste aparelho (códigos), com o estado atual de cada uma. */
  async list(tokens: string[]) {
    const ok = tokens.filter((t) => /^[A-Za-z0-9_-]{16,64}$/.test(t)).slice(0, 100);
    if (!ok.length) return [];
    const rows = await this.prisma.$queryRaw<{ token: string; companyId: string; orderId: string }[]>(Prisma.sql`
      SELECT token, "companyId"::text AS "companyId", "orderId"::text AS "orderId" FROM ${T('kwanza_orders')} WHERE token = ANY(${ok}::text[]) ORDER BY "createdAt" DESC`);
    const out: unknown[] = [];
    for (const r of rows) { const v = await this.view(r.token).catch(() => null); if (v) out.push(v); }
    return out;
  }

  async view(token: string) {
    const k = await this.prisma.$queryRaw<{ companyId: string; orderId: string; companyCode: string }[]>(Prisma.sql`
      SELECT "companyId"::text AS "companyId", "orderId"::text AS "orderId", "companyCode" FROM ${T('kwanza_orders')} WHERE token = ${token}`);
    if (!k[0]) throw new NotFoundException('Compra não encontrada.');
    const c = await this.prisma.company.findUnique({ where: { id: k[0].companyId } });
    if (!c) throw new NotFoundException('Compra não encontrada.');
    const [o, items] = await this.prisma.runInTenant(c.schemaName, async (tx) => Promise.all([
      tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        SELECT id::text, order_number, status, gross_total, payment_method, (payment_claimed_at IS NOT NULL OR EXISTS (SELECT 1 FROM payment_proofs pp WHERE pp.order_id = web_orders.id AND pp.status = 'PENDING')) AS payment_claimed_at, delivery_method, shipping_address,
               customer_name, geo_lat, geo_lng, geo_updated_at, invoice_id IS NOT NULL AS invoiced, created_at, updated_at
        FROM web_orders WHERE id = ${k[0].orderId}::uuid`),
      tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        SELECT i.product_code, i.description, i.quantity, i.gross_amount, p.image_url
        FROM web_order_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = ${k[0].orderId}::uuid ORDER BY i.line_number`),
    ]));
    const w = o[0];
    if (!w) throw new NotFoundException('Compra não encontrada.');
    return {
      token, companyCode: c.code, companyName: c.name, orderId: w.id, orderNumber: w.order_number, status: w.status,
      total: num(w.gross_total), paymentMethod: w.payment_method, paymentClaimed: !!w.payment_claimed_at, deliveryMethod: w.delivery_method,
      address: w.shipping_address, invoiced: !!w.invoiced, gpsAt: w.geo_updated_at ? (w.geo_updated_at as Date).toISOString() : null,
      date: (w.created_at as Date).toISOString(), updatedAt: (w.updated_at as Date).toISOString(),
      items: items.map((i) => ({ productCode: i.product_code, name: i.description, quantity: num(i.quantity), total: num(i.gross_amount), imageUrl: i.image_url ?? null })),
    };
  }

  /** Recuperar uma compra noutro aparelho: telefone da encomenda + n.º da encomenda. */
  async find(phone: string, orderNumber: string) {
    const r = await this.prisma.$queryRaw<{ token: string }[]>(Prisma.sql`
      SELECT token FROM ${T('kwanza_orders')} WHERE phone = ${digits(phone).slice(-9)} AND upper("orderNumber") = ${orderNumber.trim().toUpperCase()} LIMIT 1`);
    if (!r[0]) throw new NotFoundException('Não encontrámos essa compra. Confirme o telefone e o número da encomenda.');
    return this.view(r[0].token);
  }

  /** Localização do cliente em tempo real (só enquanto a entrega está ativa). */
  async location(token: string, l: LocDto) {
    const k = await this.prisma.$queryRaw<{ companyId: string; orderId: string }[]>(Prisma.sql`
      SELECT "companyId"::text AS "companyId", "orderId"::text AS "orderId" FROM ${T('kwanza_orders')} WHERE token = ${token}`);
    if (!k[0]) throw new NotFoundException('Compra não encontrada.');
    const c = await this.prisma.company.findUnique({ where: { id: k[0].companyId } });
    if (!c) throw new NotFoundException('Compra não encontrada.');
    return this.orders.updateLocation(c.schemaName, k[0].orderId, { lat: l.lat, lng: l.lng, accuracy: l.accuracy });
  }
}

@ApiTags('kwanza')
@Public()
@Controller('kwanza')
export class KwanzaCheckoutController {
  constructor(private readonly s: KwanzaCheckoutService, private readonly k: KwanzaService) {}
  @Get('listing/:companyCode/:productCode') @ApiOperation({ summary: 'Produto pela ligação de um associado (cliente sem conta)' })
  listing(@Param('companyCode') c: string, @Param('productCode') p: string, @Query('a') a?: string) { return this.k.listing(c, p, a); }
  @Post('checkout') @Throttle({ default: { limit: 20, ttl: 60_000 } }) @ApiOperation({ summary: 'Compra no LPS Kwanza (sem conta; GPS obrigatório)' })
  checkout(@Body() d: KCheckoutDto) { return this.s.checkout(d); }
  @Post('orders/list') @ApiOperation({ summary: 'Compras guardadas neste aparelho' })
  list(@Body() d: TokensDto) { return this.s.list(d.tokens); }
  @Post('orders/find') @Throttle({ default: { limit: 10, ttl: 60_000 } }) @ApiOperation({ summary: 'Recuperar uma compra (telefone + n.º da encomenda)' })
  find(@Body() d: FindDto) { return this.s.find(d.phone, d.orderNumber); }
  @Get('orders/:token') @ApiOperation({ summary: 'Estado de uma compra' })
  view(@Param('token') t: string, @Query('x') _x?: string) { return this.s.view(t); }
  @Post('orders/:token/location') @ApiOperation({ summary: 'Localização do cliente em tempo real' })
  location(@Param('token') t: string, @Body() d: LocDto) { return this.s.location(t, d); }
}
