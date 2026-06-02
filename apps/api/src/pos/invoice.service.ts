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
  /** Pagamento na caixa (para o turno): tipo + dinheiro entregue + troco. */
  paymentType?: 'CASH' | 'CARD' | 'TRANSFER' | 'REFERENCE' | 'EXPRESS' | 'CREDIT';
  tendered?: number | null;
  changeGiven?: number | null;
  /** Vencimento da conta a receber (venda a crédito); default +30 dias. */
  dueDate?: string | null;
  lines: { productCode: string; quantity: number; discountRate?: number }[];
}

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
}

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
      const codes = input.lines.map((l) => l.productCode);

      // 1. Carrega e bloqueia os produtos pedidos.
      const productRows = await tx.$queryRaw<
        (ProductForEmission & { code: string; name: string })[]
      >(
        Prisma.sql`SELECT id, code, name, description, iva_code, unit_price, cost_price
                   FROM products
                   WHERE code IN (${Prisma.join(codes)}) AND is_active = TRUE
                   FOR UPDATE`,
      );
      const byCode = new Map<string, ProductForEmission & { code: string; name: string }>();
      for (const p of productRows) byCode.set(p.code, p);

      const lineInputs: InvoiceLineInput[] = input.lines.map((l) => {
        const p = byCode.get(l.productCode);
        if (!p) {
          throw new BadRequestException(`Produto não encontrado: ${l.productCode}`);
        }
        return {
          productCode: l.productCode,
          description: p.name ?? p.description ?? l.productCode,
          quantity: l.quantity,
          unitPrice: Number(p.unit_price),
          ivaCode: p.iva_code,
          discountRate: l.discountRate,
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

      const invRows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO invoices
            (number, doc_type, series, year, sequence, invoice_date, system_entry_date,
             cashier_id, customer_id, customer_tax_id,
             net_total, iva_total, gross_total, signable_string, previous_hash, hash,
            signature, signature_key_version)
          VALUES (${number}, ${input.docType}, ${input.series}, ${year}, ${sequence},
                  ${invoiceDate}::date, ${systemEntryDate}::timestamptz,
                  ${input.cashierId ?? null}::uuid, ${input.customerId ?? null}::uuid, ${customerTaxId},
                  ${totals.netTotal}, ${totals.ivaTotal}, ${totals.grossTotal},
                  ${signable}, ${previousHash}, ${hash}, ${signature}, ${signatureKeyVersion})
          RETURNING id`,
      );
      const invoiceId = invRows[0].id;

      // Stock: prefere o livro por armazém (stock_items + movimentos). Se o
      // tenant ainda não tem armazéns, cai no decremento global legado.
      const warehouseId = await StockService.resolveDefaultWarehouse(tx);

      let lineNumber = 0;
      for (const line of lines) {
        lineNumber += 1;
        const product = byCode.get(line.productCode)!;
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
        if (warehouseId) {
          // Saída de stock pela venda. allowNegative: uma factura legal nunca
          // pode ser bloqueada — saldo negativo fica para acerto de inventário.
          // applyMovement também actualiza o espelho global products.stock_qty.
          await StockService.applyMovement(tx, {
            productId: product.id,
            warehouseId,
            type: 'OUT',
            quantity: -line.quantity,
            reference: number,
            referenceId: invoiceId,
            createdBy: input.cashierId ?? null,
            allowNegative: true,
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
   * Cancela uma venda emitindo uma NOTA DE CRÉDITO (NC) que a estorna: devolve
   * o stock, regista o estorno no caixa e na auditoria. A factura original NÃO
   * é apagada (princípio fiscal AGT — nada se apaga, tudo se estorna).
   */
  async cancelInvoice(
    schema: string,
    invoiceId: string,
    reason: string,
    actor: { id?: string | null; name?: string | null },
  ): Promise<{ creditNoteNumber: string; grossTotal: number }> {
    const result = await this.prisma.runInTenant(schema, async (tx) => {
      // 1. Carrega a factura + linhas (bloqueia).
      const invRows = await tx.$queryRaw<
        { id: string; number: string; status: string; gross_total: string; net_total: string; iva_total: string; customer_id: string | null; customer_tax_id: string | null }[]
      >(
        Prisma.sql`SELECT id, number, status, gross_total, net_total, iva_total, customer_id, customer_tax_id
                   FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`,
      );
      if (!invRows[0]) throw new BadRequestException('Factura não encontrada');
      const inv = invRows[0];
      if (inv.status === 'A') throw new BadRequestException('Esta venda já foi anulada.');

      const items = await tx.$queryRaw<
        { product_id: string | null; product_code: string; description: string; quantity: string }[]
      >(
        Prisma.sql`SELECT product_id, product_code, description, quantity
                   FROM invoice_items WHERE invoice_id = ${invoiceId}::uuid ORDER BY line_number`,
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
      await tx.$executeRaw(
        Prisma.sql`UPDATE fiscal_series SET last_sequence = ${sequence}, last_hash = ${hash}
                   WHERE doc_type = ${DocumentType.NC} AND series = 'A' AND year = ${year}`,
      );

      // 3. Marca a factura original como Anulada (status 'A').
      await tx.$executeRaw(
        Prisma.sql`UPDATE invoices SET status = 'A' WHERE id = ${invoiceId}::uuid`,
      );

      // 4. Devolve o stock (movimento IN) ao armazém default.
      const warehouseId = await StockService.resolveDefaultWarehouse(tx);
      for (const it of items) {
        if (!it.product_id) continue;
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
      const invRows = await tx.$queryRaw<{ id: string; number: string; status: string }[]>(
        Prisma.sql`SELECT id, number, status FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`,
      );
      if (!invRows[0]) throw new BadRequestException('Factura não encontrada');
      if (invRows[0].status === 'A') throw new BadRequestException('Factura já anulada — use a anulação total.');
      const inv = invRows[0];

      const items = await tx.$queryRaw<
        { product_id: string | null; product_code: string; description: string; quantity: string;
          iva_code: string; iva_rate: string; unit_price: string; discount_rate: string }[]
      >(
        Prisma.sql`SELECT product_id, product_code, description, quantity, iva_code, iva_rate, unit_price, discount_rate
                   FROM invoice_items WHERE invoice_id = ${invoiceId}::uuid`,
      );
      const byCode = new Map(items.map((i) => [i.product_code, i]));

      // Valida e calcula o valor a estornar (líquido+IVA, respeitando desconto).
      let refundNet = 0, refundIva = 0;
      const toRevert: { productId: string | null; qty: number; code: string }[] = [];
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
        toRevert.push({ productId: it.product_id, qty: r.quantity, code: r.productCode });
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
      const hash = computeDocumentHash(
        { invoiceDate: now.toISOString().slice(0, 10), systemEntryDate: now.toISOString(), number: ncNumber,
          totals: { netTotal: refundNet, ivaTotal: refundIva, grossTotal: refundGross, byTaxCode: [] } },
        serie[0].last_hash,
      );
      await tx.$executeRaw(
        Prisma.sql`UPDATE fiscal_series SET last_sequence = ${sequence}, last_hash = ${hash}
                   WHERE doc_type = ${DocumentType.NC} AND series = 'A' AND year = ${year}`,
      );

      // Repõe o stock dos artigos devolvidos.
      const warehouseId = await StockService.resolveDefaultWarehouse(tx);
      for (const r of toRevert) {
        if (!r.productId) continue;
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
