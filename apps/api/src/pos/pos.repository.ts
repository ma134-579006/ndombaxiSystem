import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
  is_active: boolean;
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
  constructor(private readonly prisma: PrismaService) {}

  // ── Produtos ───────────────────────────────────────────────
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
    },
  ): Promise<ProductRow> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const shared = input.sharedStock ?? false;
      const rows = await tx.$queryRaw<ProductRow[]>(
        Prisma.sql`INSERT INTO products
            (code, barcode, name, description, category_id, brand, iva_code, exemption_reason, exemption_code,
             unit_price, cost_price, stock_qty, shared_stock, image_url, gallery, show_online)
          VALUES (${input.code}, ${input.barcode ?? null}, ${input.name},
                  ${input.description ?? null}, ${input.categoryId ?? null}::uuid, ${input.brand ?? null},
                  ${input.ivaCode}, ${input.exemptionReason ?? null}, ${input.exemptionCode ?? null},
                  ${input.unitPrice ?? 0}, ${input.costPrice ?? 0}, ${input.stockQty ?? 0}, ${shared},
                  ${input.imageUrl ?? null}, ${JSON.stringify(input.gallery ?? [])}::jsonb,
                  ${input.showOnline ?? true})
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
      const initial = Number(input.stockQty ?? 0);
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
  listProducts(schema: string, storeId?: string | null): Promise<ProductRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<ProductRow[]>(
        Prisma.sql`
          SELECT p.id, p.code, p.barcode, p.name, p.description, p.category_id, p.brand,
                 p.iva_code, p.exemption_reason, p.exemption_code, p.unit_price, p.cost_price,
                 CASE WHEN p.shared_stock OR ${storeId ?? null}::uuid IS NULL
                      THEN p.stock_qty ELSE COALESCE(si.quantity, 0) END AS stock_qty,
                 p.image_url, p.gallery, p.show_online, p.shared_stock, p.is_active
          FROM products p
          LEFT JOIN stock_items si
                 ON si.product_id = p.id AND si.warehouse_id = ${storeId ?? null}::uuid
          WHERE p.is_active = TRUE
          ORDER BY p.name`,
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
    },
  ): Promise<ProductRow> {
    const sets: Prisma.Sql[] = [];
    if (input.name !== undefined) sets.push(Prisma.sql`name = ${input.name}`);
    if (input.description !== undefined) sets.push(Prisma.sql`description = ${input.description}`);
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

  listCustomers(schema: string): Promise<CustomerRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<CustomerRow[]>(
        Prisma.sql`SELECT * FROM customers WHERE is_active = TRUE ORDER BY name`,
      ),
    );
  }
}
