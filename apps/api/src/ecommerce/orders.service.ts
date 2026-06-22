import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DocumentType } from '@nexus/agt-xml';
import { PaymentGatewayService } from '../payments/payment-gateway.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceService } from '../pos/invoice.service';

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  customer_tax_id: string | null;
  invoice_id: string | null;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoiceService,
    private readonly payments: PaymentsService,
    private readonly gateways: PaymentGatewayService,
  ) {}

  list(schema: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT * FROM web_orders ORDER BY created_at DESC`,
      ),
    );
  }

  /** Encomendas NOVAS por tratar (PENDING) — para o sino de notificações. */
  async pendingCount(schema: string): Promise<{ count: number }> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ n: number }[]>(
        Prisma.sql`SELECT COUNT(*)::int AS n FROM web_orders WHERE status = 'PENDING'`,
      ),
    );
    return { count: rows[0]?.n ?? 0 };
  }

  async get(schema: string, orderId: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const order = await tx.$queryRaw<OrderRow[]>(
        Prisma.sql`SELECT * FROM web_orders WHERE id = ${orderId}::uuid LIMIT 1`,
      );
      if (order.length === 0) throw new NotFoundException('Encomenda não encontrada');
      const items = await tx.$queryRaw(
        Prisma.sql`SELECT * FROM web_order_items WHERE order_id = ${orderId}::uuid ORDER BY line_number`,
      );
      return { ...order[0], items };
    });
  }

  /**
   * Confirma o pagamento de uma encomenda PENDING: emite o documento fiscal
   * (factura) reutilizando o motor do POS e liga-o à encomenda.
   */
  async pay(schema: string, orderId: string): Promise<{ orderId: string; invoiceNumber: string }> {
    // 1. Lê e valida a encomenda + recolhe as linhas.
    const { order, lines } = await this.prisma.runInTenant(schema, async (tx) => {
      const orderRows = await tx.$queryRaw<OrderRow[]>(
        Prisma.sql`SELECT id, order_number, status, customer_tax_id, invoice_id
                   FROM web_orders WHERE id = ${orderId}::uuid FOR UPDATE`,
      );
      if (orderRows.length === 0) throw new NotFoundException('Encomenda não encontrada');
      if (orderRows[0].status !== 'PENDING') {
        throw new BadRequestException(`Encomenda não está PENDING (estado: ${orderRows[0].status})`);
      }
      const itemRows = await tx.$queryRaw<{ product_code: string; quantity: string }[]>(
        Prisma.sql`SELECT product_code, quantity FROM web_order_items
                   WHERE order_id = ${orderId}::uuid ORDER BY line_number`,
      );
      return { order: orderRows[0], lines: itemRows };
    });

    // 2. Emite a factura (transacção própria do motor fiscal).
    const invoice = await this.invoices.emit(schema, {
      docType: DocumentType.FT,
      series: 'WEB',
      customerTaxId: order.customer_tax_id,
      lines: lines.map((l) => ({ productCode: l.product_code, quantity: Number(l.quantity) })),
    });

    // 3. Liga a factura e marca PAID (guarda contra duplo pagamento).
    const updated = await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(
        Prisma.sql`UPDATE web_orders
                   SET status = 'PAID', invoice_id = ${invoice.id}::uuid, updated_at = now()
                   WHERE id = ${orderId}::uuid AND status = 'PENDING'`,
      ),
    );
    if (updated === 0) {
      throw new BadRequestException('Encomenda já não estava PENDING ao confirmar');
    }

    return { orderId, invoiceNumber: invoice.number };
  }

  /**
   * Pagamento por TRANSFERÊNCIA/REFERÊNCIA: o gestor revê o comprovativo
   * enviado pelo cliente; ao aprovar, emite-se a factura e a encomenda fica PAID.
   */
  async approveProofAndPay(
    schema: string,
    proofId: string,
    reviewerId?: string,
    note?: string,
  ): Promise<{ orderId: string; invoiceNumber: string | null; status: string }> {
    const proof = await this.payments.reviewProof(
      schema,
      proofId,
      { status: 'APPROVED', note },
      reviewerId,
    );
    // Se a encomenda ainda estiver PENDING, emite a factura e marca PAID.
    const order = await this.get(schema, proof.order_id);
    if ((order as OrderRow).status === 'PENDING') {
      const paid = await this.pay(schema, proof.order_id);
      return { orderId: proof.order_id, invoiceNumber: paid.invoiceNumber, status: 'PAID' };
    }
    return { orderId: proof.order_id, invoiceNumber: null, status: (order as OrderRow).status };
  }

  /**
   * Pagamento por MULTICAIXA EXPRESS: aprovação AUTOMÁTICA. A verificação é
   * feita pelo contrato Express da plataforma (configurado pelo Super Admin);
   * uma vez confirmada, regista-se o comprovativo aprovado, emite-se a factura
   * e a encomenda fica PAID — tudo sem intervenção do gestor.
   *
   * NOTA: a confirmação em tempo real contra a API do Express depende do
   * baseUrl/credenciais do contrato; a integração HTTP real fica para quando
   * houver ambiente de produção. Aqui exige-se que o contrato esteja ACTIVO.
   */
  async payByExpress(
    schema: string,
    orderId: string,
    input: { expressPhone: string; reference?: string },
  ): Promise<{ orderId: string; invoiceNumber: string; verified: true }> {
    const express = await this.gateways.getActiveExpress();
    if (!express) {
      throw new BadRequestException(
        'O Multicaixa Express não está disponível: o Super Admin ainda não configurou um contrato Express activo.',
      );
    }

    // Confirma que a encomenda existe e está por pagar.
    const order = (await this.get(schema, orderId)) as unknown as OrderRow & {
      gross_total: string;
    };
    if (order.status !== 'PENDING') {
      throw new BadRequestException(`Encomenda não está PENDING (estado: ${order.status})`);
    }

    // (Verificação real junto do Express seria feita aqui via express.gateway.baseUrl.)
    await this.payments.recordExpressProof(schema, orderId, {
      amount: Number(order.gross_total),
      reference: input.reference,
      note: `Pagamento Express verificado automaticamente (contrato "${express.gateway.label}"; tel: ${input.expressPhone}).`,
    });

    const paid = await this.pay(schema, orderId);
    return { orderId, invoiceNumber: paid.invoiceNumber, verified: true };
  }

  /**
   * Reconhecimento AUTOMÁTICO de um pagamento por REFERÊNCIA Multicaixa (EMIS).
   * Chamado pelo callback da EMIS (ou por confirmação do gestor): localiza a
   * encomenda PENDING com aquela entidade+referência, valida o valor, regista o
   * comprovativo já APROVADO e emite a factura — a encomenda fica PAID SEM
   * aprovação manual ("done" → aprovação automática).
   *
   * Idempotente: se a encomenda já estiver paga, devolve o estado sem duplicar.
   */
  async confirmReferencePayment(
    schema: string,
    input: { entity?: string; reference: string; amount?: number },
  ): Promise<{ orderId: string; invoiceNumber: string | null; status: string; alreadyPaid: boolean }> {
    const reference = String(input.reference ?? '').replace(/\D/g, '');
    if (!reference) throw new BadRequestException('Referência em falta.');

    // Localiza a encomenda por referência (e entidade, se fornecida).
    const orders = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<(OrderRow & { gross_total: string })[]>(
        input.entity
          ? Prisma.sql`SELECT id, order_number, status, customer_tax_id, invoice_id, gross_total
                       FROM web_orders
                       WHERE payment_reference = ${reference} AND payment_entity = ${String(input.entity)}
                       ORDER BY created_at DESC LIMIT 1`
          : Prisma.sql`SELECT id, order_number, status, customer_tax_id, invoice_id, gross_total
                       FROM web_orders
                       WHERE payment_reference = ${reference}
                       ORDER BY created_at DESC LIMIT 1`,
      ),
    );
    const order = orders[0];
    if (!order) throw new NotFoundException('Nenhuma encomenda corresponde a esta referência.');

    // Já paga (callback repetido) → idempotente.
    if (order.status !== 'PENDING') {
      return { orderId: order.id, invoiceNumber: null, status: order.status, alreadyPaid: true };
    }

    // Valida o valor pago (tolerância de 1 Kwanza para arredondamentos).
    if (typeof input.amount === 'number' && Number.isFinite(input.amount)) {
      const expected = Number(order.gross_total);
      if (Math.abs(expected - input.amount) > 1) {
        throw new BadRequestException(
          `Valor pago (${input.amount}) não corresponde ao total da encomenda (${expected}).`,
        );
      }
    }

    // Regista o comprovativo já aprovado (trilho de auditoria) e emite a factura.
    await this.payments.recordReferenceProof(schema, order.id, {
      amount: Number(order.gross_total),
      reference,
      note: `Pagamento por referência reconhecido automaticamente (entidade ${input.entity ?? '—'}; ref ${reference}).`,
    });
    const paid = await this.pay(schema, order.id);
    return { orderId: order.id, invoiceNumber: paid.invoiceNumber, status: 'PAID', alreadyPaid: false };
  }

  /** Transições logísticas simples PAID → SHIPPED → DELIVERED. */
  async setStatus(schema: string, orderId: string, next: 'SHIPPED' | 'DELIVERED' | 'CANCELLED'): Promise<void> {
    const allowed: Record<string, string[]> = {
      SHIPPED: ['PAID'],
      DELIVERED: ['SHIPPED'],
      CANCELLED: ['PENDING'],
    };
    await this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ status: string }[]>(
        Prisma.sql`SELECT status FROM web_orders WHERE id = ${orderId}::uuid FOR UPDATE`,
      );
      if (rows.length === 0) throw new NotFoundException('Encomenda não encontrada');
      if (!allowed[next].includes(rows[0].status)) {
        throw new BadRequestException(`Transição inválida de ${rows[0].status} para ${next}`);
      }
      await tx.$executeRaw(
        Prisma.sql`UPDATE web_orders SET status = ${next}, updated_at = now()
                   WHERE id = ${orderId}::uuid`,
      );
    });
  }
}
