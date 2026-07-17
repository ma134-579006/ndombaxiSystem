import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../erp/stock.service';
import { TenantAuditService } from '../cashbox/tenant-audit.service';

/** IVA por código (espelha o frontend) — para congelar o preço c/ IVA na comanda. */
const IVA_RATE: Record<string, number> = { NOR: 14, INT: 7, RED: 5, ISE: 0, NS: 0 };

export interface TableRow {
  id: string; code: string; name: string; area: string | null; seats: number;
  is_active: boolean; sort_order: number;
}

@Injectable()
export class RestaurantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: TenantAuditService,
  ) {}

  /** A coluna product_recipes.waste_pct pode ainda não existir (auto-migração
   *  em fundo nos tenants antigos) — verificar antes de a usar, senão as
   *  fichas técnicas rebentavam com 42703 até a migração chegar. */
  private async hasWasteCol(tx: Prisma.TransactionClient): Promise<boolean> {
    const rows = await tx.$queryRaw<{ n: number }[]>(
      Prisma.sql`SELECT COUNT(*)::int AS n FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'product_recipes' AND column_name = 'waste_pct'`,
    );
    return (rows[0]?.n ?? 0) > 0;
  }

  // ── Mesas ──────────────────────────────────────────────────
  /**
   * DISPONIBILIDADE dos produtos de PRODUÇÃO (🟢 Livre / 🟡 Ocupado / 🔴 Esgotado).
   * Derivada (sem novas tabelas): Livre = há produção pronta (stock das fornadas);
   * Ocupado = há produção em andamento (itens em cozinha PENDING/PREPARING);
   * Esgotado = sem produção pronta nem em curso. Guardado por to_regclass —
   * tenants sem restaurant_orders só olham ao stock.
   */
  async productionAvailability(schema: string): Promise<{ id: string; name: string; stock: number; inProduction: number; status: 'FREE' | 'BUSY' | 'OUT' }[]> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const reg = await tx.$queryRaw<{ r: string | null }[]>(Prisma.sql`SELECT to_regclass('restaurant_order_items')::text AS r`);
      const inProdExpr = reg[0]?.r
        ? Prisma.sql`COALESCE((SELECT SUM(oi.quantity)::float8 FROM restaurant_order_items oi
                       JOIN restaurant_orders o ON o.id = oi.order_id
                       WHERE oi.product_id = p.id AND o.status = 'OPEN' AND oi.kitchen_status IN ('PENDING','PREPARING')), 0)`
        : Prisma.sql`0`;
      const rows = await tx.$queryRaw<{ id: string; name: string; stock: string; in_production: string }[]>(Prisma.sql`
        SELECT p.id, p.name, p.stock_qty AS stock, ${inProdExpr} AS in_production
        FROM products p WHERE p.is_active = TRUE AND p.is_production = TRUE
        ORDER BY p.name`);
      return rows.map((r) => {
        const stock = Number(r.stock); const inProduction = Number(r.in_production);
        const status: 'FREE' | 'BUSY' | 'OUT' = stock > 0 ? 'FREE' : inProduction > 0 ? 'BUSY' : 'OUT';
        return { id: r.id, name: r.name, stock, inProduction, status };
      });
    });
  }

  /**
   * RELATÓRIO comercial vs PRODUÇÃO (fatia 7 do roadmap): vendas faturadas do
   * período separadas em produtos de produção (fabricados — is_production) e
   * comerciais (revenda). Só LEITURA sobre invoices/invoice_items; margem =
   * preço − custo unitário congelado na venda (unit_cost da linha).
   */
  async salesReport(schema: string, days: number) {
    const d = Math.max(1, Math.min(365, Math.floor(days) || 1));
    return this.prisma.runInTenant(schema, async (tx) => {
      const groups = await tx.$queryRaw<{
        production: boolean; revenue: number; qty: number; cost: number; lines: number;
      }[]>(Prisma.sql`
        SELECT COALESCE(p.is_production, FALSE) AS production,
               COALESCE(SUM(ii.gross_amount), 0)::float8 AS revenue,
               COALESCE(SUM(ii.quantity), 0)::float8 AS qty,
               COALESCE(SUM(ii.unit_cost * ii.quantity), 0)::float8 AS cost,
               COUNT(*)::int AS lines
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id
        LEFT JOIN products p ON p.id = ii.product_id
        WHERE i.status = 'N' AND i.doc_type IN ('FT','FS')
          AND i.invoice_date >= CURRENT_DATE - (${d - 1} * INTERVAL '1 day')
        GROUP BY 1`);
      const top = await tx.$queryRaw<{
        production: boolean; description: string; qty: number; revenue: number;
      }[]>(Prisma.sql`
        SELECT COALESCE(p.is_production, FALSE) AS production, ii.description,
               COALESCE(SUM(ii.quantity), 0)::float8 AS qty,
               COALESCE(SUM(ii.gross_amount), 0)::float8 AS revenue
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id
        LEFT JOIN products p ON p.id = ii.product_id
        WHERE i.status = 'N' AND i.doc_type IN ('FT','FS')
          AND i.invoice_date >= CURRENT_DATE - (${d - 1} * INTERVAL '1 day')
        GROUP BY 1, 2 ORDER BY 4 DESC`);
      const shape = (production: boolean) => {
        const g = groups.find((x) => x.production === production);
        const revenue = g?.revenue ?? 0; const cost = g?.cost ?? 0;
        return {
          revenue: Math.round(revenue * 100) / 100,
          qty: g?.qty ?? 0,
          lines: g?.lines ?? 0,
          cost: Math.round(cost * 100) / 100,
          margin: Math.round((revenue - cost) * 100) / 100,
          marginPct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : 0,
          top: top.filter((t) => t.production === production).slice(0, 8)
            .map((t) => ({ description: t.description, qty: t.qty, revenue: Math.round(t.revenue * 100) / 100 })),
        };
      };
      return { days: d, commercial: shape(false), production: shape(true) };
    });
  }

  listTables(schema: string): Promise<TableRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<TableRow[]>(Prisma.sql`SELECT id, code, name, area, seats, is_active, sort_order
        FROM restaurant_tables WHERE is_active = TRUE ORDER BY sort_order, name`),
    );
  }

  async createTable(schema: string, input: { code?: string; name: string; area?: string; seats?: number }): Promise<TableRow> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Indique o nome da mesa.');
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<TableRow[]>(Prisma.sql`INSERT INTO restaurant_tables (code, name, area, seats)
        VALUES (${input.code?.trim() || name}, ${name}, ${input.area?.trim() || null}, ${input.seats ?? 4})
        RETURNING id, code, name, area, seats, is_active, sort_order`),
    );
    return rows[0];
  }

  async removeTable(schema: string, id: string): Promise<{ ok: true }> {
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE restaurant_tables SET is_active = FALSE WHERE id = ${id}::uuid`));
    return { ok: true };
  }

  // ── Comandas (orders) ──────────────────────────────────────
  /** Mesas + a comanda OPEN de cada uma (se houver) — para o "mapa de mesas". */
  async tableMap(schema: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT t.id, t.code, t.name, t.area, t.seats,
          o.id AS order_id, o.total AS order_total, o.guests, o.opened_at_label,
          o.created_at AS opened_at
        FROM restaurant_tables t
        LEFT JOIN LATERAL (
          SELECT id, total, guests, created_at, to_char(created_at, 'HH24:MI') AS opened_at_label
          FROM restaurant_orders WHERE table_id = t.id AND status = 'OPEN'
          ORDER BY created_at DESC LIMIT 1
        ) o ON TRUE
        WHERE t.is_active = TRUE ORDER BY t.sort_order, t.name`),
    );
  }

  async openOrder(schema: string, tableId: string, opener: { id: string; name: string }, guests = 1, customerName?: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const t = await tx.$queryRaw<{ name: string }[]>(Prisma.sql`SELECT name FROM restaurant_tables WHERE id = ${tableId}::uuid`);
      if (!t[0]) throw new NotFoundException('Mesa não encontrada.');
      const existing = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM restaurant_orders WHERE table_id = ${tableId}::uuid AND status = 'OPEN' LIMIT 1`);
      if (existing[0]) return existing[0]; // já tem comanda aberta → devolve-a
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO restaurant_orders (table_id, table_name, guests, customer_name, opened_by, opened_by_name)
        VALUES (${tableId}::uuid, ${t[0].name}, ${guests}, ${customerName?.trim() || null}, ${opener.id}::uuid, ${opener.name})
        RETURNING id`);
      return rows[0];
    });
  }

  async getOrder(schema: string, orderId: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const o = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT * FROM restaurant_orders WHERE id = ${orderId}::uuid`);
      if (!o[0]) throw new NotFoundException('Comanda não encontrada.');
      const items = await tx.$queryRaw(Prisma.sql`SELECT id, product_code, description, unit_price, quantity, kitchen_status, notes, created_at
        FROM restaurant_order_items WHERE order_id = ${orderId}::uuid ORDER BY created_at`);
      return { order: o[0], items };
    });
  }

  private async recomputeTotal(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    await tx.$executeRaw(Prisma.sql`UPDATE restaurant_orders SET total = COALESCE(
      (SELECT SUM(unit_price * quantity) FROM restaurant_order_items WHERE order_id = ${orderId}::uuid), 0)
      WHERE id = ${orderId}::uuid`);
  }

  async addItem(schema: string, orderId: string, productCode: string, quantity: number, by: string, notes?: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const ord = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status FROM restaurant_orders WHERE id = ${orderId}::uuid`);
      if (!ord[0]) throw new NotFoundException('Comanda não encontrada.');
      if (ord[0].status !== 'OPEN') throw new BadRequestException('A comanda não está aberta.');
      const p = await tx.$queryRaw<{ id: string; name: string; unit_price: string; iva_code: string }[]>(
        Prisma.sql`SELECT id, name, unit_price, iva_code FROM products WHERE code = ${productCode} AND is_active = TRUE LIMIT 1`);
      if (!p[0]) throw new NotFoundException('Produto não encontrado.');
      const gross = Math.round(Number(p[0].unit_price) * (1 + (IVA_RATE[p[0].iva_code] ?? 14) / 100) * 100) / 100;
      const qty = quantity > 0 ? quantity : 1;
      await tx.$executeRaw(Prisma.sql`INSERT INTO restaurant_order_items (order_id, product_id, product_code, description, unit_price, quantity, notes, created_by)
        VALUES (${orderId}::uuid, ${p[0].id}::uuid, ${productCode}, ${p[0].name}, ${gross}, ${qty}, ${notes?.trim() || null}, ${by}::uuid)`);
      await this.recomputeTotal(tx, orderId);
      return { ok: true };
    });
  }

  async removeItem(schema: string, itemId: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const it = await tx.$queryRaw<{ order_id: string }[]>(Prisma.sql`SELECT order_id FROM restaurant_order_items WHERE id = ${itemId}::uuid`);
      if (!it[0]) return { ok: true };
      await tx.$executeRaw(Prisma.sql`DELETE FROM restaurant_order_items WHERE id = ${itemId}::uuid`);
      await this.recomputeTotal(tx, it[0].order_id);
      return { ok: true };
    });
  }

  async setItemKitchen(schema: string, itemId: string, status: string) {
    if (!['PENDING', 'PREPARING', 'READY', 'SERVED'].includes(status)) throw new BadRequestException('Estado inválido.');
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE restaurant_order_items SET kitchen_status = ${status} WHERE id = ${itemId}::uuid`));
    return { ok: true };
  }

  /**
   * Fecha a comanda (a conta). O pagamento/fatura é no CAIXA, onde a emissão
   * baixa os ingredientes (ficha técnica) — fonte única, sem duplicar. EXCEÇÃO:
   * se for lançada no FOLIO do quarto (hotelaria), não passa pelo caixa, por isso
   * aqui é que se baixam os ingredientes.
   */
  async closeOrder(schema: string, orderId: string, chargeToReservationId?: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const ord = await tx.$queryRaw<{ status: string; total: string; table_name: string | null }[]>(
        Prisma.sql`SELECT status, total, table_name FROM restaurant_orders WHERE id = ${orderId}::uuid`);
      if (!ord[0]) throw new NotFoundException('Comanda não encontrada.');
      if (ord[0].status !== 'OPEN') throw new BadRequestException('A comanda já não está aberta.');

      await tx.$executeRaw(Prisma.sql`UPDATE restaurant_orders SET status = 'CLOSED', closed_at = now() WHERE id = ${orderId}::uuid`);

      // Lançar no folio do quarto (hotelaria): consumo soma na conta do hóspede.
      if (chargeToReservationId) {
        const res = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status FROM hotel_reservations WHERE id = ${chargeToReservationId}::uuid`);
        if (!res[0]) throw new NotFoundException('Reserva não encontrada.');
        // Folio não passa pelo caixa → baixa aqui os ingredientes consumidos.
        const items = await tx.$queryRaw<{ product_id: string | null; quantity: string }[]>(
          Prisma.sql`SELECT product_id, quantity FROM restaurant_order_items WHERE order_id = ${orderId}::uuid`);
        await this.deductIngredients(tx, items);
        await tx.$executeRaw(Prisma.sql`INSERT INTO hotel_folio_items (reservation_id, description, unit_price, quantity)
          VALUES (${chargeToReservationId}::uuid, ${`Restaurante/Bar — ${ord[0].table_name ?? 'mesa'}`}, ${Number(ord[0].total)}, 1)`);
        await tx.$executeRaw(Prisma.sql`UPDATE hotel_reservations SET total = (nights * rate) + COALESCE(
          (SELECT SUM(unit_price * quantity) FROM hotel_folio_items WHERE reservation_id = ${chargeToReservationId}::uuid), 0), updated_at = now()
          WHERE id = ${chargeToReservationId}::uuid`);
      }
      return { ok: true, chargedToFolio: !!chargeToReservationId };
    });
  }

  /** Baixa o stock dos ingredientes (receita) de cada prato vendido. */
  private async deductIngredients(tx: Prisma.TransactionClient, items: { product_id: string | null; quantity: string }[]): Promise<void> {
    const wh = await StockService.resolveDefaultWarehouse(tx);
    // Quebra/desperdício: consumo real = qtd × (1 + quebra/100).
    const wasteExpr = (await this.hasWasteCol(tx)) ? Prisma.sql`COALESCE(waste_pct, 0)` : Prisma.sql`0`;
    const eff = (q: string | number, w: string | number | null | undefined) => Number(q) * (1 + (Number(w) || 0) / 100);
    for (const it of items) {
      if (!it.product_id) continue;
      const recipe = await tx.$queryRaw<{ ingredient_id: string; quantity: string; waste_pct: string | null }[]>(
        Prisma.sql`SELECT ingredient_id, quantity, ${wasteExpr} AS waste_pct FROM product_recipes WHERE product_id = ${it.product_id}::uuid`);
      for (const ing of recipe) {
        const consume = eff(ing.quantity, ing.waste_pct) * Number(it.quantity);
        if (consume <= 0) continue;
        // COMBOS/MENUS (1 nível): se o componente é ele próprio um prato com
        // receita (ex.: Menu = Hambúrguer + …), consome os ingredientes do
        // sub-prato — não o "stock" do sub-prato (produzido sob encomenda).
        const sub = await tx.$queryRaw<{ ingredient_id: string; quantity: string; waste_pct: string | null }[]>(
          Prisma.sql`SELECT ingredient_id, quantity, ${wasteExpr} AS waste_pct FROM product_recipes WHERE product_id = ${ing.ingredient_id}::uuid`);
        const targets = sub.length
          ? sub.map((s) => ({ id: s.ingredient_id, qty: eff(s.quantity, s.waste_pct) * consume }))
          : [{ id: ing.ingredient_id, qty: consume }];
        for (const t of targets) {
          if (t.qty <= 0) continue;
          if (wh) {
            await StockService.applyMovement(tx, {
              productId: t.id, warehouseId: wh, type: 'OUT', quantity: -t.qty,
              reference: 'Consumo de receita (restaurante)', allowNegative: true,
            });
          } else {
            await tx.$executeRaw(Prisma.sql`UPDATE products SET stock_qty = stock_qty - ${t.qty} WHERE id = ${t.id}::uuid`);
          }
        }
      }
    }
  }

  // ── Receitas / fichas técnicas ─────────────────────────────
  getRecipe(schema: string, productId: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const wasteExpr = (await this.hasWasteCol(tx)) ? Prisma.sql`COALESCE(r.waste_pct, 0)` : Prisma.sql`0`;
      return tx.$queryRaw(Prisma.sql`SELECT r.id, r.ingredient_id, r.quantity, ${wasteExpr} AS waste_pct,
               p.name AS ingredient_name, p.code AS ingredient_code, p.unit AS ingredient_unit
        FROM product_recipes r JOIN products p ON p.id = r.ingredient_id
        WHERE r.product_id = ${productId}::uuid ORDER BY p.name`);
    });
  }

  /** Substitui a receita de um prato pela lista indicada (ingrediente + quantidade + quebra %). */
  async setRecipe(schema: string, productId: string, items: { ingredientCode: string; quantity: number; wastePct?: number }[]) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const hasWaste = await this.hasWasteCol(tx);
      await tx.$executeRaw(Prisma.sql`DELETE FROM product_recipes WHERE product_id = ${productId}::uuid`);
      for (const it of items) {
        if (!it.ingredientCode || !(it.quantity > 0)) continue;
        const ing = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM products WHERE code = ${it.ingredientCode} AND is_active = TRUE LIMIT 1`);
        if (!ing[0]) continue;
        if (ing[0].id === productId) continue; // o prato não pode ser ingrediente de si próprio
        const waste = Math.min(90, Math.max(0, Number(it.wastePct) || 0));
        if (hasWaste) {
          await tx.$executeRaw(Prisma.sql`INSERT INTO product_recipes (product_id, ingredient_id, quantity, waste_pct)
            VALUES (${productId}::uuid, ${ing[0].id}::uuid, ${it.quantity}, ${waste})
            ON CONFLICT (product_id, ingredient_id) DO UPDATE SET quantity = EXCLUDED.quantity, waste_pct = EXCLUDED.waste_pct`);
        } else {
          await tx.$executeRaw(Prisma.sql`INSERT INTO product_recipes (product_id, ingredient_id, quantity)
            VALUES (${productId}::uuid, ${ing[0].id}::uuid, ${it.quantity})
            ON CONFLICT (product_id, ingredient_id) DO UPDATE SET quantity = EXCLUDED.quantity`);
        }
      }
      // CUSTO DO PRATO = soma do custo dos ingredientes COM QUEBRA (o que se
      // gasta de verdade, não só o que vai ao prato). Lucro no caixa = preço −
      // este custo real.
      const wasteFactor = hasWaste ? Prisma.sql`(1 + COALESCE(r.waste_pct, 0) / 100)` : Prisma.sql`1`;
      await tx.$executeRaw(Prisma.sql`
        UPDATE products SET cost_price = COALESCE((
          SELECT SUM(r.quantity * ${wasteFactor} * ing.cost_price)
          FROM product_recipes r JOIN products ing ON ing.id = r.ingredient_id
          WHERE r.product_id = ${productId}::uuid), 0), updated_at = now()
        WHERE id = ${productId}::uuid`);
      return { ok: true };
    });
  }

  /** Recalcula o custo (ficha técnica) de TODOS os pratos com receita — útil
   *  quando o custo dos ingredientes muda (nova compra altera o custo médio). */
  async recomputeAllRecipeCosts(schema: string) {
    await this.prisma.runInTenant(schema, async (tx) => {
      const wasteFactor = (await this.hasWasteCol(tx)) ? Prisma.sql`(1 + COALESCE(r.waste_pct, 0) / 100)` : Prisma.sql`1`;
      await tx.$executeRaw(Prisma.sql`
        UPDATE products p SET cost_price = sub.c, updated_at = now()
        FROM (SELECT r.product_id, SUM(r.quantity * ${wasteFactor} * ing.cost_price) AS c
              FROM product_recipes r JOIN products ing ON ing.id = r.ingredient_id
              GROUP BY r.product_id) sub
        WHERE p.id = sub.product_id`);
    });
    return { ok: true };
  }

  /**
   * ORDEM DE PRODUÇÃO (fornada) — padaria/pastelaria/produção em lote:
   * consome os ingredientes da receita AGORA (com quebra) e dá entrada do
   * produto ACABADO no stock, ao custo real da receita (CMP no produto).
   * A partir daí o balcão vende da PRATELEIRA (ver regra na emissão) e as
   * sobras do dia abatem-se por acerto de inventário, como qualquer stock.
   * Nota: consome os componentes DIRETOS da receita — se um componente for
   * ele próprio um produto produzido (ex.: massa base), consome o stock dele
   * (produção em fases), não os ingredientes dele.
   */
  async produce(
    schema: string,
    input: { productCode: string; quantity: number; note?: string },
    actor: { id: string; name: string | null },
  ) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const p = await tx.$queryRaw<{ id: string; name: string; stock_qty: string; cost_price: string }[]>(
        Prisma.sql`SELECT id, name, stock_qty, cost_price FROM products
                   WHERE code = ${input.productCode} AND is_active = TRUE LIMIT 1 FOR UPDATE`,
      );
      if (!p[0]) throw new NotFoundException(`Produto não encontrado: ${input.productCode}`);
      const wasteExpr = (await this.hasWasteCol(tx)) ? Prisma.sql`COALESCE(r.waste_pct, 0)` : Prisma.sql`0`;
      const recipe = await tx.$queryRaw<{ ingredient_id: string; quantity: string; waste_pct: string | null; name: string; stock_qty: string; cost_price: string }[]>(
        Prisma.sql`SELECT r.ingredient_id, r.quantity, ${wasteExpr} AS waste_pct,
                          ing.name, ing.stock_qty, ing.cost_price
                   FROM product_recipes r JOIN products ing ON ing.id = r.ingredient_id
                   WHERE r.product_id = ${p[0].id}::uuid`,
      );
      if (!recipe.length) {
        throw new BadRequestException('Este produto não tem ficha técnica — defina a receita antes de registar a produção.');
      }
      const wh = await StockService.resolveDefaultWarehouse(tx);

      // Valida TUDO antes de tocar no stock: uma fornada nunca fica meio-consumida.
      let unitCost = 0;
      const needs = recipe.map((r) => {
        const per = Number(r.quantity) * (1 + (Number(r.waste_pct) || 0) / 100);
        unitCost += per * Number(r.cost_price);
        return { id: r.ingredient_id, name: r.name, have: Number(r.stock_qty), need: per * input.quantity };
      });
      for (const n of needs) {
        if (n.have < n.need) {
          throw new BadRequestException(
            `Ingrediente insuficiente para a fornada: ${n.name} (disponível ${n.have}, necessário ${Math.round(n.need * 1000) / 1000}).`,
          );
        }
      }
      unitCost = Math.round(unitCost * 100) / 100;

      // Consome os ingredientes (livro append-only; nunca negativo numa fornada).
      const ref = input.note?.trim() ? `Produção — ${p[0].name} (${input.note.trim()})` : `Produção — ${p[0].name}`;
      for (const n of needs) {
        if (wh) {
          await StockService.applyMovement(tx, {
            productId: n.id, warehouseId: wh, type: 'OUT', quantity: -n.need,
            reference: ref, createdBy: actor.id ?? null, allowNegative: false,
          });
        } else {
          await tx.$executeRaw(Prisma.sql`UPDATE products SET stock_qty = stock_qty - ${n.need} WHERE id = ${n.id}::uuid`);
        }
      }

      // Entrada do produto acabado ao custo da receita — CMP (mesma matemática
      // da entrada de stock: pondera com o que já estava na prateleira).
      const oldQty = Number(p[0].stock_qty);
      const oldCost = Number(p[0].cost_price);
      const newCost = oldQty > 0
        ? Math.round(((oldQty * oldCost + input.quantity * unitCost) / (oldQty + input.quantity)) * 100) / 100
        : unitCost;
      let balanceAfter = oldQty + input.quantity;
      if (wh) {
        balanceAfter = await StockService.applyMovement(tx, {
          productId: p[0].id, warehouseId: wh, type: 'IN', quantity: input.quantity,
          unitCost, reference: ref, createdBy: actor.id ?? null,
        });
      } else {
        await tx.$executeRaw(Prisma.sql`UPDATE products SET stock_qty = stock_qty + ${input.quantity} WHERE id = ${p[0].id}::uuid`);
      }
      await tx.$executeRaw(Prisma.sql`UPDATE products SET cost_price = ${newCost}, updated_at = now() WHERE id = ${p[0].id}::uuid`);

      // Auditoria: fica registado QUEM produziu, o quê, quanto e a que custo.
      await this.audit.recordInTx(tx, {
        actorId: actor.id ?? null, actorName: actor.name ?? null,
        action: 'PRODUCTION', entity: 'product', entityId: p[0].id,
        details: {
          productCode: input.productCode, quantity: input.quantity, unitCost,
          newCostPrice: newCost, balanceAfter, note: input.note ?? null,
          ingredients: needs.map((n) => ({ name: n.name, consumed: Math.round(n.need * 1000) / 1000 })),
        },
      });
      return { produced: input.quantity, unitCost, costPrice: newCost, stockAfter: balanceAfter };
    });
  }

  async cancelOrder(schema: string, orderId: string) {
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE restaurant_orders SET status = 'CANCELLED', closed_at = now() WHERE id = ${orderId}::uuid AND status = 'OPEN'`));
    return { ok: true };
  }

  /**
   * CENTRO DE COMANDO do restaurante — retrato operacional em tempo real
   * (não é um relatório de vendas). Lê apenas as tabelas próprias da restauração
   * + a matemática de doses (espelho exato do POS) para os alertas de cozinha.
   * Tudo agregado numa só ida à base de dados por bloco, para ser barato o
   * suficiente para refrescar de poucos em poucos segundos no ecrã do gestor.
   */
  async getDashboard(schema: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const hasWaste = await this.hasWasteCol(tx);
      const w1 = hasWaste ? Prisma.sql`(1 + COALESCE(r.waste_pct, 0) / 100)` : Prisma.sql`1`;
      const w2 = hasWaste ? Prisma.sql`(1 + COALESCE(r2.waste_pct, 0) / 100)` : Prisma.sql`1`;

      // ── Serviço de sala (agora) ──────────────────────────────
      const service = await tx.$queryRaw<{
        tables_total: number; tables_open: number; guests_seated: number;
        open_value: number; avg_tab: number;
      }[]>(Prisma.sql`
        SELECT
          (SELECT COUNT(*)::int FROM restaurant_tables WHERE is_active = TRUE) AS tables_total,
          (SELECT COUNT(*)::int FROM restaurant_orders WHERE status = 'OPEN') AS tables_open,
          (SELECT COALESCE(SUM(guests),0)::int FROM restaurant_orders WHERE status = 'OPEN') AS guests_seated,
          (SELECT COALESCE(SUM(total),0)::float8 FROM restaurant_orders WHERE status = 'OPEN') AS open_value,
          (SELECT COALESCE(AVG(total),0)::float8 FROM restaurant_orders WHERE status = 'OPEN' AND total > 0) AS avg_tab`);

      // ── Pressão da cozinha (fila + espera mais antiga) ───────
      const kitchen = await tx.$queryRaw<{
        pending: number; preparing: number; oldest_wait_min: number | null;
      }[]>(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE i.kitchen_status = 'PENDING')::int AS pending,
          COUNT(*) FILTER (WHERE i.kitchen_status = 'PREPARING')::int AS preparing,
          FLOOR(EXTRACT(EPOCH FROM (now() - MIN(i.created_at)
            FILTER (WHERE i.kitchen_status IN ('PENDING','PREPARING')))) / 60)::int AS oldest_wait_min
        FROM restaurant_order_items i
        JOIN restaurant_orders o ON o.id = i.order_id
        WHERE o.status = 'OPEN'`);

      // ── Encomendas ONLINE a aguardar/em produção na cozinha ──
      // Guarda de coluna: tenants não migrados não têm kitchen_status → 0.
      const onlineKitchen = (await this.hasWebKitchenCols(tx))
        ? await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
            SELECT COUNT(*)::int AS n FROM web_orders
            WHERE status IN ('PENDING','PAID') AND kitchen_status IN ('NEW','PREPARING')`)
        : [{ n: 0 }];

      // ── Hoje (contas de mesa fechadas — só dine-in/comandas) ─
      const today = await tx.$queryRaw<{ closed_count: number; revenue: number; avg_ticket: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS closed_count,
               COALESCE(SUM(total),0)::float8 AS revenue,
               COALESCE(AVG(total) FILTER (WHERE total > 0),0)::float8 AS avg_ticket
        FROM restaurant_orders WHERE status = 'CLOSED' AND closed_at::date = CURRENT_DATE`);

      // ── Vendas de HOJE por CANAL (faturas emitidas) ──────────
      // Um restaurante vende ao BALCÃO (POS) e ONLINE além do salão. O balcão/
      // online passam por `invoices` (FT/FS, status N). Online = fatura ligada a
      // uma encomenda web. Só LEITURA para o painel — não altera vendas/stock.
      // Guarda to_regclass: web_orders/invoices podem faltar em tenants antigos.
      const regWeb = await tx.$queryRaw<{ r: string | null }[]>(Prisma.sql`SELECT to_regclass('web_orders')::text AS r`);
      const onlineExpr = regWeb[0]?.r
        ? Prisma.sql`COALESCE(SUM(gross_total) FILTER (WHERE id IN (SELECT invoice_id FROM web_orders WHERE invoice_id IS NOT NULL)), 0)::float8`
        : Prisma.sql`0::float8`;
      const sales = await tx.$queryRaw<{ total: number; online: number; invoices: number }[]>(Prisma.sql`
        SELECT COALESCE(SUM(gross_total), 0)::float8 AS total,
               ${onlineExpr} AS online,
               COUNT(*)::int AS invoices
        FROM invoices
        WHERE invoice_date = CURRENT_DATE AND status = 'N' AND doc_type IN ('FT','FS')`);

      // ── Cardápio: pratos com ficha técnica e alerta de ingredientes ──
      // Doses por prato = MIN(stock_ingrediente ÷ consumo por dose) — mesmo
      // cálculo do POS (combos de 1 nível expandidos). Esgotado = 0 doses.
      const menu = await tx.$queryRaw<{ dishes: number; out_of_stock: number; low_stock: number }[]>(Prisma.sql`
        WITH dish AS (
          SELECT p.id,
            (SELECT MIN(FLOOR(ing.stock_qty / NULLIF(
                        CASE WHEN r2.ingredient_id IS NULL THEN r.quantity * ${w1}
                             ELSE r.quantity * ${w1} * r2.quantity * ${w2} END, 0)))
             FROM product_recipes r
             LEFT JOIN product_recipes r2 ON r2.product_id = r.ingredient_id
             JOIN products ing ON ing.id = COALESCE(r2.ingredient_id, r.ingredient_id)
             WHERE r.product_id = p.id) AS portions
          FROM products p
          WHERE p.is_active = TRUE AND EXISTS (SELECT 1 FROM product_recipes r WHERE r.product_id = p.id)
        )
        SELECT COUNT(*)::int AS dishes,
               COUNT(*) FILTER (WHERE portions IS NOT NULL AND portions <= 0)::int AS out_of_stock,
               COUNT(*) FILTER (WHERE portions IS NOT NULL AND portions > 0 AND portions <= 5)::int AS low_stock
        FROM dish`);

      const s = service[0] ?? { tables_total: 0, tables_open: 0, guests_seated: 0, open_value: 0, avg_tab: 0 };
      const k = kitchen[0] ?? { pending: 0, preparing: 0, oldest_wait_min: null };
      const t = today[0] ?? { closed_count: 0, revenue: 0, avg_ticket: 0 };
      const m = menu[0] ?? { dishes: 0, out_of_stock: 0, low_stock: 0 };
      const sl = sales[0] ?? { total: 0, online: 0, invoices: 0 };
      const online = Math.round(sl.online);
      const dineIn = Math.round(t.revenue);
      // Balcão (POS) = faturas do dia − as ligadas a encomendas online. O salão
      // (comandas) fatura no caixa ao fechar, por isso já entra em `total`; para
      // não duplicar, o "balcão" mostra faturas menos online (inclui o salão).
      const counter = Math.max(0, Math.round(sl.total) - online);
      return {
        service: {
          tablesTotal: s.tables_total, tablesOpen: s.tables_open,
          occupancyPct: s.tables_total > 0 ? Math.round((s.tables_open / s.tables_total) * 100) : 0,
          guestsSeated: s.guests_seated, openValue: s.open_value, avgTab: Math.round(s.avg_tab),
        },
        kitchen: {
          pending: k.pending, preparing: k.preparing, queue: k.pending + k.preparing,
          oldestWaitMin: k.oldest_wait_min ?? 0,
          online: onlineKitchen[0]?.n ?? 0,
        },
        today: { closedCount: t.closed_count, revenue: dineIn, avgTicket: Math.round(t.avg_ticket) },
        // Vendas faturadas de hoje por canal (não duplica: `total` já inclui mesa+
        // balcão+online; `counter` = total − online, e inclui o salão faturado).
        sales: { total: Math.round(sl.total), online, counter, invoices: sl.invoices, dineIn },
        menu: { dishesWithRecipe: m.dishes, outOfStock: m.out_of_stock, lowStock: m.low_stock },
      };
    });
  }

  /** Ecrã de cozinha (KDS): itens por preparar/em preparação, com a mesa. */
  async kitchen(schema: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const etaExpr = (await this.hasOrderEtaCol(tx)) ? Prisma.sql`o.prep_eta_min` : Prisma.sql`NULL::int`;
      const prioExpr = (await this.hasOrderPriorityCol(tx)) ? Prisma.sql`o.priority` : Prisma.sql`0`;
      // Central de Produção: os pedidos URGENTES vêm primeiro (prioridade DESC),
      // depois por antiguidade — o cozinheiro ataca o que é mais crítico.
      return tx.$queryRaw(Prisma.sql`
        SELECT i.id, i.product_id, i.description, i.quantity, i.kitchen_status, i.notes, i.created_at,
          o.table_name, o.id AS order_id, ${etaExpr} AS prep_eta_min, ${prioExpr} AS priority, (o.table_id IS NULL) AS is_counter
        FROM restaurant_order_items i
        JOIN restaurant_orders o ON o.id = i.order_id
        WHERE o.status = 'OPEN' AND i.kitchen_status IN ('PENDING','PREPARING')
        ORDER BY ${prioExpr} DESC, i.created_at`);
    });
  }

  // ── Encomendas ONLINE na cozinha (KDS) ─────────────────────
  /** As colunas de cozinha em web_orders podem ainda não existir (auto-migração
   *  em fundo) — verificar antes de as usar, senão o KDS rebentava até chegar. */
  private async hasWebKitchenCols(tx: Prisma.TransactionClient): Promise<boolean> {
    const rows = await tx.$queryRaw<{ n: number }[]>(
      Prisma.sql`SELECT COUNT(*)::int AS n FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'web_orders' AND column_name = 'kitchen_status'`);
    return (rows[0]?.n ?? 0) > 0;
  }

  /**
   * FILA da cozinha para encomendas ONLINE: as que estão ativas (por pagar ou
   * pagas) e ainda não prontas. O cozinheiro vê-as, dá um tempo estimado e
   * avança a produção — a par das comandas de mesa. Só leitura.
   */
  async onlineQueue(schema: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      if (!(await this.hasWebKitchenCols(tx))) return [];
      const orders = await tx.$queryRaw<{
        id: string; order_number: string; customer_name: string; status: string;
        prep_eta_min: number | null; kitchen_status: string; created_at: Date; wait_min: number;
      }[]>(Prisma.sql`
        SELECT id, order_number, customer_name, status, prep_eta_min, kitchen_status, created_at,
               FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 60)::int AS wait_min
        FROM web_orders
        WHERE status IN ('PENDING','PAID') AND kitchen_status IN ('NEW','PREPARING')
        ORDER BY created_at`);
      if (orders.length === 0) return [];
      // order_id é UUID: cast explícito de cada id (senão `uuid = text` rebenta,
      // como no bug da venda 42883). Ver [[bug_sale_uuid_text]].
      const idList = Prisma.join(orders.map((o) => Prisma.sql`${o.id}::uuid`));
      const items = await tx.$queryRaw<{ order_id: string; product_id: string | null; description: string; quantity: string }[]>(
        Prisma.sql`SELECT order_id, product_id, description, quantity FROM web_order_items
                   WHERE order_id IN (${idList}) ORDER BY line_number`);
      const byOrder = new Map<string, { product_id: string | null; description: string; quantity: string }[]>();
      for (const it of items) {
        const arr = byOrder.get(it.order_id) ?? [];
        arr.push({ product_id: it.product_id, description: it.description, quantity: it.quantity });
        byOrder.set(it.order_id, arr);
      }
      return orders.map((o) => ({
        id: o.id, orderNumber: o.order_number, customerName: o.customer_name,
        paymentStatus: o.status, kitchenStatus: o.kitchen_status,
        etaMin: o.prep_eta_min, waitMin: o.wait_min,
        items: byOrder.get(o.id) ?? [],
      }));
    });
  }

  /** O cozinheiro ACEITA a encomenda online e dá um TEMPO ESTIMADO (min). */
  async setOnlineEta(schema: string, orderId: string, minutes: number) {
    const m = Math.max(1, Math.min(240, Math.floor(Number(minutes) || 0)));
    return this.prisma.runInTenant(schema, async (tx) => {
      if (!(await this.hasWebKitchenCols(tx))) throw new BadRequestException('Cozinha online ainda não disponível neste tenant.');
      const o = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status FROM web_orders WHERE id = ${orderId}::uuid`);
      if (!o[0]) throw new NotFoundException('Encomenda não encontrada.');
      if (!['PENDING', 'PAID'].includes(o[0].status)) throw new BadRequestException('A encomenda já não está ativa.');
      await tx.$executeRaw(Prisma.sql`
        UPDATE web_orders
        SET prep_eta_min = ${m},
            kitchen_status = CASE WHEN kitchen_status = 'NEW' THEN 'PREPARING' ELSE kitchen_status END,
            kitchen_at = COALESCE(kitchen_at, now()), updated_at = now()
        WHERE id = ${orderId}::uuid`);
      return { ok: true as const, etaMin: m };
    });
  }

  /** Avança o estado de produção da encomenda online (PREPARING→READY). */
  async setOnlineKitchen(schema: string, orderId: string, status: string) {
    if (!['PREPARING', 'READY'].includes(status)) throw new BadRequestException('Estado inválido.');
    return this.prisma.runInTenant(schema, async (tx) => {
      if (!(await this.hasWebKitchenCols(tx))) throw new BadRequestException('Cozinha online ainda não disponível neste tenant.');
      await tx.$executeRaw(Prisma.sql`UPDATE web_orders SET kitchen_status = ${status}, updated_at = now() WHERE id = ${orderId}::uuid`);
      return { ok: true as const };
    });
  }

  // ── BALCÃO / TAKEAWAY: caixa envia à cozinha, depois chama o pronto ─────────
  /** prep_eta_min pode ainda não existir em restaurant_orders (auto-migração). */
  private async hasOrderEtaCol(tx: Prisma.TransactionClient): Promise<boolean> {
    const rows = await tx.$queryRaw<{ n: number }[]>(
      Prisma.sql`SELECT COUNT(*)::int AS n FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'restaurant_orders' AND column_name = 'prep_eta_min'`);
    return (rows[0]?.n ?? 0) > 0;
  }

  /** A coluna restaurant_orders.priority pode ainda não existir (auto-migração). */
  private async hasOrderPriorityCol(tx: Prisma.TransactionClient): Promise<boolean> {
    const rows = await tx.$queryRaw<{ n: number }[]>(
      Prisma.sql`SELECT COUNT(*)::int AS n FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'restaurant_orders' AND column_name = 'priority'`);
    return (rows[0]?.n ?? 0) > 0;
  }

  /** Central de Produção: marca a prioridade de um pedido (0=normal, 1=urgente). */
  async setOrderPriority(schema: string, orderId: string, priority: number) {
    return this.prisma.runInTenant(schema, async (tx) => {
      if (!(await this.hasOrderPriorityCol(tx))) throw new BadRequestException('Prioridade ainda não disponível neste tenant.');
      const p = Math.max(0, Math.min(2, Math.floor(Number(priority) || 0)));
      await tx.$executeRaw(Prisma.sql`UPDATE restaurant_orders SET priority = ${p} WHERE id = ${orderId}::uuid`);
      return { ok: true as const, priority: p };
    });
  }

  /**
   * O CAIXA envia o pedido para a COZINHA (não vende ainda): cria uma comanda de
   * BALCÃO (table_id NULL) com os itens; vão para o KDS como qualquer comanda. A
   * cozinha dá o tempo e produz; quando pronto, o caixa "chama" o pedido e vende
   * pelo fluxo normal (a emissão baixa os ingredientes — aqui NÃO se toca nisso).
   */
  async createCounterOrder(schema: string, input: { items: { productCode: string; quantity: number }[]; customerName?: string }, opener: { id: string; name: string }) {
    if (!input.items?.length) throw new BadRequestException('Sem itens para enviar à cozinha.');
    return this.prisma.runInTenant(schema, async (tx) => {
      const label = input.customerName?.trim() || 'Balcão';
      const ord = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO restaurant_orders (table_id, table_name, guests, customer_name, opened_by, opened_by_name)
        VALUES (NULL, ${label}, 1, ${input.customerName?.trim() || null}, ${opener.id}::uuid, ${opener.name})
        RETURNING id`);
      const orderId = ord[0].id;
      for (const it of input.items) {
        const qty = it.quantity > 0 ? it.quantity : 1;
        const p = await tx.$queryRaw<{ id: string; name: string; unit_price: string; iva_code: string }[]>(
          Prisma.sql`SELECT id, name, unit_price, iva_code FROM products WHERE code = ${it.productCode} AND is_active = TRUE LIMIT 1`);
        if (!p[0]) continue;
        const gross = Math.round(Number(p[0].unit_price) * (1 + (IVA_RATE[p[0].iva_code] ?? 14) / 100) * 100) / 100;
        await tx.$executeRaw(Prisma.sql`INSERT INTO restaurant_order_items (order_id, product_id, product_code, description, unit_price, quantity, created_by)
          VALUES (${orderId}::uuid, ${p[0].id}::uuid, ${it.productCode}, ${p[0].name}, ${gross}, ${qty}, ${opener.id}::uuid)`);
      }
      await this.recomputeTotal(tx, orderId);
      return { id: orderId, label };
    });
  }

  /** A cozinha dá o TEMPO ESTIMADO de uma comanda (mesa ou balcão). */
  async setOrderEta(schema: string, orderId: string, minutes: number) {
    const m = Math.max(1, Math.min(240, Math.floor(Number(minutes) || 0)));
    return this.prisma.runInTenant(schema, async (tx) => {
      if (!(await this.hasOrderEtaCol(tx))) throw new BadRequestException('Tempo estimado ainda não disponível neste tenant.');
      const o = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT status FROM restaurant_orders WHERE id = ${orderId}::uuid`);
      if (!o[0]) throw new NotFoundException('Comanda não encontrada.');
      if (o[0].status !== 'OPEN') throw new BadRequestException('A comanda já não está aberta.');
      await tx.$executeRaw(Prisma.sql`UPDATE restaurant_orders SET prep_eta_min = ${m}, kitchen_at = COALESCE(kitchen_at, now()) WHERE id = ${orderId}::uuid`);
      return { ok: true as const, etaMin: m };
    });
  }

  /** Pedidos de BALCÃO prontos (todos os itens preparados) — para o caixa chamar e vender. */
  async readyCounterOrders(schema: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const etaExpr = (await this.hasOrderEtaCol(tx)) ? Prisma.sql`o.prep_eta_min` : Prisma.sql`NULL::int`;
      const orders = await tx.$queryRaw<{
        id: string; table_name: string | null; customer_name: string | null; total: string;
        prep_eta_min: number | null; wait_min: number; all_ready: boolean;
      }[]>(Prisma.sql`
        SELECT o.id, o.table_name, o.customer_name, o.total, ${etaExpr} AS prep_eta_min,
               FLOOR(EXTRACT(EPOCH FROM (now() - o.created_at)) / 60)::int AS wait_min,
               NOT EXISTS (SELECT 1 FROM restaurant_order_items i WHERE i.order_id = o.id
                           AND i.kitchen_status IN ('PENDING','PREPARING')) AS all_ready
        FROM restaurant_orders o
        WHERE o.table_id IS NULL AND o.status = 'OPEN'
          AND EXISTS (SELECT 1 FROM restaurant_order_items i WHERE i.order_id = o.id)
        ORDER BY o.created_at`);
      if (orders.length === 0) return [];
      const idList = Prisma.join(orders.map((o) => Prisma.sql`${o.id}::uuid`));
      const items = await tx.$queryRaw<{ order_id: string; product_code: string; description: string; unit_price: string; quantity: string; kitchen_status: string }[]>(
        Prisma.sql`SELECT order_id, product_code, description, unit_price, quantity, kitchen_status
                   FROM restaurant_order_items WHERE order_id IN (${idList}) ORDER BY created_at`);
      const byOrder = new Map<string, typeof items>();
      for (const it of items) { const a = byOrder.get(it.order_id) ?? []; a.push(it); byOrder.set(it.order_id, a); }
      return orders.map((o) => ({
        id: o.id, label: o.customer_name || o.table_name || 'Balcão', total: o.total,
        etaMin: o.prep_eta_min, waitMin: o.wait_min, ready: o.all_ready,
        items: (byOrder.get(o.id) ?? []).map((i) => ({ productCode: i.product_code, description: i.description, unitPrice: i.unit_price, quantity: i.quantity, kitchenStatus: i.kitchen_status })),
      }));
    });
  }

  /** Fecha a comanda de balcão DEPOIS de o caixa a vender (a emissão já baixou os
   *  ingredientes — aqui é só mudar o estado, sem tocar no stock). */
  async markCounterServed(schema: string, orderId: string) {
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE restaurant_orders SET status = 'CLOSED', closed_at = now()
                                WHERE id = ${orderId}::uuid AND status = 'OPEN' AND table_id IS NULL`));
    return { ok: true as const };
  }
}
