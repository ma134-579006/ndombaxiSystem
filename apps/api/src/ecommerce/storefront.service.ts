import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { computeInvoice, InvoiceLineInput, IvaCode, requiresExemptionReason, resolveRate, round2 } from '@nexus/agt-xml';
import { allocateDocumentNumber, formatCounterNumber } from '../common/document-counter';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutDto } from './dto/checkout.dto';

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
}

@Injectable()
export class StorefrontService {
  constructor(private readonly prisma: PrismaService) {}

  /** Catálogo público: produtos activos e visíveis online, com preço bruto (IVA incluído). */
  async catalog(schema: string): Promise<CatalogProduct[]> {
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
      const regWeb = await tx.$queryRaw<{ r: string | null }[]>(Prisma.sql`SELECT to_regclass('web_order_items')::text AS r`);
      const reservedExpr = regWeb[0]?.r
        ? Prisma.sql`COALESCE((SELECT SUM(wi.quantity)::float8 FROM web_order_items wi
                       JOIN web_orders wo ON wo.id = wi.order_id
                       WHERE wi.product_id = p.id AND wo.status = 'PENDING'), 0)`
        : Prisma.sql`0`;
      return tx.$queryRaw<CatalogRow[]>(
        Prisma.sql`SELECT p.id, p.code, p.name, p.description, p.iva_code, p.unit_price, p.stock_qty,
                          p.image_url, p.gallery, pc.name AS category,
                          ${hasRecipeExpr} AS has_recipe, p.is_production, ${inProdExpr} AS in_production,
                          ${reservedExpr} AS reserved
                   FROM products p
                   LEFT JOIN product_categories pc ON pc.id = p.category_id
                   WHERE p.is_active = TRUE AND p.show_online = TRUE AND p.is_ingredient = FALSE
                   ORDER BY p.name`,
      );
    });
    return rows.map((r) => {
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
      return {
        code: r.code,
        name: r.name,
        description: r.description,
        ivaCode: r.iva_code,
        netPrice,
        grossPrice: round2(netPrice * (1 + rate / 100)),
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
  async checkout(schema: string, dto: CheckoutDto): Promise<{ id: string; orderNumber: string; grossTotal: number }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const codes = dto.lines.map((l) => l.productCode);
      // FOR UPDATE serializa checkouts simultâneos do MESMO produto: o 2.º espera
      // pelo 1.º, vê a reserva já criada e não promete a última unidade duas vezes.
      const products = await tx.$queryRaw<CatalogRow[]>(
        Prisma.sql`SELECT id, code, name, description, iva_code, exemption_reason, exemption_code, unit_price, stock_qty, is_production
                   FROM products WHERE code IN (${Prisma.join(codes)}) AND is_active = TRUE
                   FOR UPDATE`,
      );
      const byCode = new Map(products.map((p) => [p.code, p]));

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
                     WHERE wi.product_id = ${p.id}::uuid AND wo.status = 'PENDING'`,
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
          exemptionReason,
          exemptionCode: p.exemption_code ?? undefined,
        };
      });
      const { lines, totals } = computeInvoice(lineInputs);

      const year = new Date().getFullYear();
      // Numeração atómica (sem race): contador por (kind, year).
      const sequence = await allocateDocumentNumber(tx, 'WEB', year);
      const orderNumber = formatCounterNumber('WEB', year, sequence);

      const hasGeo = Number.isFinite(dto.geoLat) && Number.isFinite(dto.geoLng);
      const orderRows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO web_orders
            (order_number, customer_name, customer_email, customer_phone, customer_tax_id,
             shipping_address, province, municipality, neighborhood, payment_method,
             status, net_total, iva_total, gross_total,
             geo_lat, geo_lng, geo_accuracy, geo_consent, geo_updated_at)
          VALUES (${orderNumber}, ${dto.customerName}, ${dto.customerEmail ?? null},
                  ${dto.customerPhone ?? null}, ${dto.customerTaxId ?? null},
                  ${dto.shippingAddress ?? null}, ${dto.province}, ${dto.municipality},
                  ${dto.neighborhood}, ${dto.paymentMethod ?? null}, 'PENDING',
                  ${totals.netTotal}, ${totals.ivaTotal}, ${totals.grossTotal},
                  ${hasGeo ? dto.geoLat : null}, ${hasGeo ? dto.geoLng : null},
                  ${hasGeo && Number.isFinite(dto.geoAccuracy) ? dto.geoAccuracy : null},
                  ${dto.geoConsent === true}, ${hasGeo ? Prisma.sql`now()` : Prisma.sql`NULL`})
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

      return { id: orderId, orderNumber, grossTotal: totals.grossTotal };
    });
  }
}
