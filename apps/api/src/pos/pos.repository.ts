import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAuditService } from '../cashbox/tenant-audit.service';
import { IvaCode } from '@nexus/agt-xml';

export interface ProductRow {
  id: string;
  code: string;
  barcode: string | null;
  name: string;
  description: string | null;
  category_id: string | null;
  brand: string | null;
  iva_code: IvaCode;
  exemption_reason: string | null;
  exemption_code: string | null;
  unit_price: string; // NUMERIC comes back as string
  cost_price: string;
  stock_qty: string;
  image_url: string | null;
  gallery: unknown;
  show_online: boolean;
  shared_stock: boolean;
  is_ingredient: boolean;
  is_production?: boolean;
  unit: string | null;
  is_active: boolean;
  /** TRUE = tem ficha técnica (prato produzido sob encomenda; stock nos ingredientes). */
  has_recipe?: boolean;
  /** Doses possíveis com o stock atual dos ingredientes (só pratos; NULL sem receita). */
  portions_available?: string | number | null;
  /** Quantidade já RESERVADA a encomendas online por confirmar (PENDING). */
  reserved?: string | number | null;
}

export interface CustomerRow {
  id: string;
  tax_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
}

@Injectable()
export class PosRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: TenantAuditService,
  ) {}

  // ── Produtos ───────────────────────────────────────────────
  /** IVA padrão da empresa (Configurações) — usado pelo IVA "Automático". */
  async defaultIvaCode(schema: string): Promise<IvaCode> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ default_iva_code: string }[]>(
        Prisma.sql`SELECT default_iva_code FROM site_settings LIMIT 1`,
      ),
    ).catch(() => [] as { default_iva_code: string }[]);
    const v = rows[0]?.default_iva_code;
    return (['NOR', 'INT', 'RED', 'ISE', 'OUT'].includes(v ?? '') ? v : 'NOR') as IvaCode;
  }

  createProduct(
    schema: string,
    input: {
      code: string;
      barcode?: string | null;
      name: string;
      description?: string | null;
      categoryId?: string | null;
      brand?: string | null;
      ivaCode: IvaCode;
      exemptionReason?: string | null;
      exemptionCode?: string | null;
      unitPrice?: number;
      costPrice?: number;
      stockQty?: number;
      /** Lojas onde o produto existe. Vazio/omisso = TODAS as lojas. */
      storeIds?: string[];
      /** TRUE = stock central partilhado; FALSE = stock por loja. */
      sharedStock?: boolean;
      /** Loja onde entra o stock inicial (stock por loja). Default = loja principal. */
      initialStoreId?: string | null;
      imageUrl?: string | null;
      gallery?: string[];
      showOnline?: boolean;
      /** TRUE = ingrediente/matéria-prima (não se vende; só ficha técnica). */
      isIngredient?: boolean;
      /** TRUE = produto de PRODUÇÃO (custo da ficha técnica; estoque das fornadas). */
      isProduction?: boolean;
      /** Unidade de medida (un, kg, g, L, ml, fatia, folha…). */
      unit?: string | null;
    },
  ): Promise<ProductRow> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const shared = input.sharedStock ?? false;
      const isIngredient = input.isIngredient ?? false;
      const isProduction = input.isProduction ?? false;
      // Ingrediente nunca aparece na loja online.
      const showOnline = isIngredient ? false : (input.showOnline ?? true);
      // PRODUÇÃO: o custo vem da ficha técnica (nunca manual) e o estoque das
      // fornadas — logo, ignoram-se custo/estoque iniciais no cadastro.
      const costPrice = isProduction ? 0 : (input.costPrice ?? 0);
      const stockQty = isProduction ? 0 : (input.stockQty ?? 0);
      const rows = await tx.$queryRaw<ProductRow[]>(
        Prisma.sql`INSERT INTO products
            (code, barcode, name, description, category_id, brand, iva_code, exemption_reason, exemption_code,
             unit_price, cost_price, stock_qty, shared_stock, image_url, gallery, show_online, is_ingredient, is_production, unit)
          VALUES (${input.code}, ${input.barcode ?? null}, ${input.name},
                  ${input.description ?? null}, ${input.categoryId ?? null}::uuid, ${input.brand ?? null},
                  ${input.ivaCode}, ${input.exemptionReason ?? null}, ${input.exemptionCode ?? null},
                  ${input.unitPrice ?? 0}, ${costPrice}, ${stockQty}, ${shared},
                  ${input.imageUrl ?? null}, ${JSON.stringify(input.gallery ?? [])}::jsonb,
                  ${showOnline}, ${isIngredient}, ${isProduction}, ${input.unit?.trim() || null})
          RETURNING *`,
      );
      const product = rows[0];

      // Cria a linha de saldo (0) em TODAS as lojas activas, para o produto poder
      // ser gerido em qualquer loja. O stock_items usa o id da LOJA.
      const stores = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM stores WHERE is_active = TRUE`,
      );
      const defStoreRows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM stores WHERE is_active = TRUE ORDER BY is_default DESC, created_at ASC LIMIT 1`,
      );
      const defStore = defStoreRows[0]?.id;
      // Stock inicial: partilhado → pool central (loja principal); por loja → a loja
      // de quem criou (initialStoreId) ou, em falta, a loja principal.
      const initStore = shared ? defStore : (input.initialStoreId || defStore);
      // PRODUÇÃO: sem stock inicial por loja — o estoque vem só das fornadas.
      const initial = Number(stockQty);
      for (const st of stores) {
        const q = initial > 0 && st.id === initStore ? initial : 0;
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO stock_items (product_id, warehouse_id, quantity)
                     VALUES (${product.id}::uuid, ${st.id}::uuid, ${q})
                     ON CONFLICT (product_id, warehouse_id) DO NOTHING`,
        );
        if (q > 0) {
          await tx.$executeRaw(
            Prisma.sql`INSERT INTO stock_movements (product_id, warehouse_id, type, quantity, balance_after, reference)
                       VALUES (${product.id}::uuid, ${st.id}::uuid, 'IN', ${q}, ${q}, 'Saldo inicial')`,
          );
          // Auditoria: o stock inicial fica registado como "Entrada de stock".
          await this.audit.recordInTx(tx, {
            action: 'STOCK_IN', entity: 'product', entityId: product.id,
            details: { quantity: q, reference: 'Saldo inicial', storeId: st.id, balanceAfter: q },
          });
        }
      }
      return product;
    });
  }

  /**
   * Lista produtos activos com o stock EFECTIVO da loja indicada (caixa):
   *  - shared_stock = TRUE  → stock central partilhado (products.stock_qty global);
   *  - shared_stock = FALSE → saldo da loja do operador (stock_items dessa loja).
   * storeId omisso (gestor/admin) → mostra o stock_qty global.
   */
  /**
   * Catálogo. Sem `opts` devolve tudo (compatibilidade com apps antigas). Com
   * `limit`, devolve UMA página e pesquisa no servidor (`q`: código/barras exatos,
   * nome/marca) — obrigatório para catálogos grandes (centenas de milhares a
   * milhões de produtos: a lista inteira passava das centenas de MB).
   * `changesSince` (+ `afterId`) devolve as alterações por ordem (updated_at, id)
   * — é o que a memória interna das apps usa para se manter atualizada aos poucos.
   */
  listProducts(
    schema: string, storeId?: string | null, includeInactive = false,
    opts?: { q?: string; limit?: number; offset?: number; changesSince?: string; afterId?: string },
  ): Promise<ProductRow[]> {
    return this.prisma.runInTenant(schema, async (tx) => {
      // PRATOS/PRODUÇÃO: um produto com ficha técnica é produzido sob encomenda —
      // não tem stock próprio (a emissão valida/baixa os INGREDIENTES). O POS
      // precisa de saber isto para não o rotular "Esgotado" nem bloquear a venda.
      // Guarda to_regclass: tenants antigos podem não ter product_recipes.
      const reg = await tx.$queryRaw<{ r: string | null }[]>(
        Prisma.sql`SELECT to_regclass('product_recipes')::text AS r`,
      );
      const hasRecipeExpr = reg[0]?.r
        ? Prisma.sql`EXISTS (SELECT 1 FROM product_recipes r WHERE r.product_id = p.id)`
        : Prisma.sql`FALSE`;
      // DOSES DISPONÍVEIS de um prato = MIN(stock_ingrediente ÷ qtd_receita).
      // Combos (1 nível): componente que é ELE PRÓPRIO um prato expande-se nos
      // seus ingredientes (LEFT JOIN da sub-receita multiplica as quantidades)
      // — espelho exato da validação/consumo da emissão. Informativo para o
      // operador ("Sob encomenda · N disp."); a emissão continua a validar.
      // Quebra/desperdício: cada dose gasta qtd×(1+quebra/100) — a coluna pode
      // ainda não existir em tenants antigos (guarda de coluna).
      const wc = reg[0]?.r
        ? await tx.$queryRaw<{ n: number }[]>(
            Prisma.sql`SELECT COUNT(*)::int AS n FROM information_schema.columns
                       WHERE table_schema = current_schema() AND table_name = 'product_recipes' AND column_name = 'waste_pct'`)
        : [{ n: 0 }];
      const w1 = (wc[0]?.n ?? 0) > 0 ? Prisma.sql`(1 + COALESCE(r.waste_pct, 0) / 100)` : Prisma.sql`1`;
      const w2 = (wc[0]?.n ?? 0) > 0 ? Prisma.sql`(1 + COALESCE(r2.waste_pct, 0) / 100)` : Prisma.sql`1`;
      const portionsExpr = reg[0]?.r
        ? Prisma.sql`(SELECT MIN(FLOOR(ing.stock_qty / NULLIF(
                        CASE WHEN r2.ingredient_id IS NULL THEN r.quantity * ${w1}
                             ELSE r.quantity * ${w1} * r2.quantity * ${w2} END, 0)))
                      FROM product_recipes r
                      LEFT JOIN product_recipes r2 ON r2.product_id = r.ingredient_id
                      JOIN products ing ON ing.id = COALESCE(r2.ingredient_id, r.ingredient_id)
                      WHERE r.product_id = p.id)`
        : Prisma.sql`NULL`;
      // RESERVA de encomendas online por confirmar (PENDING). O caixa é AVISADO
      // — não bloqueia a venda física — de que aquele stock está prometido a uma
      // encomenda da loja. Guarda to_regclass: tenants sem loja online → 0.
      const regWeb = await tx.$queryRaw<{ r: string | null }[]>(
        Prisma.sql`SELECT to_regclass('web_order_items')::text AS r`,
      );
      const reservedExpr = regWeb[0]?.r
        ? Prisma.sql`COALESCE((SELECT SUM(wi.quantity)::float8 FROM web_order_items wi
                       JOIN web_orders wo ON wo.id = wi.order_id
                       WHERE wi.product_id = p.id AND wo.status = 'PENDING'), 0)`
        : Prisma.sql`0`;
      const q = (opts?.q ?? '').trim();
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      let where = Prisma.empty;
      let order = Prisma.sql`ORDER BY p.name`;
      if (opts?.changesSince !== undefined) {
        const since = opts.changesSince || '1970-01-01T00:00:00Z';
        where = opts.afterId
          ? Prisma.sql`AND (p.updated_at, p.id) > (${since}::timestamptz, ${opts.afterId}::uuid)`
          : Prisma.sql`AND p.updated_at >= ${since}::timestamptz`;
        order = Prisma.sql`ORDER BY p.updated_at, p.id`;
      } else if (q) {
        where = Prisma.sql`AND (p.code = ${q} OR p.barcode = ${q} OR p.name ILIKE ${like} OR p.brand ILIKE ${like})`;
        // Correspondência exata de código/barras primeiro, depois nome a começar pelo termo.
        order = Prisma.sql`ORDER BY (p.code = ${q} OR p.barcode = ${q}) DESC, (p.name ILIKE ${q.replace(/[\\%_]/g, (c) => `\\${c}`) + '%'}) DESC, p.name`;
      }
      const lim = opts?.limit !== undefined ? Math.min(Math.max(1, Math.floor(opts.limit)), 5000) : null;
      const off = Math.max(0, Math.floor(opts?.offset ?? 0));
      const page = lim !== null ? Prisma.sql`LIMIT ${lim} OFFSET ${off}` : Prisma.empty;
      return tx.$queryRaw<ProductRow[]>(
        Prisma.sql`
          SELECT p.id, p.code, p.barcode, p.name, p.updated_at, p.updated_at::text AS updated_cursor, p.description, p.category_id, p.brand,
                 p.iva_code, p.exemption_reason, p.exemption_code, p.unit_price, p.cost_price,
                 CASE WHEN p.shared_stock OR ${storeId ?? null}::uuid IS NULL
                      THEN p.stock_qty ELSE COALESCE(si.quantity, 0) END AS stock_qty,
                 p.image_url, p.gallery, p.show_online, p.shared_stock, p.is_ingredient, p.is_production, p.unit, p.is_active,
                 ${hasRecipeExpr} AS has_recipe,
                 ${reservedExpr} AS reserved,
                 ${portionsExpr} AS portions_available
          FROM products p
          LEFT JOIN stock_items si
                 ON si.product_id = p.id AND si.warehouse_id = ${storeId ?? null}::uuid
          -- Ingredientes (matéria-prima) NÃO entram no catálogo do caixa: só se vendem pratos.
          WHERE ${opts?.changesSince !== undefined ? Prisma.sql`TRUE` : Prisma.sql`(p.is_active = TRUE OR ${includeInactive}::boolean)`}
            AND p.is_ingredient = FALSE
            ${where}
          ${order}
          ${page}`,
      );
    });
  }

  /** Ingredientes/matéria-prima (para a ficha técnica dos pratos) — com custo e stock. */
  listIngredients(schema: string): Promise<ProductRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<ProductRow[]>(
        Prisma.sql`SELECT id, code, barcode, name, description, category_id, brand, iva_code,
                          exemption_reason, exemption_code, unit_price, cost_price, stock_qty,
                          image_url, gallery, show_online, shared_stock, is_ingredient, unit, is_active
                   FROM products WHERE is_active = TRUE AND is_ingredient = TRUE ORDER BY name`,
      ),
    );
  }

  async getProduct(schema: string, id: string): Promise<ProductRow> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<ProductRow[]>(
        Prisma.sql`SELECT * FROM products WHERE id = ${id}::uuid LIMIT 1`,
      ),
    );
    if (!rows[0]) throw new NotFoundException(`Produto não encontrado: ${id}`);
    return rows[0];
  }

  async updateProduct(
    schema: string,
    id: string,
    input: {
      name?: string;
      description?: string | null;
      categoryId?: string | null;
      brand?: string | null;
      ivaCode?: IvaCode;
      exemptionReason?: string | null;
      exemptionCode?: string | null;
      unitPrice?: number;
      costPrice?: number;
      stockQty?: number;
      imageUrl?: string | null;
      gallery?: string[];
      showOnline?: boolean;
      sharedStock?: boolean;
      isActive?: boolean;
      isIngredient?: boolean;
      isProduction?: boolean;
      unit?: string | null;
    },
  ): Promise<ProductRow> {
    const sets: Prisma.Sql[] = [];
    if (input.name !== undefined) sets.push(Prisma.sql`name = ${input.name}`);
    if (input.description !== undefined) sets.push(Prisma.sql`description = ${input.description}`);
    if (input.categoryId !== undefined) sets.push(Prisma.sql`category_id = ${input.categoryId || null}::uuid`);
    if (input.brand !== undefined) sets.push(Prisma.sql`brand = ${input.brand || null}`);
    if (input.ivaCode !== undefined) sets.push(Prisma.sql`iva_code = ${input.ivaCode}`);
    if (input.exemptionReason !== undefined) sets.push(Prisma.sql`exemption_reason = ${input.exemptionReason || null}`);
    if (input.exemptionCode !== undefined) sets.push(Prisma.sql`exemption_code = ${input.exemptionCode || null}`);
    if (input.unitPrice !== undefined) sets.push(Prisma.sql`unit_price = ${input.unitPrice}`);
    if (input.costPrice !== undefined) sets.push(Prisma.sql`cost_price = ${input.costPrice}`);
    if (input.stockQty !== undefined) sets.push(Prisma.sql`stock_qty = ${input.stockQty}`);
    if (input.imageUrl !== undefined) sets.push(Prisma.sql`image_url = ${input.imageUrl}`);
    if (input.gallery !== undefined)
      sets.push(Prisma.sql`gallery = ${JSON.stringify(input.gallery)}::jsonb`);
    if (input.showOnline !== undefined) sets.push(Prisma.sql`show_online = ${input.showOnline}`);
    if (input.sharedStock !== undefined) sets.push(Prisma.sql`shared_stock = ${input.sharedStock}`);
    if (input.isActive !== undefined) sets.push(Prisma.sql`is_active = ${input.isActive}`);
    if (input.unit !== undefined) sets.push(Prisma.sql`unit = ${input.unit?.trim() || null}`);
    if (input.isIngredient !== undefined) {
      sets.push(Prisma.sql`is_ingredient = ${input.isIngredient}`);
      // Ao marcar como ingrediente, sai da loja online.
      if (input.isIngredient) sets.push(Prisma.sql`show_online = FALSE`);
    }
    if (input.isProduction !== undefined) {
      sets.push(Prisma.sql`is_production = ${input.isProduction}`);
      // PRODUÇÃO: custo vem da ficha técnica; zera o custo manual guardado.
      if (input.isProduction) sets.push(Prisma.sql`cost_price = 0`);
    }

    if (sets.length === 0) return this.getProduct(schema, id);
    sets.push(Prisma.sql`updated_at = now()`);

    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<ProductRow[]>(
        Prisma.sql`UPDATE products SET ${Prisma.join(sets, ', ')}
                   WHERE id = ${id}::uuid RETURNING *`,
      ),
    );
    if (!rows[0]) throw new NotFoundException(`Produto não encontrado: ${id}`);
    return rows[0];
  }

  /**
   * Elimina um produto. Se já tiver VENDAS associadas (invoice_items), não pode
   * ser apagado (integridade fiscal) → é apenas DESATIVADO. Caso contrário,
   * remove o produto e os seus saldos/movimentos/lotes de stock.
   */
  async deleteProduct(schema: string, id: string): Promise<{ deleted: boolean; deactivated: boolean }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const refs = await tx.$queryRaw<{ n: number }[]>(
        Prisma.sql`SELECT COUNT(*)::int AS n FROM invoice_items WHERE product_id = ${id}::uuid`,
      );
      if ((refs[0]?.n ?? 0) > 0) {
        await tx.$executeRaw(Prisma.sql`UPDATE products SET is_active = FALSE, updated_at = now() WHERE id = ${id}::uuid`);
        return { deleted: false, deactivated: true };
      }
      await tx.$executeRaw(Prisma.sql`DELETE FROM stock_movements WHERE product_id = ${id}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM stock_items WHERE product_id = ${id}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM product_batches WHERE product_id = ${id}::uuid`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM products WHERE id = ${id}::uuid`);
      return { deleted: true, deactivated: false };
    });
  }

  /** Elimina VÁRIOS produtos numa só transacção (mesma regra de deleteProduct, em lote). */
  async deleteProducts(schema: string, ids: string[]): Promise<{ deleted: number; deactivated: number }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const sold = await tx.$queryRaw<{ product_id: string }[]>(
        Prisma.sql`SELECT DISTINCT product_id FROM invoice_items WHERE product_id = ANY(${ids}::uuid[])`,
      );
      const soldIds = sold.map((r) => r.product_id);
      if (soldIds.length > 0) {
        await tx.$executeRaw(Prisma.sql`UPDATE products SET is_active = FALSE, updated_at = now() WHERE id = ANY(${soldIds}::uuid[])`);
      }
      const delIds = ids.filter((i) => !soldIds.includes(i));
      if (delIds.length === 0) return { deleted: 0, deactivated: soldIds.length };
      await tx.$executeRaw(Prisma.sql`DELETE FROM stock_movements WHERE product_id = ANY(${delIds}::uuid[])`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM stock_items WHERE product_id = ANY(${delIds}::uuid[])`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM product_batches WHERE product_id = ANY(${delIds}::uuid[])`);
      const n = await tx.$executeRaw(Prisma.sql`DELETE FROM products WHERE id = ANY(${delIds}::uuid[])`);
      return { deleted: Number(n), deactivated: soldIds.length };
    });
  }

  // ── Clientes ───────────────────────────────────────────────
  createCustomer(
    schema: string,
    input: {
      taxId?: string | null;
      name: string;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
    },
  ): Promise<CustomerRow> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<CustomerRow[]>(
        Prisma.sql`INSERT INTO customers (tax_id, name, email, phone, address)
          VALUES (${input.taxId ?? null}, ${input.name}, ${input.email ?? null},
                  ${input.phone ?? null}, ${input.address ?? null})
          RETURNING *`,
      );
      return rows[0];
    });
  }

  /** Lista clientes com ESTATÍSTICAS de compra (nº compras, total gasto, última
   *  compra) — só faturas válidas (status 'N'). Partilhado com caixa/loja online. */
  /** Alterações de clientes por (updated_at, id) — memória interna das apps, aos poucos.
   *  Inclui os desativados (a app retira-os da memória). Cursor com precisão total. */
  listCustomerChanges(schema: string, since: string, afterId: string | undefined, limit: number): Promise<(CustomerRow & { updated_cursor: string })[]> {
    const lim = Math.min(Math.max(1, Math.floor(limit)), 5000);
    const s = since || '1970-01-01T00:00:00Z';
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<(CustomerRow & { updated_cursor: string })[]>(
        Prisma.sql`SELECT c.id, c.tax_id, c.name, c.email, c.phone, c.address, c.province, c.municipality,
                          c.is_active, c.updated_at::text AS updated_cursor
                   FROM customers c
                   WHERE ${afterId
                     ? Prisma.sql`(c.updated_at, c.id) > (${s}::timestamptz, ${afterId}::uuid)`
                     : Prisma.sql`c.updated_at >= ${s}::timestamptz`}
                   ORDER BY c.updated_at, c.id LIMIT ${lim}`,
      ),
    );
  }

  listCustomers(schema: string, opts?: { q?: string; limit?: number; offset?: number }): Promise<CustomerRow[]> {
    if (opts?.limit !== undefined) {
      // PÁGINA + PESQUISA no servidor (empresas com muitos clientes): os totais de
      // compras calculam-se só para os clientes da página (LATERAL), não para todos.
      const q = (opts.q ?? '').trim();
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const where = q
        ? Prisma.sql`AND (c.name ILIKE ${like} OR c.tax_id = ${q} OR c.phone ILIKE ${like} OR c.email ILIKE ${like})`
        : Prisma.empty;
      const lim = Math.min(Math.max(1, Math.floor(opts.limit)), 2000);
      const off = Math.max(0, Math.floor(opts.offset ?? 0));
      return this.prisma.runInTenant(schema, (tx) =>
        tx.$queryRaw<CustomerRow[]>(
          Prisma.sql`SELECT c.*, COALESCE(s.purchases, 0)::int AS purchases,
                            COALESCE(s.total_spent, 0)::float AS total_spent, s.last_purchase
                     FROM customers c
                     LEFT JOIN LATERAL (
                       SELECT COUNT(*)::int AS purchases, SUM(gross_total)::float AS total_spent,
                              MAX(system_entry_date) AS last_purchase
                       FROM invoices i WHERE i.customer_id = c.id AND i.status = 'N' AND i.doc_type IN ('FT','FS')
                     ) s ON TRUE
                     WHERE c.is_active = TRUE ${where}
                     ORDER BY c.name LIMIT ${lim} OFFSET ${off}`,
        ),
      );
    }
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<CustomerRow[]>(
        Prisma.sql`SELECT c.*,
                          COALESCE(s.purchases, 0)::int AS purchases,
                          COALESCE(s.total_spent, 0)::float AS total_spent,
                          s.last_purchase
                   FROM customers c
                   LEFT JOIN (
                     SELECT customer_id, COUNT(*)::int AS purchases,
                            SUM(gross_total)::float AS total_spent,
                            MAX(system_entry_date) AS last_purchase
                     FROM invoices WHERE status = 'N' AND doc_type IN ('FT','FS') AND customer_id IS NOT NULL
                     GROUP BY customer_id
                   ) s ON s.customer_id = c.id
                   WHERE c.is_active = TRUE ORDER BY c.name`,
      ),
    );
  }

  async updateCustomer(
    schema: string,
    id: string,
    input: { name?: string; taxId?: string | null; email?: string | null; phone?: string | null;
             address?: string | null; province?: string | null; municipality?: string | null },
  ): Promise<CustomerRow> {
    const sets: Prisma.Sql[] = [];
    if (input.name !== undefined) sets.push(Prisma.sql`name = ${input.name}`);
    if (input.taxId !== undefined) sets.push(Prisma.sql`tax_id = ${input.taxId || null}`);
    if (input.email !== undefined) sets.push(Prisma.sql`email = ${input.email || null}`);
    if (input.phone !== undefined) sets.push(Prisma.sql`phone = ${input.phone || null}`);
    if (input.address !== undefined) sets.push(Prisma.sql`address = ${input.address || null}`);
    if (input.province !== undefined) sets.push(Prisma.sql`province = ${input.province || null}`);
    if (input.municipality !== undefined) sets.push(Prisma.sql`municipality = ${input.municipality || null}`);
    if (sets.length === 0) {
      const cur = await this.prisma.runInTenant(schema, (tx) =>
        tx.$queryRaw<CustomerRow[]>(Prisma.sql`SELECT * FROM customers WHERE id = ${id}::uuid`));
      if (!cur[0]) throw new NotFoundException('Cliente não encontrado.');
      return cur[0];
    }
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<CustomerRow[]>(
        Prisma.sql`UPDATE customers SET ${Prisma.join([...sets, Prisma.sql`updated_at = now()`], ', ')} WHERE id = ${id}::uuid RETURNING *`,
      ),
    );
    if (!rows[0]) throw new NotFoundException('Cliente não encontrado.');
    return rows[0];
  }

  /** Elimina o cliente; se tiver faturas associadas, apenas desativa (integridade). */
  async removeCustomer(schema: string, id: string): Promise<{ deleted: boolean; deactivated: boolean }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const used = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM invoices WHERE customer_id = ${id}::uuid LIMIT 1`,
      );
      if (used[0]) {
        await tx.$executeRaw(Prisma.sql`UPDATE customers SET is_active = FALSE, updated_at = now() WHERE id = ${id}::uuid`);
        return { deleted: false, deactivated: true };
      }
      await tx.$executeRaw(Prisma.sql`DELETE FROM customers WHERE id = ${id}::uuid`);
      return { deleted: true, deactivated: false };
    });
  }

  // ── Rascunho do carrinho por operador (cross-device) ───────
  /** Lê o rascunho do carrinho guardado para um operador (ou null). */
  async getCartDraft(schema: string, userId: string): Promise<unknown | null> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ cart_draft: unknown | null }[]>(
        Prisma.sql`SELECT cart_draft FROM users WHERE id = ${userId}::uuid LIMIT 1`,
      );
      return rows[0]?.cart_draft ?? null;
    });
  }

  /** Guarda (substitui) o rascunho do carrinho do operador. */
  async saveCartDraft(schema: string, userId: string, draft: unknown): Promise<void> {
    await this.prisma.runInTenant(schema, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`UPDATE users SET cart_draft = ${JSON.stringify(draft)}::jsonb, updated_at = now() WHERE id = ${userId}::uuid`,
      );
    });
  }

  /** Limpa o rascunho do carrinho do operador (após finalizar/limpar). */
  async clearCartDraft(schema: string, userId: string): Promise<void> {
    await this.prisma.runInTenant(schema, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`UPDATE users SET cart_draft = NULL, updated_at = now() WHERE id = ${userId}::uuid`,
      );
    });
  }
}
