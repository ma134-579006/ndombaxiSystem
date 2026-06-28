import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildSignableString,
  computeDocumentHash,
  computeInvoice,
  DocumentType,
  formatDocumentNumber,
  GENESIS_HASH,
  InvoiceLineInput,
  IvaCode,
  requiresExemptionReason,
  round2,
} from '@nexus/agt-xml';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { FiscalSigningService } from './fiscal-signing.service';
import { StockService } from '../erp/stock.service';
import { TenantAuditService } from '../cashbox/tenant-audit.service';

export interface EmitInvoiceInput {
  docType: DocumentType;
  series: string;
  customerId?: string | null;
  /** NIF explícito (override); usado quando não há registo de cliente, ex. loja online. */
  customerTaxId?: string | null;
  cashierId?: string | null;
  cashierName?: string | null;
  /** Loja do operador — onde o stock é baixado e a que a factura pertence. */
  storeId?: string | null;
  /** Pagamento na caixa (para o turno): tipo + dinheiro entregue + troco. */
  paymentType?: 'CASH' | 'CARD' | 'TRANSFER' | 'REFERENCE' | 'EXPRESS' | 'CREDIT';
  tendered?: number | null;
  changeGiven?: number | null;
  /** Vencimento da conta a receber (venda a crédito); default +30 dias. */
  dueDate?: string | null;
  /** Documento retroativo: data da compra ORIGINAL (a data fiscal continua a ser hoje). */
  operationDate?: string | null;
  /**
   * Linhas do documento. Dois tipos:
   *  • PRODUTO — `{ productCode, quantity }`: preço/IVA do produto, baixa stock.
   *  • LIVRE — `{ description, unitPrice (LÍQUIDO), ivaCode, quantity }`: para
   *    serviços/mão-de-obra/estadia que não são produtos de stock (verticais).
   */
  lines: EmitLineInput[];
}

export type EmitLineInput =
  | { productCode: string; quantity: number; discountRate?: number }
  | { productCode?: undefined; description: string; unitPrice: number; ivaCode: IvaCode; quantity: number; discountRate?: number; exemptionReason?: string; exemptionCode?: string };

export interface EmittedInvoice {
  id: string;
  number: string;
  hash: string;
  previousHash: string;
  netTotal: number;
  ivaTotal: number;
  grossTotal: number;
}

interface ProductForEmission {
  id: string;
  description: string;
  iva_code: IvaCode;
  unit_price: string;
  cost_price?: string | null;
  exemption_reason?: string | null;
  exemption_code?: string | null;
  shared_stock?: boolean;
}

/**
 * Motivo de isenção por omissão para IVA que o exige (OUT/ISE) quando o
 * produto não tem um motivo definido. Garante que a venda NUNCA falha — o
 * motor fiscal exige um motivo nestes códigos. O gestor pode definir o motivo
 * correto por produto; isto é só a rede de segurança.
 */
const DEFAULT_EXEMPTION_REASON: Partial<Record<IvaCode, string>> = {
  [IvaCode.ISE]: 'Isento de IVA',
  [IvaCode.OUT]: 'Não sujeito a IVA',
};

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly signing: FiscalSigningService,
    private readonly audit: TenantAuditService,
  ) {}

  /**
   * Emite um documento fiscal de forma atómica (§7): resolve produtos, calcula
   * IVA, aloca a numeração sequencial sem saltos e encadeia o hash SHA-256 — tudo
   * numa só transacção com o search_path fixado ao schema do tenant.
   */
  async emit(schema: string, input: EmitInvoiceInput): Promise<EmittedInvoice> {
    // Venda a crédito exige um cliente identificado (a dívida fica em nome dele).
    if (input.paymentType === 'CREDIT' && !input.customerId) {
      throw new BadRequestException('Venda a crédito exige selecionar um cliente.');
    }
    const result = await this.prisma.runInTenant(schema, async (tx) => {
      // Códigos só das linhas de PRODUTO (as linhas livres não têm produto).
      const codes = input.lines
        .map((l) => ('productCode' in l ? l.productCode : undefined))
        .filter((c): c is string => !!c);

      // 1. Carrega e bloqueia os produtos pedidos (se houver).
      const productRows = codes.length
        ? await tx.$queryRaw<(ProductForEmission & { code: string; name: string })[]>(
            Prisma.sql`SELECT id, code, name, description, iva_code, unit_price, cost_price,
                              exemption_reason, exemption_code, shared_stock
                       FROM products
                       WHERE code IN (${Prisma.join(codes)}) AND is_active = TRUE
                       FOR UPDATE`,
          )
        : [];
      const byCode = new Map<string, ProductForEmission & { code: string; name: string }>();
      for (const p of productRows) byCode.set(p.code, p);

      // FICHA TÉCNICA (BOM): produtos compostos (ex.: hambúrguer) não têm stock
      // próprio — consomem INGREDIENTES. Carrega as receitas dos produtos vendidos;
      // na venda baixa-se o stock dos ingredientes (não do prato).
      const prodIds = productRows.map((p) => p.id);
      const recipeRows = prodIds.length
        ? await tx.$queryRaw<{ product_id: string; ingredient_id: string; quantity: string; shared_stock: boolean | null; name: string }[]>(
            Prisma.sql`SELECT r.product_id, r.ingredient_id, r.quantity, p.shared_stock, p.name
                       FROM product_recipes r JOIN products p ON p.id = r.ingredient_id
                       WHERE r.product_id IN (${Prisma.join(prodIds)})`)
        : [];
      const recipeByProduct = new Map<string, { ingredientId: string; quantity: number; sharedStock: boolean; name: string }[]>();
      for (const r of recipeRows) {
        const list = recipeByProduct.get(r.product_id) ?? [];
        list.push({ ingredientId: r.ingredient_id, quantity: Number(r.quantity), sharedStock: !!r.shared_stock, name: r.name });
        recipeByProduct.set(r.product_id, list);
      }

      const lineInputs: InvoiceLineInput[] = input.lines.map((l) => {
        // Linha LIVRE (serviço/mão-de-obra/estadia): preço já LÍQUIDO + IVA indicado.
        if (!('productCode' in l) || !l.productCode) {
          const free = l as Extract<EmitLineInput, { description: string }>;
          const exemptionReason = requiresExemptionReason(free.ivaCode)
            ? (free.exemptionReason?.trim() || DEFAULT_EXEMPTION_REASON[free.ivaCode] || 'Isento')
            : undefined;
          return {
            productCode: '', // marca de linha livre (sem produto/stock)
            description: free.description,
            quantity: free.quantity,
            unitPrice: free.unitPrice,
            ivaCode: free.ivaCode,
            discountRate: free.discountRate,
            exemptionReason,
            exemptionCode: free.exemptionCode,
          };
        }
        const p = byCode.get(l.productCode);
        if (!p) {
          throw new BadRequestException(`Produto não encontrado: ${l.productCode}`);
        }
        // IVA isento/não-sujeito (ISE/OUT) exige motivo: usa o do produto ou
        // um motivo por omissão (a venda nunca pode falhar por falta dele).
        const exemptionReason = requiresExemptionReason(p.iva_code)
          ? (p.exemption_reason?.trim() || DEFAULT_EXEMPTION_REASON[p.iva_code] || 'Isento')
          : undefined;
        return {
          productCode: l.productCode,
          description: p.name ?? p.description ?? l.productCode,
          quantity: l.quantity,
          unitPrice: Number(p.unit_price),
          ivaCode: p.iva_code,
          discountRate: l.discountRate,
          exemptionReason,
          exemptionCode: p.exemption_code ?? undefined,
        };
      });

      // 2. Calcula linhas + totais (motor fiscal puro).
      const { lines, totals } = computeInvoice(lineInputs);

      // 3. Aloca numeração + hash anterior, bloqueando a série fiscal.
      const year = new Date().getFullYear();
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO fiscal_series (doc_type, series, year, last_sequence, last_hash)
                   VALUES (${input.docType}, ${input.series}, ${year}, 0, ${GENESIS_HASH})
                   ON CONFLICT (doc_type, series, year) DO NOTHING`,
      );
      const serieRows = await tx.$queryRaw<
        { last_sequence: number; last_hash: string }[]
      >(
        Prisma.sql`SELECT last_sequence, last_hash FROM fiscal_series
                   WHERE doc_type = ${input.docType} AND series = ${input.series} AND year = ${year}
                   FOR UPDATE`,
      );
      const previousHash = serieRows[0].last_hash;
      const sequence = serieRows[0].last_sequence + 1;
      const number = formatDocumentNumber({
        type: input.docType,
        series: input.series,
        year,
        sequence,
      });

      // 4. Datas e cadeia de hash.
      const now = new Date();
      const invoiceDate = now.toISOString().slice(0, 10);
      const systemEntryDate = now.toISOString();
      const docHeader = { invoiceDate, systemEntryDate, number, totals };
      const signable = buildSignableString(docHeader, previousHash);
      const hash = computeDocumentHash(docHeader, previousHash);

      // Assinatura digital RSA-2048 (se a empresa já tiver chave activa). A
      // cadeia de hash SHA-256 mantém-se inalterada; a assinatura é adicional.
      const signer = await this.signing.getActiveSigner(schema, tx);
      let signature: string | null = null;
      let signatureKeyVersion: number | null = null;
      if (signer) {
        const signed = signer.signDocument(docHeader, previousHash);
        signature = signed.signature;
        signatureKeyVersion = signed.keyVersion;
      }

      // 5. Cliente (NIF + nome) opcional — override explícito tem prioridade.
      let customerTaxId: string | null = input.customerTaxId ?? null;
      let customerName: string | null = null;
      if (input.customerId) {
        const cust = await tx.$queryRaw<{ tax_id: string | null; name: string | null }[]>(
          Prisma.sql`SELECT tax_id, name FROM customers WHERE id = ${input.customerId}::uuid LIMIT 1`,
        );
        if (!customerTaxId) customerTaxId = cust[0]?.tax_id ?? null;
        customerName = cust[0]?.name ?? null;
      }

      // 6. Persiste documento + linhas, avança a série e baixa stock.
      await tx.$executeRaw(
        Prisma.sql`UPDATE fiscal_series
                   SET last_sequence = ${sequence}, last_hash = ${hash}
                   WHERE doc_type = ${input.docType} AND series = ${input.series} AND year = ${year}`,
      );

      // Loja onde a venda ocorre (a do operador; senão a loja principal). A
      // factura fica associada a esta loja.
      const warehouseId = input.storeId || (await StockService.resolveDefaultWarehouse(tx));
      const defStoreId = await StockService.resolveDefaultWarehouse(tx);

      /**
       * Resolve, por produto, DE ONDE sai o stock:
       *  - shared_stock = TRUE  → pool central (loja principal); valida pelo global.
       *  - shared_stock = FALSE → loja do operador (a do JWT); valida por essa loja.
       */
      const resolveLine = (p: ProductForEmission) => {
        const shared = !!p.shared_stock;
        const store = shared ? defStoreId : (input.storeId || defStoreId);
        return { shared, store };
      };

      // ── Validação de stock e validade ANTES de emitir ─────────────
      // A venda é bloqueada se não houver stock suficiente ou se o produto só
      // tiver lotes expirados. Toda a transacção é revertida (nada é gravado).
      const today = new Date().toISOString().slice(0, 10);
      for (const line of lines) {
        const product = byCode.get(line.productCode);
        if (!product) continue; // linha livre (serviço/estadia) — sem stock
        // Prato com ficha técnica: NÃO valida o stock do prato (é feito sob
        // encomenda); valida o stock dos INGREDIENTES (qtd da receita × qtd vendida).
        const recipe = recipeByProduct.get(product.id);
        if (recipe && recipe.length) {
          for (const ing of recipe) {
            const need = ing.quantity * line.quantity;
            const ir = await tx.$queryRaw<{ stock_qty: string }[]>(Prisma.sql`SELECT stock_qty FROM products WHERE id = ${ing.ingredientId}::uuid`);
            const have = ir[0] ? Number(ir[0].stock_qty) : 0;
            if (have < need) {
              throw new BadRequestException(`Ingrediente insuficiente para "${line.description}": ${ing.name} (disponível ${have}, necessário ${need}).`);
            }
          }
          continue;
        }
        const { shared, store: lineStore } = resolveLine(product);
        // Stock disponível: partilhado → global; por loja → saldo da loja (0 se sem linha).
        let available: number;
        if (shared || !lineStore) {
          const pr = await tx.$queryRaw<{ stock_qty: string }[]>(
            Prisma.sql`SELECT stock_qty FROM products WHERE id = ${product.id}::uuid`,
          );
          available = pr[0] ? Number(pr[0].stock_qty) : 0;
        } else {
          const si = await tx.$queryRaw<{ quantity: string }[]>(
            Prisma.sql`SELECT quantity FROM stock_items
                       WHERE product_id = ${product.id}::uuid AND warehouse_id = ${lineStore}::uuid`,
          );
          available = si[0] ? Number(si[0].quantity) : 0;
        }
        if (available < line.quantity) {
          throw new BadRequestException(
            `Stock insuficiente para "${line.description}": disponível ${available}, pedido ${line.quantity}.`,
          );
        }
        // Validade: se o produto é gerido por lotes e só tem lotes expirados, bloqueia.
        const batch = await tx.$queryRaw<{ total: string; valid: string }[]>(
          Prisma.sql`SELECT COALESCE(SUM(quantity),0) AS total,
                            COALESCE(SUM(quantity) FILTER (WHERE expiry_date IS NULL OR expiry_date >= ${today}::date),0) AS valid
                     FROM product_batches WHERE product_id = ${product.id}::uuid`,
        );
        if (batch[0] && Number(batch[0].total) > 0 && Number(batch[0].valid) <= 0) {
          throw new BadRequestException(
            `"${line.description}" está expirado (sem lotes válidos). Venda bloqueada.`,
          );
        }
      }

      const invRows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO invoices
            (number, doc_type, series, year, sequence, invoice_date, operation_date, system_entry_date, store_id,
             cashier_id, customer_id, customer_tax_id,
             net_total, iva_total, gross_total, signable_string, previous_hash, hash,
            signature, signature_key_version)
          VALUES (${number}, ${input.docType}, ${input.series}, ${year}, ${sequence},
                  ${invoiceDate}::date, ${input.operationDate ?? null}::date, ${systemEntryDate}::timestamptz, ${warehouseId ?? null}::uuid,
                  ${input.cashierId ?? null}::uuid, ${input.customerId ?? null}::uuid, ${customerTaxId},
                  ${totals.netTotal}, ${totals.ivaTotal}, ${totals.grossTotal},
                  ${signable}, ${previousHash}, ${hash}, ${signature}, ${signatureKeyVersion})
          RETURNING id`,
      );
      const invoiceId = invRows[0].id;

      // Stock partilhado: se a loja do operador não tiver o produto, a saída
      // sai do stock da loja principal (entrada feita com "Todas as lojas").
      // defStoreId já resolvido acima (na validação de stock).

      let lineNumber = 0;
      for (const line of lines) {
        lineNumber += 1;
        const product = byCode.get(line.productCode);
        // Linha LIVRE (serviço/estadia): sem produto, sem stock, custo 0.
        if (!product) {
          await tx.$executeRaw(
            Prisma.sql`INSERT INTO invoice_items
                (invoice_id, line_number, product_id, product_code, description, quantity,
                 unit_price, iva_code, iva_rate, discount_rate, net_amount, iva_amount, gross_amount,
                 unit_cost, exemption_reason, exemption_code)
              VALUES (${invoiceId}::uuid, ${lineNumber}, ${null}::uuid, ${'NS'},
                      ${line.description}, ${line.quantity}, ${line.unitPrice}, ${line.ivaCode},
                      ${line.ivaRate}, ${line.discountRate ?? 0}, ${line.netAmount},
                      ${line.ivaAmount}, ${line.grossAmount}, ${0},
                      ${line.exemptionReason ?? null}, ${line.exemptionCode ?? null})`,
          );
          continue;
        }
        const recipe = recipeByProduct.get(product.id);
        const { shared, store: lineStore } = resolveLine(product);
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO invoice_items
              (invoice_id, line_number, product_id, product_code, description, quantity,
               unit_price, iva_code, iva_rate, discount_rate, net_amount, iva_amount, gross_amount,
               unit_cost, exemption_reason, exemption_code)
            VALUES (${invoiceId}::uuid, ${lineNumber}, ${product.id}::uuid, ${line.productCode},
                    ${line.description}, ${line.quantity}, ${line.unitPrice}, ${line.ivaCode},
                    ${line.ivaRate}, ${line.discountRate ?? 0}, ${line.netAmount},
                    ${line.ivaAmount}, ${line.grossAmount}, ${Number(product.cost_price ?? 0)},
                    ${line.exemptionReason ?? null}, ${line.exemptionCode ?? null})`,
        );
        // Prato com ficha técnica: baixa os INGREDIENTES (não o prato). O custo
        // (unit_cost acima) já é o custo da receita (cost_price do prato).
        if (recipe && recipe.length) {
          for (const ing of recipe) {
            const store = ing.sharedStock ? defStoreId : (input.storeId || defStoreId);
            if (store) {
              await StockService.applyMovement(tx, {
                productId: ing.ingredientId, warehouseId: store, type: 'OUT',
                quantity: -(ing.quantity * line.quantity), reference: number, referenceId: invoiceId,
                createdBy: input.cashierId ?? null, allowNegative: true,
              });
            } else {
              await tx.$executeRaw(Prisma.sql`UPDATE products SET stock_qty = stock_qty - ${ing.quantity * line.quantity} WHERE id = ${ing.ingredientId}::uuid`);
            }
          }
          continue;
        }
        if (lineStore) {
          // Saída de stock pela venda. applyMovement também actualiza o espelho
          // global products.stock_qty. Stock partilhado: o pool central pode ficar
          // negativo (allowNegative) — representa stock localizado noutra loja; o
          // global já foi validado. Stock por loja: bloqueia (já validado acima).
          await StockService.applyMovement(tx, {
            productId: product.id,
            warehouseId: lineStore,
            type: 'OUT',
            quantity: -line.quantity,
            reference: number,
            referenceId: invoiceId,
            createdBy: input.cashierId ?? null,
            allowNegative: shared,
          });
        } else {
          await tx.$executeRaw(
            Prisma.sql`UPDATE products SET stock_qty = stock_qty - ${line.quantity}
                       WHERE id = ${product.id}::uuid`,
          );
        }
      }

      // Movimento de caixa: se o caixa tiver um turno aberto, regista a venda
      // no turno (com tipo de pagamento, dinheiro entregue e troco). Best-effort
      // dentro da tx — não bloqueia a emissão se não houver turno.
      if (input.cashierId) {
        const open = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM cash_sessions
                     WHERE status = 'OPEN' AND opened_by = ${input.cashierId}::uuid
                     ORDER BY opened_at DESC LIMIT 1`,
        );
        if (open[0]) {
          await tx.$executeRaw(
            Prisma.sql`INSERT INTO cash_movements
                (session_id, type, amount, payment_type, tendered, change_given, reference, reference_id, created_by)
              VALUES (${open[0].id}::uuid, 'SALE', ${totals.grossTotal},
                      ${input.paymentType ?? 'CASH'}, ${input.tendered ?? null}, ${input.changeGiven ?? null},
                      ${number}, ${invoiceId}::uuid, ${input.cashierId}::uuid)`,
          );
        }
      }

      // Venda a crédito (fiado): cria a conta a receber em nome do cliente.
      // O movimento de caixa acima fica com payment_type='CREDIT', por isso NÃO
      // conta como numerário no fecho do turno (o dinheiro entra ao liquidar).
      if (input.paymentType === 'CREDIT' && input.customerId) {
        const due = (input.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate))
          ? input.dueDate
          : new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10);
        const recRows = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`INSERT INTO receivables
              (customer_id, customer_name, invoice_id, invoice_number,
               original_amount, paid_amount, due_date, status, created_by, created_by_name)
            VALUES (${input.customerId}::uuid, ${customerName}, ${invoiceId}::uuid, ${number},
                    ${totals.grossTotal}, 0, ${due}::date, 'OPEN',
                    ${input.cashierId ?? null}::uuid, ${input.cashierName ?? null})
            RETURNING id`,
        );
        await this.audit.recordInTx(tx, {
          actorId: input.cashierId ?? null, actorName: input.cashierName ?? null,
          action: 'RECEIVABLE_CREATED', entity: 'receivable', entityId: recRows[0].id,
          details: { invoiceNumber: number, customer: customerName, amount: totals.grossTotal, dueDate: due },
        });
      }

      // Auditoria do tenant (venda emitida) — na MESMA transacção.
      await this.audit.recordInTx(tx, {
        actorId: input.cashierId ?? null,
        actorName: input.cashierName ?? null,
        action: 'SALE_EMITTED',
        entity: 'invoice',
        entityId: invoiceId,
        details: {
          number,
          grossTotal: totals.grossTotal,
          ivaTotal: totals.ivaTotal,
          paymentType: input.paymentType ?? 'CASH',
          items: lines.length,
        },
      });

      return {
        id: invoiceId,
        number,
        hash,
        previousHash,
        netTotal: totals.netTotal,
        ivaTotal: totals.ivaTotal,
        grossTotal: totals.grossTotal,
      };
    });

    // Notifica os dashboards em tempo real (best-effort, fora da transacção).
    this.realtime.publish(schema, 'sale.emitted', {
      number: result.number,
      grossTotal: result.grossTotal,
      ivaTotal: result.ivaTotal,
      at: new Date().toISOString(),
    });

    return result;
  }

  /**
   * Lista as vendas (facturas FT/FS) num período, com os produtos vendidos,
   * operador, total e estado. Usado pelo histórico de vendas da caixa, com
   * possibilidade de filtrar por datas e cancelar.
   */
  async listSales(
    schema: string,
    filters: { from?: string; to?: string } = {},
  ): Promise<Array<Record<string, unknown>>> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const conds: Prisma.Sql[] = [Prisma.sql`i.doc_type IN ('FT','FS')`];
      if (filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)) conds.push(Prisma.sql`i.system_entry_date >= ${filters.from}::date`);
      if (filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to)) conds.push(Prisma.sql`i.system_entry_date < (${filters.to}::date + 1)`);
      const where = Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}`;
      return tx.$queryRaw<Array<Record<string, unknown>>>(
        Prisma.sql`
          SELECT i.id, i.number, i.doc_type, i.system_entry_date, i.gross_total, i.status,
                 u.name AS cashier_name, c.name AS customer_name,
                 COALESCE((SELECT string_agg(ii.description || ' x' || ii.quantity, ', ')
                           FROM invoice_items ii WHERE ii.invoice_id = i.id), '') AS items
          FROM invoices i
          LEFT JOIN users u ON u.id = i.cashier_id
          LEFT JOIN customers c ON c.id = i.customer_id
          ${where}
          ORDER BY i.system_entry_date DESC
          LIMIT 500`,
      );
    });
  }

  /**
   * Detalhe completo de um documento já emitido — para REIMPRESSÃO (2ª via) de
   * vendas/documentos de hoje ou de dias anteriores que não foram impressos.
   * Nada se altera; é uma cópia fiel do documento fiscal original.
   */
  async getSaleDetail(schema: string, id: string): Promise<{
    invoice: { id: string; number: string; hash: string; previousHash: string; netTotal: number; ivaTotal: number; grossTotal: number };
    docType: string; date: string; operationDate: string | null; status: string;
    customerName: string | null; cashierName: string | null;
    items: { productCode: string; description: string; quantity: number; unitPrice: number; total: number }[];
  }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{
        id: string; number: string; doc_type: string; status: string; hash: string; previous_hash: string;
        net_total: string; iva_total: string; gross_total: string; system_entry_date: Date; operation_date: Date | null;
        customer_name: string | null; cashier_name: string | null;
      }[]>(
        Prisma.sql`SELECT i.id, i.number, i.doc_type, i.status, i.hash, i.previous_hash,
                          i.net_total, i.iva_total, i.gross_total, i.system_entry_date, i.operation_date,
                          c.name AS customer_name, u.name AS cashier_name
                   FROM invoices i
                   LEFT JOIN customers c ON c.id = i.customer_id
                   LEFT JOIN users u ON u.id = i.cashier_id
                   WHERE i.id = ${id}::uuid LIMIT 1`,
      );
      const inv = rows[0];
      if (!inv) throw new BadRequestException('Documento não encontrado.');
      const items = await tx.$queryRaw<{ product_code: string; description: string; quantity: string; gross_amount: string }[]>(
        Prisma.sql`SELECT product_code, description, quantity, gross_amount FROM invoice_items
                   WHERE invoice_id = ${id}::uuid ORDER BY line_number`,
      );
      return {
        invoice: {
          id: inv.id, number: inv.number, hash: inv.hash, previousHash: inv.previous_hash,
          netTotal: Number(inv.net_total), ivaTotal: Number(inv.iva_total), grossTotal: Number(inv.gross_total),
        },
        docType: inv.doc_type, status: inv.status,
        date: inv.system_entry_date.toISOString(),
        operationDate: inv.operation_date ? inv.operation_date.toISOString().slice(0, 10) : null,
        customerName: inv.customer_name, cashierName: inv.cashier_name,
        items: items.map((it) => {
          const total = Number(it.gross_amount);
          const qty = Number(it.quantity);
          return { productCode: it.product_code, description: it.description, quantity: qty, unitPrice: qty ? Math.round((total / qty) * 100) / 100 : total, total };
        }),
      };
    });
  }

  /**
   * Cancela uma venda emitindo uma NOTA DE CRÉDITO (NC) que a estorna: devolve
   * o stock, regista o estorno no caixa e na auditoria. A factura original NÃO
   * é apagada (princípio fiscal AGT — nada se apaga, tudo se estorna).
   */
  /**
   * Persiste a NOTA DE CRÉDITO como DOCUMENTO real (invoices + invoice_items),
   * ligada à fatura de origem. Sem isto a NC não entrava no SAF-T nem nos
   * relatórios. A cadeia de hash da série NC é mantida pelo chamador.
   */
  private async persistCreditNoteDoc(
    tx: Prisma.TransactionClient,
    nc: {
      number: string; series: string; year: number; sequence: number;
      invoiceDate: string; systemEntryDate: string; signable: string; previousHash: string; hash: string;
      storeId: string | null; customerId: string | null; customerTaxId: string | null;
      sourceInvoiceId: string; net: number; iva: number; gross: number;
      lines: {
        product_id: string | null; product_code: string; description: string; quantity: number;
        unit_price: number; iva_code: string; iva_rate: number; discount_rate: number;
        net_amount: number; iva_amount: number; gross_amount: number; unit_cost: number;
        exemption_reason: string | null; exemption_code: string | null;
      }[];
    },
  ): Promise<string> {
    const rows = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`INSERT INTO invoices
          (number, doc_type, series, year, sequence, invoice_date, system_entry_date,
           store_id, customer_id, customer_tax_id, net_total, iva_total, gross_total,
           signable_string, previous_hash, hash, status, source_invoice_id)
        VALUES (${nc.number}, ${DocumentType.NC}, ${nc.series}, ${nc.year}, ${nc.sequence},
                ${nc.invoiceDate}::date, ${nc.systemEntryDate}::timestamptz,
                ${nc.storeId}::uuid, ${nc.customerId}::uuid, ${nc.customerTaxId},
                ${nc.net}, ${nc.iva}, ${nc.gross}, ${nc.signable}, ${nc.previousHash}, ${nc.hash},
                'N', ${nc.sourceInvoiceId}::uuid)
        RETURNING id`,
    );
    const ncId = rows[0].id;
    let ln = 0;
    for (const l of nc.lines) {
      ln += 1;
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO invoice_items
            (invoice_id, line_number, product_id, product_code, description, quantity,
             unit_price, iva_code, iva_rate, discount_rate, net_amount, iva_amount, gross_amount,
             unit_cost, exemption_reason, exemption_code)
          VALUES (${ncId}::uuid, ${ln}, ${l.product_id}::uuid, ${l.product_code}, ${l.description}, ${l.quantity},
                  ${l.unit_price}, ${l.iva_code}, ${l.iva_rate}, ${l.discount_rate}, ${l.net_amount},
                  ${l.iva_amount}, ${l.gross_amount}, ${l.unit_cost}, ${l.exemption_reason}, ${l.exemption_code})`,
      );
    }
    return ncId;
  }

  async cancelInvoice(
    schema: string,
    invoiceId: string,
    reason: string,
    actor: { id?: string | null; name?: string | null },
  ): Promise<{ creditNoteNumber: string; grossTotal: number }> {
    const result = await this.prisma.runInTenant(schema, async (tx) => {
      // 1. Carrega a factura + linhas (bloqueia).
      const invRows = await tx.$queryRaw<
        { id: string; number: string; status: string; gross_total: string; net_total: string; iva_total: string; customer_id: string | null; customer_tax_id: string | null; store_id: string | null }[]
      >(
        Prisma.sql`SELECT id, number, status, gross_total, net_total, iva_total, customer_id, customer_tax_id, store_id
                   FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`,
      );
      if (!invRows[0]) throw new BadRequestException('Factura não encontrada');
      const inv = invRows[0];
      if (inv.status === 'A') throw new BadRequestException('Esta venda já foi anulada.');

      const items = await tx.$queryRaw<
        { product_id: string | null; product_code: string; description: string; quantity: string; shared_stock: boolean | null;
          unit_price: string; iva_code: string; iva_rate: string; discount_rate: string;
          net_amount: string; iva_amount: string; gross_amount: string; unit_cost: string;
          exemption_reason: string | null; exemption_code: string | null }[]
      >(
        Prisma.sql`SELECT ii.product_id, ii.product_code, ii.description, ii.quantity, p.shared_stock,
                          ii.unit_price, ii.iva_code, ii.iva_rate, ii.discount_rate,
                          ii.net_amount, ii.iva_amount, ii.gross_amount, ii.unit_cost,
                          ii.exemption_reason, ii.exemption_code
                   FROM invoice_items ii
                   LEFT JOIN products p ON p.id = ii.product_id
                   WHERE ii.invoice_id = ${invoiceId}::uuid ORDER BY ii.line_number`,
      );

      // 2. Aloca número de NC na série própria (NC, mesma série/ano).
      const year = new Date().getFullYear();
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO fiscal_series (doc_type, series, year, last_sequence, last_hash)
                   VALUES (${DocumentType.NC}, 'A', ${year}, 0, ${GENESIS_HASH})
                   ON CONFLICT (doc_type, series, year) DO NOTHING`,
      );
      const serie = await tx.$queryRaw<{ last_sequence: number; last_hash: string }[]>(
        Prisma.sql`SELECT last_sequence, last_hash FROM fiscal_series
                   WHERE doc_type = ${DocumentType.NC} AND series = 'A' AND year = ${year} FOR UPDATE`,
      );
      const sequence = serie[0].last_sequence + 1;
      const previousHash = serie[0].last_hash;
      const ncNumber = formatDocumentNumber({ type: DocumentType.NC, series: 'A', year, sequence });
      const now = new Date();
      const docHeader = {
        invoiceDate: now.toISOString().slice(0, 10),
        systemEntryDate: now.toISOString(),
        number: ncNumber,
        totals: { netTotal: Number(inv.net_total), ivaTotal: Number(inv.iva_total), grossTotal: Number(inv.gross_total), byTaxCode: [] },
      };
      const hash = computeDocumentHash(docHeader, previousHash);
      const signable = buildSignableString(docHeader, previousHash);
      await tx.$executeRaw(
        Prisma.sql`UPDATE fiscal_series SET last_sequence = ${sequence}, last_hash = ${hash}
                   WHERE doc_type = ${DocumentType.NC} AND series = 'A' AND year = ${year}`,
      );

      // 2b. Persiste a NC como DOCUMENTO (entra no SAF-T e nos relatórios), com
      //     todas as linhas da fatura original (anulação total).
      await this.persistCreditNoteDoc(tx, {
        number: ncNumber, series: 'A', year, sequence,
        invoiceDate: docHeader.invoiceDate, systemEntryDate: docHeader.systemEntryDate,
        signable, previousHash, hash,
        storeId: inv.store_id, customerId: inv.customer_id, customerTaxId: inv.customer_tax_id,
        sourceInvoiceId: invoiceId,
        net: Number(inv.net_total), iva: Number(inv.iva_total), gross: Number(inv.gross_total),
        lines: items.map((it) => ({
          product_id: it.product_id, product_code: it.product_code, description: it.description,
          quantity: Number(it.quantity), unit_price: Number(it.unit_price), iva_code: it.iva_code,
          iva_rate: Number(it.iva_rate), discount_rate: Number(it.discount_rate),
          net_amount: Number(it.net_amount), iva_amount: Number(it.iva_amount), gross_amount: Number(it.gross_amount),
          unit_cost: Number(it.unit_cost), exemption_reason: it.exemption_reason, exemption_code: it.exemption_code,
        })),
      });

      // 3. Marca a factura original como Anulada (status 'A').
      await tx.$executeRaw(
        Prisma.sql`UPDATE invoices SET status = 'A' WHERE id = ${invoiceId}::uuid`,
      );

      // 3b. Se era venda a CRÉDITO, anula a conta a receber (a dívida deixa de
      // existir). Guarda to_regclass p/ tenants antigos sem a tabela.
      const hasRec = await tx.$queryRaw<{ reg: string | null }[]>(
        Prisma.sql`SELECT to_regclass('receivables')::text AS reg`,
      );
      if (hasRec[0]?.reg) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE receivables SET status = 'CANCELLED'
                     WHERE invoice_id = ${invoiceId}::uuid AND status NOT IN ('PAID','CANCELLED')`,
        );
      }

      // 4. Devolve o stock (movimento IN) à loja certa: partilhado → pool central
      //    (loja principal); por loja → a loja onde a venda foi feita (store_id).
      const defWh = await StockService.resolveDefaultWarehouse(tx);
      for (const it of items) {
        if (!it.product_id) continue;
        const warehouseId = it.shared_stock ? defWh : (inv.store_id || defWh);
        if (warehouseId) {
          await StockService.applyMovement(tx, {
            productId: it.product_id, warehouseId, type: 'IN', quantity: Number(it.quantity),
            reference: `Anulação ${inv.number} (${ncNumber})`, referenceId: invoiceId, createdBy: actor.id ?? null,
            allowNegative: true,
          });
        } else {
          await tx.$executeRaw(
            Prisma.sql`UPDATE products SET stock_qty = stock_qty + ${Number(it.quantity)} WHERE id = ${it.product_id}::uuid`,
          );
        }
      }

      // 5. Estorno no caixa (se houver turno aberto do operador).
      if (actor.id) {
        const open = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM cash_sessions WHERE status = 'OPEN' AND opened_by = ${actor.id}::uuid ORDER BY opened_at DESC LIMIT 1`,
        );
        if (open[0]) {
          await tx.$executeRaw(
            Prisma.sql`INSERT INTO cash_movements (session_id, type, amount, payment_type, reference, reference_id, created_by)
              VALUES (${open[0].id}::uuid, 'REFUND', ${Number(inv.gross_total)}, 'CASH', ${ncNumber}, ${invoiceId}::uuid, ${actor.id}::uuid)`,
          );
        }
      }

      // 6. Auditoria.
      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name, action: 'SALE_CANCELLED',
        entity: 'invoice', entityId: invoiceId,
        details: { originalNumber: inv.number, creditNote: ncNumber, grossTotal: Number(inv.gross_total), reason },
      });

      return { creditNoteNumber: ncNumber, grossTotal: Number(inv.gross_total) };
    });

    this.realtime.publish(schema, 'sale.cancelled', {
      creditNote: result.creditNoteNumber, grossTotal: result.grossTotal, at: new Date().toISOString(),
    });
    return result;
  }

  /**
   * Devolução PARCIAL: emite uma NC só pelas linhas/quantidades devolvidas,
   * repõe esse stock e estorna o valor proporcional. A factura mantém-se válida
   * (não é anulada); valida que não se devolve mais do que o vendido.
   */
  async returnItems(
    schema: string,
    invoiceId: string,
    returns: { productCode: string; quantity: number }[],
    reason: string,
    actor: { id?: string | null; name?: string | null },
  ): Promise<{ creditNoteNumber: string; refundTotal: number }> {
    if (!returns?.length) throw new BadRequestException('Indique os artigos a devolver.');

    const result = await this.prisma.runInTenant(schema, async (tx) => {
      const invRows = await tx.$queryRaw<{ id: string; number: string; status: string; store_id: string | null; customer_id: string | null; customer_tax_id: string | null }[]>(
        Prisma.sql`SELECT id, number, status, store_id, customer_id, customer_tax_id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`,
      );
      if (!invRows[0]) throw new BadRequestException('Factura não encontrada');
      if (invRows[0].status === 'A') throw new BadRequestException('Factura já anulada — use a anulação total.');
      const inv = invRows[0];

      const items = await tx.$queryRaw<
        { product_id: string | null; product_code: string; description: string; quantity: string;
          iva_code: string; iva_rate: string; unit_price: string; discount_rate: string; shared_stock: boolean | null;
          unit_cost: string; exemption_reason: string | null; exemption_code: string | null }[]
      >(
        Prisma.sql`SELECT ii.product_id, ii.product_code, ii.description, ii.quantity, ii.iva_code,
                          ii.iva_rate, ii.unit_price, ii.discount_rate, p.shared_stock,
                          ii.unit_cost, ii.exemption_reason, ii.exemption_code
                   FROM invoice_items ii
                   LEFT JOIN products p ON p.id = ii.product_id
                   WHERE ii.invoice_id = ${invoiceId}::uuid`,
      );
      const byCode = new Map(items.map((i) => [i.product_code, i]));

      // Valida e calcula o valor a estornar (líquido+IVA, respeitando desconto).
      let refundNet = 0, refundIva = 0;
      const toRevert: { productId: string | null; qty: number; code: string; sharedStock: boolean }[] = [];
      const ncLines: Parameters<InvoiceService['persistCreditNoteDoc']>[1]['lines'] = [];
      for (const r of returns) {
        const it = byCode.get(r.productCode);
        if (!it) throw new BadRequestException(`Artigo não está na factura: ${r.productCode}`);
        if (r.quantity <= 0 || r.quantity > Number(it.quantity)) {
          throw new BadRequestException(`Quantidade a devolver inválida para ${r.productCode} (vendidas ${Number(it.quantity)}).`);
        }
        const unitNet = Number(it.unit_price) * (1 - Number(it.discount_rate || 0));
        const lineNet = round2(unitNet * r.quantity);
        const lineIva = round2((lineNet * Number(it.iva_rate)) / 100);
        refundNet += lineNet; refundIva += lineIva;
        toRevert.push({ productId: it.product_id, qty: r.quantity, code: r.productCode, sharedStock: !!it.shared_stock });
        ncLines.push({
          product_id: it.product_id, product_code: it.product_code, description: it.description, quantity: r.quantity,
          unit_price: Number(it.unit_price), iva_code: it.iva_code, iva_rate: Number(it.iva_rate),
          discount_rate: Number(it.discount_rate || 0), net_amount: lineNet, iva_amount: lineIva,
          gross_amount: round2(lineNet + lineIva), unit_cost: Number(it.unit_cost), exemption_reason: it.exemption_reason, exemption_code: it.exemption_code,
        });
      }
      refundNet = round2(refundNet);
      refundIva = round2(refundIva);
      const refundGross = round2(refundNet + refundIva);

      // Aloca NC.
      const year = new Date().getFullYear();
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO fiscal_series (doc_type, series, year, last_sequence, last_hash)
                   VALUES (${DocumentType.NC}, 'A', ${year}, 0, ${GENESIS_HASH})
                   ON CONFLICT (doc_type, series, year) DO NOTHING`,
      );
      const serie = await tx.$queryRaw<{ last_sequence: number; last_hash: string }[]>(
        Prisma.sql`SELECT last_sequence, last_hash FROM fiscal_series
                   WHERE doc_type = ${DocumentType.NC} AND series = 'A' AND year = ${year} FOR UPDATE`,
      );
      const sequence = serie[0].last_sequence + 1;
      const ncNumber = formatDocumentNumber({ type: DocumentType.NC, series: 'A', year, sequence });
      const now = new Date();
      const ncHeader = { invoiceDate: now.toISOString().slice(0, 10), systemEntryDate: now.toISOString(), number: ncNumber,
        totals: { netTotal: refundNet, ivaTotal: refundIva, grossTotal: refundGross, byTaxCode: [] } };
      const hash = computeDocumentHash(ncHeader, serie[0].last_hash);
      const signable = buildSignableString(ncHeader, serie[0].last_hash);
      await tx.$executeRaw(
        Prisma.sql`UPDATE fiscal_series SET last_sequence = ${sequence}, last_hash = ${hash}
                   WHERE doc_type = ${DocumentType.NC} AND series = 'A' AND year = ${year}`,
      );

      // Persiste a NC PARCIAL como documento (só as linhas devolvidas) — entra no
      // SAF-T e permite descontar a devolução nos lucros.
      await this.persistCreditNoteDoc(tx, {
        number: ncNumber, series: 'A', year, sequence,
        invoiceDate: ncHeader.invoiceDate, systemEntryDate: ncHeader.systemEntryDate,
        signable, previousHash: serie[0].last_hash, hash,
        storeId: inv.store_id, customerId: inv.customer_id, customerTaxId: inv.customer_tax_id,
        sourceInvoiceId: invoiceId, net: refundNet, iva: refundIva, gross: refundGross, lines: ncLines,
      });

      // Repõe o stock dos artigos devolvidos na loja certa (partilhado → central;
      // por loja → a loja onde a venda foi feita).
      const defWh = await StockService.resolveDefaultWarehouse(tx);
      for (const r of toRevert) {
        if (!r.productId) continue;
        const warehouseId = r.sharedStock ? defWh : (inv.store_id || defWh);
        if (warehouseId) {
          await StockService.applyMovement(tx, {
            productId: r.productId, warehouseId, type: 'IN', quantity: r.qty,
            reference: `Devolução ${inv.number} (${ncNumber})`, referenceId: invoiceId, createdBy: actor.id ?? null,
            allowNegative: true,
          });
        } else {
          await tx.$executeRaw(Prisma.sql`UPDATE products SET stock_qty = stock_qty + ${r.qty} WHERE id = ${r.productId}::uuid`);
        }
      }

      // Estorno no caixa.
      if (actor.id) {
        const open = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM cash_sessions WHERE status = 'OPEN' AND opened_by = ${actor.id}::uuid ORDER BY opened_at DESC LIMIT 1`,
        );
        if (open[0]) {
          await tx.$executeRaw(
            Prisma.sql`INSERT INTO cash_movements (session_id, type, amount, payment_type, reference, reference_id, created_by)
              VALUES (${open[0].id}::uuid, 'REFUND', ${refundGross}, 'CASH', ${ncNumber}, ${invoiceId}::uuid, ${actor.id}::uuid)`,
          );
        }
      }

      // Se era venda a crédito, reduz a dívida pelo valor devolvido (nunca abaixo
      // do que já foi pago; liquida se o saldo ficar a zero). Guarda to_regclass.
      const hasRec = await tx.$queryRaw<{ reg: string | null }[]>(
        Prisma.sql`SELECT to_regclass('receivables')::text AS reg`,
      );
      if (hasRec[0]?.reg) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE receivables
                     SET original_amount = GREATEST(paid_amount, ROUND(original_amount - ${refundGross}, 2)),
                         status = CASE WHEN paid_amount >= GREATEST(paid_amount, ROUND(original_amount - ${refundGross}, 2))
                                       THEN 'PAID' ELSE status END
                     WHERE invoice_id = ${invoiceId}::uuid AND status NOT IN ('CANCELLED')`,
        );
      }

      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name, action: 'SALE_RETURNED',
        entity: 'invoice', entityId: invoiceId,
        details: { originalNumber: inv.number, creditNote: ncNumber, refundTotal: refundGross,
                   items: toRevert.map((r) => ({ code: r.code, qty: r.qty })), reason },
      });

      return { creditNoteNumber: ncNumber, refundTotal: refundGross };
    });

    this.realtime.publish(schema, 'sale.cancelled', {
      creditNote: result.creditNoteNumber, grossTotal: result.refundTotal, at: new Date().toISOString(),
    });
    return result;
  }
}
