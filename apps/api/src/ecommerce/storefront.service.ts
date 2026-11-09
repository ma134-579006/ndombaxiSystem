import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { computeInvoice, InvoiceLineInput, IvaCode, requiresExemptionReason, resolveRate, round2 } from '@nexus/agt-xml';
import { allocateDocumentNumber, formatCounterNumber } from '../common/document-counter';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutDto } from './dto/checkout.dto';
import { luandaYear } from '../common/luanda-date';
import { isPromoActive, type Promotion } from '../promotions/promo-engine';
import { checkCoupon } from './marketing.service';

interface PromoRow {
  id: string; name: string; type: string; scope: string; target_id: string | null;
  percent: string | null; amount: string | null; priority: number; is_active: boolean;
  starts_at: Date | null; ends_at: Date | null; weekdays: number[] | null;
  start_time: string | null; end_time: string | null;
}

/** Promoções de preço unitário (PERCENT/AMOUNT) activas agora — as mesmas da
 *  gestão (Promoções). Leve-X/pague-Y e escalões dependem da quantidade e
 *  ficam fora da loja online. */
async function activeUnitPromos(tx: Prisma.TransactionClient): Promise<Promotion[]> {
  const reg = await tx.$queryRaw<{ r: string | null }[]>(Prisma.sql`SELECT to_regclass('promotions')::text AS r`);
  if (!reg[0]?.r) return [];
  const rows = await tx.$queryRaw<PromoRow[]>(
    Prisma.sql`SELECT id, name, type, scope, target_id, percent, amount, priority, is_active,
                      starts_at, ends_at, weekdays, start_time, end_time
               FROM promotions WHERE is_active = TRUE AND type IN ('PERCENT','AMOUNT')`,
  );
  const now = new Date();
  return rows.map((r): Promotion => ({
    id: r.id, name: r.name, type: r.type as Promotion['type'], scope: r.scope as Promotion['scope'],
    targetId: r.target_id, percent: r.percent != null ? Number(r.percent) : null,
    amount: r.amount != null ? Number(r.amount) : null, priority: r.priority, active: r.is_active,
    startsAt: r.starts_at?.toISOString() ?? null, endsAt: r.ends_at?.toISOString() ?? null,
    weekdays: r.weekdays, startTime: r.start_time, endTime: r.end_time,
  })).filter((p) => isPromoActive(p, now));
}

/** Melhor desconto (fracção 0..1 do preço) para um produto. */
function bestPromo(promos: Promotion[], productId: string, categoryId: string | null, unitGross: number): { promo: Promotion; rate: number } | null {
  let best: { promo: Promotion; rate: number } | null = null;
  for (const p of promos) {
    const hit = p.scope === 'ALL' || (p.scope === 'PRODUCT' && p.targetId === productId)
      || (p.scope === 'CATEGORY' && !!categoryId && p.targetId === categoryId);
    if (!hit) continue;
    // AMOUNT é em Kz por unidade sobre o preço com IVA; converte-se em fracção do preço.
    const rate = p.type === 'PERCENT' ? (p.percent ?? 0) / 100 : unitGross > 0 ? (p.amount ?? 0) / unitGross : 0;
    const r = Math.min(1, Math.max(0, rate));
    if (r > 0 && (!best || r > best.rate || (r === best.rate && (p.priority ?? 0) > (best.promo.priority ?? 0)))) best = { promo: p, rate: r };
  }
  return best;
}

/** Motivo de isenção por omissão p/ IVA que o exige (igual ao do POS). */
const DEFAULT_EXEMPTION_REASON: Partial<Record<IvaCode, string>> = {
  [IvaCode.ISE]: 'Isento de IVA',
  [IvaCode.OUT]: 'Não sujeito a IVA',
};

interface CatalogRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  iva_code: IvaCode;
  exemption_reason: string | null;
  exemption_code: string | null;
  unit_price: string;
  stock_qty: string;
  image_url: string | null;
  gallery: unknown;
  category?: string | null;
  has_recipe?: boolean;
  is_production?: boolean;
  in_production?: string | number;
  reserved?: string | number;
  category_id?: string | null;
  sold?: string | number;
}

export interface CatalogProduct {
  code: string;
  name: string;
  description: string | null;
  ivaCode: IvaCode;
  netPrice: number;
  grossPrice: number;
  inStock: boolean;
  stockQty: number;
  /** Prato com ficha técnica: produzido SOB ENCOMENDA (stock próprio 0 por
   *  natureza). Vendável online — a emissão valida/baixa os ingredientes. */
  madeToOrder: boolean;
  /** Produto de PRODUÇÃO explícito: disponibilidade real (como no caixa). */
  isProduction?: boolean;
  /** 🟢 FREE (fornada pronta) / 🟡 BUSY (em produção) / 🔴 OUT (esgotado). */
  availability?: 'FREE' | 'BUSY' | 'OUT';
  /** Pode ser SOLICITADO à produção mesmo esgotado (encomenda p/ aprovação). */
  canProduce?: boolean;
  imageUrl: string | null;
  gallery: string[];
  category: string | null;
  /** Preço com IVA antes da promoção (só quando há promoção activa). */
  listPrice?: number;
  /** Promoção activa: nome, desconto (%) e fim (para a contagem decrescente). */
  promo?: { name: string; percent: number; endsAt: string | null };
  /** Unidades vendidas (facturas válidas), para "N vendidos". */
  sold?: number;
  /** Média e nº de avaliações visíveis. */
  rating?: number;
  reviews?: number;
}

@Injectable()
export class StorefrontService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * CACHE do catálogo por loja. Cada visitante pedia o catálogo inteiro a cada
   * 12 s e cada pedido refazia tudo — incluindo a soma das unidades vendidas de
   * TODO o histórico de faturas: 11 s por pedido numa loja com ~2 200 artigos,
   * no plano free do Render. Agora:
   *   • o catálogo serve-se da memória durante 10 s (stock quase em tempo real);
   *   • os "N vendidos" recalculam-se no máximo de 5 em 5 min;
   *   • pedidos em simultâneo da mesma loja partilham a MESMA consulta.
   */
  private readonly catalogCache = new Map<string, { at: number; data: Promise<CatalogProduct[]> }>();
  private readonly soldCache = new Map<string, { at: number; data: Map<string, number> }>();
  private static readonly CATALOG_TTL_MS = 10_000;
  private static readonly SOLD_TTL_MS = 5 * 60_000;

  /** Catálogo público: produtos activos e visíveis online, com preço bruto (IVA incluído). */
  async catalog(schema: string): Promise<CatalogProduct[]> {
    const hit = this.catalogCache.get(schema);
    if (hit && Date.now() - hit.at < StorefrontService.CATALOG_TTL_MS) return hit.data;
    const data = this.loadCatalog(schema);
    this.catalogCache.set(schema, { at: Date.now(), data });
    // Um erro não pode ficar em cache (o próximo pedido tenta de novo).
    data.catch(() => { if (this.catalogCache.get(schema)?.data === data) this.catalogCache.delete(schema); });
    return data;
  }

  private async loadCatalog(schema: string): Promise<CatalogProduct[]> {
    const soldHit = this.soldCache.get(schema);
    const soldFresh = soldHit && Date.now() - soldHit.at < StorefrontService.SOLD_TTL_MS ? soldHit.data : null;
    const rows = await this.prisma.runInTenant(schema, async (tx) => {
      // Pratos SOB ENCOMENDA (ficha técnica) têm stock próprio 0 por natureza —
      // são vendíveis online na mesma (a emissão valida/baixa os ingredientes).
      // Guarda to_regclass: tenants antigos podem não ter product_recipes.
      const reg = await tx.$queryRaw<{ r: string | null }[]>(
        Prisma.sql`SELECT to_regclass('product_recipes')::text AS r`,
      );
      const hasRecipeExpr = reg[0]?.r
        ? Prisma.sql`EXISTS (SELECT 1 FROM product_recipes r WHERE r.product_id = p.id)`
        : Prisma.sql`FALSE`;
      // Produção em andamento (itens em cozinha) — para a disponibilidade 🟡 Ocupado.
      const regOrders = await tx.$queryRaw<{ r: string | null }[]>(Prisma.sql`SELECT to_regclass('restaurant_order_items')::text AS r`);
      const inProdExpr = regOrders[0]?.r
        ? Prisma.sql`COALESCE((SELECT SUM(oi.quantity)::float8 FROM restaurant_order_items oi
                       JOIN restaurant_orders o ON o.id = oi.order_id
                       WHERE oi.product_id = p.id AND o.status = 'OPEN' AND oi.kitchen_status IN ('PENDING','PREPARING')), 0)`
        : Prisma.sql`0`;
      // RESERVA (Available-To-Promise): stock já prometido a encomendas online
      // PENDING (por confirmar). O catálogo mostra o stock DISPONÍVEL de facto,
      // evitando prometer a mesma última unidade a dois clientes / ao caixa.
      // Encomendas por pagar há mais de 48 h deixam de prender stock (um anónimo esgotava o catálogo).
      const regWeb = await tx.$queryRaw<{ r: string | null }[]>(Prisma.sql`SELECT to_regclass('web_order_items')::text AS r`);
      const reservedExpr = regWeb[0]?.r
        ? Prisma.sql`COALESCE((SELECT SUM(wi.quantity)::float8 FROM web_order_items wi
                       JOIN web_orders wo ON wo.id = wi.order_id
                       WHERE wi.product_id = p.id AND wo.status = 'PENDING' AND wo.created_at > now() - interval '48 hours'), 0)`
        : Prisma.sql`0`;
      // Unidades vendidas em facturas válidas (não anuladas) — "N vendidos" na montra.
      let soldBy = soldFresh;
      if (!soldBy) {
        const sold = await tx.$queryRaw<{ product_id: string; n: number }[]>(
          Prisma.sql`SELECT ii.product_id::text AS product_id, SUM(ii.quantity)::float8 AS n
                     FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
                     WHERE ii.product_id IS NOT NULL AND i.status <> 'A' AND i.doc_type IN ('FT','FR','FS')
                     GROUP BY ii.product_id`,
        ).catch(() => [] as { product_id: string; n: number }[]);
        soldBy = new Map(sold.map((x) => [x.product_id, Math.floor(Number(x.n))]));
        this.soldCache.set(schema, { at: Date.now(), data: soldBy });
      }
      const promos = await activeUnitPromos(tx).catch(() => [] as Promotion[]);
      const regRev = await tx.$queryRaw<{ r: string | null }[]>(Prisma.sql`SELECT to_regclass('store_reviews')::text AS r`);
      const revs = regRev[0]?.r
        ? await tx.$queryRaw<{ product_id: string; avg: number; n: number }[]>(
            Prisma.sql`SELECT product_id::text AS product_id, AVG(rating)::float8 AS avg, COUNT(*)::int AS n
                       FROM store_reviews WHERE NOT is_hidden GROUP BY product_id`,
          ).catch(() => [] as { product_id: string; avg: number; n: number }[])
        : [];
      const revBy = new Map(revs.map((x) => [x.product_id, x]));
      const list = await tx.$queryRaw<CatalogRow[]>(
        Prisma.sql`SELECT p.id, p.code, p.name, p.description, p.iva_code, p.unit_price, p.stock_qty,
                          p.image_url, p.gallery, pc.name AS category, p.category_id::text AS category_id,
                          ${hasRecipeExpr} AS has_recipe, p.is_production, ${inProdExpr} AS in_production,
                          ${reservedExpr} AS reserved
                   FROM products p
                   LEFT JOIN product_categories pc ON pc.id = p.category_id
                   WHERE p.is_active = TRUE AND p.show_online = TRUE AND p.is_ingredient = FALSE
                   ORDER BY p.name`,
      );
      return { list, promos, soldBy, revBy };
    });
    const { promos, soldBy, revBy } = rows;
    return rows.list.map((r) => {
      const netPrice = Number(r.unit_price);
      const rate = resolveRate(r.iva_code);
      const madeToOrder = !!r.has_recipe;
      const isProduction = !!r.is_production;
      const rawStock = Math.max(0, Math.floor(Number(r.stock_qty)));
      // Desconta o que já está reservado a encomendas online por confirmar
      // (só produtos comerciais; a produção gere-se por fornadas/disponibilidade).
      const reserved = Math.max(0, Math.floor(Number(r.reserved ?? 0)));
      const stock = isProduction ? rawStock : Math.max(0, rawStock - reserved);
      // PRODUÇÃO: disponibilidade real (como no caixa) — 🟢 há fornada / 🟡 em produção
      // / 🔴 esgotado. O cliente pode SOLICITAR PRODUÇÃO mesmo esgotado (canProduce).
      const availability: 'FREE' | 'BUSY' | 'OUT' | undefined = isProduction
        ? (stock > 0 ? 'FREE' : Number(r.in_production) > 0 ? 'BUSY' : 'OUT')
        : undefined;
      const listGross = round2(netPrice * (1 + rate / 100));
      const bp = bestPromo(promos, r.id, r.category_id ?? null, listGross);
      // Mesmo cálculo da encomenda (desconto por linha sobre o líquido) → o preço mostrado é o cobrado.
      const promoGross = bp ? computeInvoice([{ productCode: r.code, description: r.name, quantity: 1, unitPrice: netPrice, ivaCode: r.iva_code, discountRate: bp.rate, exemptionReason: requiresExemptionReason(r.iva_code) ? 'Isento' : undefined }]).totals.grossTotal : listGross;
      const n = soldBy.get(r.id) ?? 0;
      return {
        code: r.code,
        name: r.name,
        description: r.description,
        ivaCode: r.iva_code,
        netPrice,
        grossPrice: promoGross,
        ...(bp && promoGross < listGross ? {
          listPrice: listGross,
          promo: { name: bp.promo.name, percent: Math.round(bp.rate * 100), endsAt: bp.promo.endsAt ?? null },
        } : {}),
        ...(n > 0 ? { sold: n } : {}),
        ...(revBy.get(r.id) ? { rating: Math.round(revBy.get(r.id)!.avg * 10) / 10, reviews: revBy.get(r.id)!.n } : {}),
        // Produção: "em stock" = há fornada pronta (🟢). Sob encomenda legado
        // (has_recipe sem is_production): sempre disponível. Comercial: stock>0.
        inStock: isProduction ? availability === 'FREE' : madeToOrder ? true : stock > 0,
        stockQty: stock,
        madeToOrder,
        isProduction,
        availability,
        canProduce: isProduction, // produção pode ser solicitada mesmo esgotado
        imageUrl: r.image_url,
        gallery: Array.isArray(r.gallery) ? (r.gallery as string[]) : [],
        category: r.category ?? null,
      };
    });
  }

  /** Cria uma encomenda online em estado PENDING (sem emitir factura ainda). */
  /** `couponEmail`: email verificado da sessão do cliente (obrigatório para usar cupão). */
  async checkout(schema: string, dto: CheckoutDto, couponEmail?: string | null): Promise<{ id: string; orderNumber: string; grossTotal: number; couponDiscount?: number }> {
    // Linhas repetidas do mesmo produto juntam-se numa só: senão cada uma era
    // validada isoladamente contra o stock livre e, somadas, excediam-no.
    const merged = new Map<string, CheckoutDto['lines'][number]>();
    for (const l of dto.lines) {
      const prev = merged.get(l.productCode);
      merged.set(l.productCode, prev ? { ...prev, quantity: prev.quantity + l.quantity } : { ...l });
    }
    dto = { ...dto, lines: [...merged.values()] };
    return this.prisma.runInTenant(schema, async (tx) => {
      const codes = dto.lines.map((l) => l.productCode);
      // FOR UPDATE serializa checkouts simultâneos do MESMO produto: o 2.º espera
      // pelo 1.º, vê a reserva já criada e não promete a última unidade duas vezes.
      const products = await tx.$queryRaw<CatalogRow[]>(
        Prisma.sql`SELECT id, code, name, description, iva_code, exemption_reason, exemption_code, unit_price, stock_qty, is_production
                   FROM products WHERE code IN (${Prisma.join(codes)}) AND is_active = TRUE
                     AND show_online = TRUE AND COALESCE(is_ingredient, FALSE) = FALSE
                   FOR UPDATE`,
      );
      const byCode = new Map(products.map((p) => [p.code, p]));
      // Promoções activas: o mesmo desconto que a montra mostra (nunca vem do cliente).
      const promos = await activeUnitPromos(tx).catch(() => [] as Promotion[]);
      const catRows = products.length > 0
        ? await tx.$queryRaw<{ id: string; category_id: string | null }[]>(
            Prisma.sql`SELECT id::text AS id, category_id::text AS category_id FROM products
                       WHERE id IN (${Prisma.join(products.map((p) => Prisma.sql`${p.id}::uuid`))})`,
          )
        : [];
      const catOf = new Map(catRows.map((x) => [x.id, x.category_id]));

      // Available-To-Promise: para produtos COMERCIAIS (não produção, não sob
      // encomenda), o pedido não pode exceder o stock livre = stock − reservado
      // por outras encomendas PENDING. Produção/pratos sob encomenda não têm
      // este limite (gerem-se por fornadas/ficha técnica).
      const hasRecipeRows = products.length > 0
        ? await tx.$queryRaw<{ product_id: string }[]>(
            Prisma.sql`SELECT DISTINCT r.product_id FROM product_recipes r
                       WHERE r.product_id IN (${Prisma.join(products.map((p) => Prisma.sql`${p.id}::uuid`))})`,
          ).catch(() => [] as { product_id: string }[])
        : [];
      const recipeSet = new Set(hasRecipeRows.map((x) => x.product_id));
      for (const line of dto.lines) {
        const p = byCode.get(line.productCode);
        if (!p) continue; // validado a seguir com mensagem própria
        if (p.is_production || recipeSet.has(p.id)) continue; // sem limite de stock
        const reservedRows = await tx.$queryRaw<{ n: number }[]>(
          Prisma.sql`SELECT COALESCE(SUM(wi.quantity), 0)::float8 AS n
                     FROM web_order_items wi JOIN web_orders wo ON wo.id = wi.order_id
                     WHERE wi.product_id = ${p.id}::uuid AND wo.status = 'PENDING' AND wo.created_at > now() - interval '48 hours'`,
        ).catch(() => [{ n: 0 }]);
        const available = Math.max(0, Math.floor(Number(p.stock_qty)) - Math.floor(Number(reservedRows[0]?.n ?? 0)));
        if (line.quantity > available) {
          throw new BadRequestException(
            available > 0
              ? `"${p.name}" só tem ${available} em stock disponível (o resto está reservado a outras encomendas).`
              : `"${p.name}" esgotou — acabou de ser vendido/reservado. Tente outro produto.`,
          );
        }
      }

      const lineInputs: InvoiceLineInput[] = dto.lines.map((l) => {
        const p = byCode.get(l.productCode);
        if (!p) throw new BadRequestException(`Produto indisponível: ${l.productCode}`);
        // IVA isento/não-sujeito exige motivo (senão computeInvoice rebenta).
        const exemptionReason = requiresExemptionReason(p.iva_code)
          ? (p.exemption_reason?.trim() || DEFAULT_EXEMPTION_REASON[p.iva_code] || 'Isento')
          : undefined;
        return {
          productCode: l.productCode,
          description: p.name,
          quantity: l.quantity,
          unitPrice: Number(p.unit_price),
          ivaCode: p.iva_code,
          ...(() => {
            const gross = round2(Number(p.unit_price) * (1 + resolveRate(p.iva_code) / 100));
            const bp = bestPromo(promos, p.id, catOf.get(p.id) ?? null, gross);
            return bp ? { discountRate: bp.rate } : {};
          })(),
          exemptionReason,
          exemptionCode: p.exemption_code ?? undefined,
        };
      });
      let { lines, totals } = computeInvoice(lineInputs);

      // Cupão: desconto sobre o total já com promoções, repartido por todas as
      // linhas (taxa extra por linha) — a fatura herda-o pelo líquido congelado.
      let couponCode: string | null = null;
      let couponDiscount = 0;
      if (dto.couponCode?.trim()) {
        if (!couponEmail) throw new BadRequestException('Inicie sessão para usar um cupão.');
        const { coupon, discount } = await checkCoupon(tx, dto.couponCode, couponEmail, totals.grossTotal, true);
        const f = totals.grossTotal > 0 ? discount / totals.grossTotal : 0;
        if (f > 0) {
          const before = totals.grossTotal;
          ({ lines, totals } = computeInvoice(lineInputs.map((l) => ({ ...l, discountRate: Math.min(1, 1 - (1 - (l.discountRate ?? 0)) * (1 - f)) }))));
          couponCode = coupon.code;
          couponDiscount = Math.round((before - totals.grossTotal) * 100) / 100;
        }
      }

      const year = luandaYear();
      // Numeração atómica (sem race): contador por (kind, year).
      const sequence = await allocateDocumentNumber(tx, 'WEB', year);
      const orderNumber = formatCounterNumber('WEB', year, sequence);

      const hasGeo = Number.isFinite(dto.geoLat) && Number.isFinite(dto.geoLng);
      const orderRows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO web_orders
            (order_number, customer_name, customer_email, customer_phone, customer_tax_id,
             shipping_address, province, municipality, neighborhood, payment_method,
             status, net_total, iva_total, gross_total,
             geo_lat, geo_lng, geo_accuracy, geo_consent, geo_updated_at, delivery_method, notes${couponCode ? Prisma.sql`, coupon_code, coupon_discount` : Prisma.empty})
          VALUES (${orderNumber}, ${dto.customerName || 'Cliente'}, ${dto.customerEmail ?? null},
                  ${dto.customerPhone ?? null}, ${dto.customerTaxId ?? null},
                  ${dto.shippingAddress ?? null}, ${dto.province ?? null}, ${dto.municipality ?? null},
                  ${dto.neighborhood ?? null}, ${dto.paymentMethod ?? null}, 'PENDING',
                  ${totals.netTotal}, ${totals.ivaTotal}, ${totals.grossTotal},
                  ${hasGeo ? dto.geoLat : null}, ${hasGeo ? dto.geoLng : null},
                  ${hasGeo && Number.isFinite(dto.geoAccuracy) ? dto.geoAccuracy : null},
                  ${dto.geoConsent === true}, ${hasGeo ? Prisma.sql`now()` : Prisma.sql`NULL`},
                  ${dto.deliveryMethod === 'PICKUP' ? 'PICKUP' : 'DELIVERY'}, ${dto.notes?.trim() || null}${couponCode ? Prisma.sql`, ${couponCode}, ${couponDiscount}` : Prisma.empty})
          RETURNING id`,
      );
      const orderId = orderRows[0].id;

      let lineNumber = 0;
      for (const line of lines) {
        lineNumber += 1;
        const p = byCode.get(line.productCode)!;
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO web_order_items
              (order_id, line_number, product_id, product_code, description, quantity,
               unit_price, iva_code, iva_rate, net_amount, iva_amount, gross_amount)
            VALUES (${orderId}::uuid, ${lineNumber}, ${p.id}::uuid, ${line.productCode},
                    ${line.description}, ${line.quantity}, ${line.unitPrice}, ${line.ivaCode},
                    ${line.ivaRate}, ${line.netAmount}, ${line.ivaAmount}, ${line.grossAmount})`,
        );
      }

      return { id: orderId, orderNumber, grossTotal: totals.grossTotal, ...(couponCode ? { couponDiscount } : {}) };
    });
  }
}
