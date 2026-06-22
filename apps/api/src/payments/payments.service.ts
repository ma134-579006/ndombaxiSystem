import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { validatePaymentMethod } from './payment-methods';
import { generateReference, isValidEntity } from './reference';
import type {
  CreatePaymentMethodDto,
  ReviewProofDto,
  UpdatePaymentMethodDto,
  UploadProofDto,
} from './dto/payment.dto';

/**
 * Pagamentos da loja (§ Fase 8).
 *   • Métodos de pagamento (transferência IBAN, referência, Multicaixa
 *     Express, numerário) configurados pelo gestor/admin da loja.
 *   • Comprovativos enviados pelos clientes; o gestor revê e aprova.
 * Tudo isolado no schema do tenant.
 */

export interface PaymentMethodRow {
  id: string;
  type: string;
  label: string;
  instructions: string | null;
  bank_name: string | null;
  iban: string | null;
  account_holder: string | null;
  reference_entity: string | null;
  reference_number: string | null;
  express_phone: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

export interface PaymentProofRow {
  id: string;
  order_id: string;
  method_type: string;
  amount: string | null;
  reference: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_url: string | null;
  status: string;
  note: string | null;
  uploaded_at: Date;
  reviewed_by: string | null;
  reviewed_at: Date | null;
}

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Métodos de pagamento (back-office do gestor) ────────────
  listMethods(schema: string, onlyActive = false): Promise<PaymentMethodRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<PaymentMethodRow[]>(
        onlyActive
          ? Prisma.sql`SELECT * FROM payment_methods WHERE is_active = TRUE ORDER BY sort_order, label`
          : Prisma.sql`SELECT * FROM payment_methods ORDER BY sort_order, label`,
      ),
    );
  }

  /**
   * Gera a referência Multicaixa de uma encomenda, a partir do método REFERENCE
   * configurado pela loja (entidade EMIS do contrato dela). Profissional: a
   * entidade vem do contrato; a referência é gerada por encomenda com validade.
   * Devolve null se a loja não tiver um método de referência com entidade.
   */
  async generateOrderReference(
    schema: string,
    orderId: string,
  ): Promise<{ entity: string; reference: string; amount: number; expiresAt: string } | null> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const methods = await tx.$queryRaw<PaymentMethodRow[]>(
        Prisma.sql`SELECT * FROM payment_methods
                   WHERE is_active = TRUE AND type = 'REFERENCE'
                   ORDER BY sort_order LIMIT 1`,
      );
      const m = methods[0];
      if (!m || !m.reference_entity || !isValidEntity(m.reference_entity)) return null;

      const order = await tx.$queryRaw<{ gross_total: string; created_at: Date }[]>(
        Prisma.sql`SELECT gross_total, created_at FROM web_orders WHERE id = ${orderId}::uuid LIMIT 1`,
      );
      if (order.length === 0) throw new NotFoundException('Encomenda não encontrada');

      const gen = generateReference(
        { entity: m.reference_entity },
        { seq: this.seqFromId(orderId), amount: Number(order[0].gross_total) },
      );
      // Persiste a referência gerada na encomenda → permite reconhecer depois o
      // pagamento (callback EMIS) e aprovar a encomenda automaticamente.
      await tx.$executeRaw(
        Prisma.sql`UPDATE web_orders
                   SET payment_method = 'REFERENCE', payment_entity = ${gen.entity},
                       payment_reference = ${gen.reference}, updated_at = now()
                   WHERE id = ${orderId}::uuid`,
      );
      return { entity: gen.entity, reference: gen.reference, amount: gen.amount, expiresAt: gen.expiresAt };
    });
  }

  /** Sequencial estável (8 dígitos) a partir do UUID. */
  private seqFromId(id: string): number {
    const hex = id.replace(/[^0-9a-f]/gi, '').slice(0, 8);
    return parseInt(hex, 16) % 100_000_000;
  }

  async getMethod(schema: string, id: string): Promise<PaymentMethodRow> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<PaymentMethodRow[]>(
        Prisma.sql`SELECT * FROM payment_methods WHERE id = ${id}::uuid LIMIT 1`,
      ),
    );
    if (!rows[0]) throw new NotFoundException(`Método de pagamento não encontrado: ${id}`);
    return rows[0];
  }

  async createMethod(schema: string, dto: CreatePaymentMethodDto): Promise<PaymentMethodRow> {
    // valida/normaliza com o motor puro (lança Error legível em pt-AO)
    const m = validatePaymentMethod(dto);
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<PaymentMethodRow[]>(
        Prisma.sql`INSERT INTO payment_methods
            (type, label, instructions, bank_name, iban, account_holder,
             reference_entity, reference_number, express_phone, is_active, sort_order)
          VALUES (${m.type}, ${m.label}, ${m.instructions ?? null}, ${m.bankName ?? null},
                  ${m.iban ?? null}, ${m.accountHolder ?? null}, ${m.referenceEntity ?? null},
                  ${m.referenceNumber ?? null}, ${m.expressPhone ?? null},
                  ${dto.isActive ?? true}, ${dto.sortOrder ?? 0})
          RETURNING *`,
      );
      return rows[0];
    });
  }

  async updateMethod(
    schema: string,
    id: string,
    dto: UpdatePaymentMethodDto,
  ): Promise<PaymentMethodRow> {
    const current = await this.getMethod(schema, id);
    // re-valida a combinação resultante (merge atual + alterações)
    const m = validatePaymentMethod({
      type: (dto.type ?? current.type) as CreatePaymentMethodDto['type'],
      label: dto.label ?? current.label,
      instructions: dto.instructions ?? current.instructions ?? undefined,
      bankName: dto.bankName ?? current.bank_name ?? undefined,
      iban: dto.iban ?? current.iban ?? undefined,
      accountHolder: dto.accountHolder ?? current.account_holder ?? undefined,
      referenceEntity: dto.referenceEntity ?? current.reference_entity ?? undefined,
      referenceNumber: dto.referenceNumber ?? current.reference_number ?? undefined,
      expressPhone: dto.expressPhone ?? current.express_phone ?? undefined,
    });

    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<PaymentMethodRow[]>(
        Prisma.sql`UPDATE payment_methods SET
            type = ${m.type}, label = ${m.label}, instructions = ${m.instructions ?? null},
            bank_name = ${m.bankName ?? null}, iban = ${m.iban ?? null},
            account_holder = ${m.accountHolder ?? null},
            reference_entity = ${m.referenceEntity ?? null},
            reference_number = ${m.referenceNumber ?? null},
            express_phone = ${m.expressPhone ?? null},
            is_active = ${dto.isActive ?? current.is_active},
            sort_order = ${dto.sortOrder ?? current.sort_order},
            updated_at = now()
          WHERE id = ${id}::uuid RETURNING *`,
      );
      return rows[0];
    });
  }

  async deleteMethod(schema: string, id: string): Promise<{ id: string }> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`DELETE FROM payment_methods WHERE id = ${id}::uuid RETURNING id`,
      ),
    );
    if (!rows[0]) throw new NotFoundException(`Método de pagamento não encontrado: ${id}`);
    return rows[0];
  }

  // ── Comprovativos de pagamento ──────────────────────────────
  /** Cliente envia o comprovativo de uma encomenda (montra pública). */
  async uploadProof(schema: string, orderId: string, dto: UploadProofDto): Promise<PaymentProofRow> {
    if (!dto.fileUrl && !dto.fileData) {
      throw new BadRequestException('Forneça o comprovativo (fileUrl ou fileData).');
    }
    return this.prisma.runInTenant(schema, async (tx) => {
      const order = await tx.$queryRaw<{ id: string; status: string }[]>(
        Prisma.sql`SELECT id, status FROM web_orders WHERE id = ${orderId}::uuid LIMIT 1`,
      );
      if (order.length === 0) throw new NotFoundException('Encomenda não encontrada');

      const rows = await tx.$queryRaw<PaymentProofRow[]>(
        Prisma.sql`INSERT INTO payment_proofs
            (order_id, method_type, amount, reference, file_name, file_mime, file_url, file_data)
          VALUES (${orderId}::uuid, ${dto.methodType ?? 'UNKNOWN'}, ${dto.amount ?? null},
                  ${dto.reference ?? null}, ${dto.fileName ?? null}, ${dto.fileMime ?? null},
                  ${dto.fileUrl ?? null}, ${dto.fileData ?? null})
          RETURNING id, order_id, method_type, amount, reference, file_name, file_mime,
                    file_url, status, note, uploaded_at, reviewed_by, reviewed_at`,
      );
      return rows[0];
    });
  }

  /**
   * Regista um comprovativo já APROVADO automaticamente (ex.: Multicaixa
   * Express verificado pelo gateway). Para trilho de auditoria do pagamento.
   */
  async recordExpressProof(
    schema: string,
    orderId: string,
    input: { amount?: number; reference?: string; note?: string },
  ): Promise<PaymentProofRow> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<PaymentProofRow[]>(
        Prisma.sql`INSERT INTO payment_proofs
            (order_id, method_type, amount, reference, status, note, reviewed_at)
          VALUES (${orderId}::uuid, 'MULTICAIXA_EXPRESS', ${input.amount ?? null},
                  ${input.reference ?? null}, 'APPROVED', ${input.note ?? null}, now())
          RETURNING id, order_id, method_type, amount, reference, file_name, file_mime,
                    file_url, status, note, uploaded_at, reviewed_by, reviewed_at`,
      );
      return rows[0];
    });
  }

  /**
   * Regista um comprovativo de REFERÊNCIA Multicaixa já APROVADO (reconhecido
   * automaticamente pelo callback EMIS). Trilho de auditoria do pagamento.
   */
  async recordReferenceProof(
    schema: string,
    orderId: string,
    input: { amount?: number; reference?: string; note?: string },
  ): Promise<PaymentProofRow> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<PaymentProofRow[]>(
        Prisma.sql`INSERT INTO payment_proofs
            (order_id, method_type, amount, reference, status, note, reviewed_at)
          VALUES (${orderId}::uuid, 'REFERENCE', ${input.amount ?? null},
                  ${input.reference ?? null}, 'APPROVED', ${input.note ?? null}, now())
          RETURNING id, order_id, method_type, amount, reference, file_name, file_mime,
                    file_url, status, note, uploaded_at, reviewed_by, reviewed_at`,
      );
      return rows[0];
    });
  }

  /** Lista comprovativos (gestor); opcionalmente filtra por estado. */
  listProofs(schema: string, status?: string): Promise<PaymentProofRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<PaymentProofRow[]>(
        status
          ? Prisma.sql`SELECT id, order_id, method_type, amount, reference, file_name,
                              file_mime, file_url, status, note, uploaded_at, reviewed_by, reviewed_at
                       FROM payment_proofs WHERE status = ${status} ORDER BY uploaded_at DESC`
          : Prisma.sql`SELECT id, order_id, method_type, amount, reference, file_name,
                              file_mime, file_url, status, note, uploaded_at, reviewed_by, reviewed_at
                       FROM payment_proofs ORDER BY uploaded_at DESC`,
      ),
    );
  }

  /** Devolve um comprovativo incluindo o conteúdo base64 (download). */
  async getProof(
    schema: string,
    id: string,
  ): Promise<PaymentProofRow & { file_data: string | null }> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<(PaymentProofRow & { file_data: string | null })[]>(
        Prisma.sql`SELECT * FROM payment_proofs WHERE id = ${id}::uuid LIMIT 1`,
      ),
    );
    if (!rows[0]) throw new NotFoundException(`Comprovativo não encontrado: ${id}`);
    return rows[0];
  }

  /** O gestor aprova/rejeita um comprovativo. */
  async reviewProof(
    schema: string,
    id: string,
    dto: ReviewProofDto,
    reviewerId?: string,
  ): Promise<PaymentProofRow> {
    const rows = await this.prisma.runInTenant(schema, async (tx) => {
      const existing = await tx.$queryRaw<{ status: string }[]>(
        Prisma.sql`SELECT status FROM payment_proofs WHERE id = ${id}::uuid FOR UPDATE`,
      );
      if (existing.length === 0) throw new NotFoundException(`Comprovativo não encontrado: ${id}`);
      if (existing[0].status !== 'PENDING') {
        throw new BadRequestException(
          `Comprovativo já revisto (estado: ${existing[0].status}).`,
        );
      }
      return tx.$queryRaw<PaymentProofRow[]>(
        Prisma.sql`UPDATE payment_proofs
            SET status = ${dto.status}, note = ${dto.note ?? null},
                reviewed_by = ${reviewerId ?? null}::uuid, reviewed_at = now()
            WHERE id = ${id}::uuid
            RETURNING id, order_id, method_type, amount, reference, file_name, file_mime,
                      file_url, status, note, uploaded_at, reviewed_by, reviewed_at`,
      );
    });
    return rows[0];
  }
}
