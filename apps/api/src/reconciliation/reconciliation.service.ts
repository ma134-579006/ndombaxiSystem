import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { round2 } from '@nexus/agt-xml';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAuditService } from '../cashbox/tenant-audit.service';

export interface BankTxRow {
  id: string;
  statement_date: string;
  description: string | null;
  amount: string;
  matched: boolean;
  matched_type: string | null;
  matched_ref: string | null;
}

export interface ReconSummary {
  credits: number;
  debits: number;
  matchedCount: number;
  unmatchedCount: number;
}

type Actor = { id: string | null; name: string | null };
type ImportRow = { date: string; description?: string; amount: number };

/**
 * Conciliação bancária: importa um extrato (CSV) e cruza automaticamente cada
 * movimento com vendas/recebimentos (créditos) ou gastos/pagamentos (débitos)
 * do mesmo valor e data. O que não casar fica para conciliação manual.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: TenantAuditService,
  ) {}

  private async exists(tx: Prisma.TransactionClient, name: string): Promise<boolean> {
    const r = await tx.$queryRaw<{ reg: string | null }[]>(Prisma.sql`SELECT to_regclass(${name})::text AS reg`);
    return !!r[0]?.reg;
  }

  /** Importa linhas do extrato e tenta auto-conciliar. */
  async importStatement(schema: string, rows: ImportRow[], actor: Actor): Promise<{ imported: number; matched: number }> {
    const valid = (rows ?? []).filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) && Number.isFinite(Number(r.amount)) && Number(r.amount) !== 0);
    if (valid.length === 0) throw new BadRequestException('Sem linhas válidas no extrato (data YYYY-MM-DD e valor ≠ 0).');

    return this.prisma.runInTenant(schema, async (tx) => {
      const hasRecv = await this.exists(tx, 'receivable_payments');
      const hasExp = await this.exists(tx, 'expenses');
      const hasPay = await this.exists(tx, 'payable_payments');
      let matched = 0;

      for (const r of valid) {
        const amount = round2(Number(r.amount));
        const date = String(r.date);
        let mType: string | null = null;
        let mRef: string | null = null;

        if (amount > 0) {
          // Crédito → venda do dia com o mesmo total, senão recebimento de dívida.
          const sale = await tx.$queryRaw<{ number: string }[]>(
            Prisma.sql`SELECT number FROM invoices
                       WHERE status <> 'A' AND gross_total = ${amount} AND invoice_date = ${date}::date
                       LIMIT 1`,
          );
          if (sale[0]) { mType = 'SALE'; mRef = sale[0].number; }
          else if (hasRecv) {
            const rp = await tx.$queryRaw<{ receipt_number: string | null }[]>(
              Prisma.sql`SELECT receipt_number FROM receivable_payments
                         WHERE amount = ${amount} AND paid_at::date = ${date}::date LIMIT 1`,
            );
            if (rp[0]) { mType = 'RECEIVABLE'; mRef = rp[0].receipt_number ?? 'recibo'; }
          }
        } else {
          // Débito → gasto do dia com o mesmo valor, senão pagamento a fornecedor.
          const abs = round2(-amount);
          if (hasExp) {
            const ex = await tx.$queryRaw<{ id: string }[]>(
              Prisma.sql`SELECT id FROM expenses WHERE amount = ${abs} AND expense_date = ${date}::date LIMIT 1`,
            );
            if (ex[0]) { mType = 'EXPENSE'; mRef = 'gasto'; }
          }
          if (!mType && hasPay) {
            const pp = await tx.$queryRaw<{ reference_number: string | null }[]>(
              Prisma.sql`SELECT reference_number FROM payable_payments WHERE amount = ${abs} AND paid_at::date = ${date}::date LIMIT 1`,
            );
            if (pp[0]) { mType = 'PAYABLE'; mRef = pp[0].reference_number ?? 'pagamento'; }
          }
        }

        await tx.$executeRaw(
          Prisma.sql`INSERT INTO bank_transactions
              (statement_date, description, amount, matched, matched_type, matched_ref, created_by, created_by_name)
            VALUES (${date}::date, ${r.description ?? null}, ${amount}, ${mType !== null}, ${mType}, ${mRef},
                    ${actor.id}::uuid, ${actor.name})`,
        );
        if (mType) matched += 1;
      }

      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name,
        action: 'BANK_STATEMENT_IMPORTED', entity: 'bank_transactions', entityId: null,
        details: { imported: valid.length, autoMatched: matched },
      });
      return { imported: valid.length, matched };
    });
  }

  list(schema: string, filter?: string): Promise<BankTxRow[]> {
    const where =
      filter === 'matched' ? Prisma.sql`WHERE matched = TRUE`
      : filter === 'unmatched' ? Prisma.sql`WHERE matched = FALSE`
      : Prisma.sql``;
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<BankTxRow[]>(Prisma.sql`
        SELECT id, to_char(statement_date,'YYYY-MM-DD') AS statement_date, description, amount,
               matched, matched_type, matched_ref
        FROM bank_transactions ${where}
        ORDER BY statement_date DESC, imported_at DESC LIMIT 2000`),
    );
  }

  async summary(schema: string): Promise<ReconSummary> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const r = await tx.$queryRaw<{ credits: string; debits: string; matched: number; unmatched: number }[]>(Prisma.sql`
        SELECT COALESCE(SUM(amount) FILTER (WHERE amount > 0),0) AS credits,
               COALESCE(SUM(-amount) FILTER (WHERE amount < 0),0) AS debits,
               COUNT(*) FILTER (WHERE matched)::int AS matched,
               COUNT(*) FILTER (WHERE NOT matched)::int AS unmatched
        FROM bank_transactions`);
      return {
        credits: round2(Number(r[0].credits)), debits: round2(Number(r[0].debits)),
        matchedCount: Number(r[0].matched), unmatchedCount: Number(r[0].unmatched),
      };
    });
  }

  /** Concilia manualmente (ou marca como ignorado/manual). */
  async setMatch(schema: string, id: string, matched: boolean, type: string | null, actor: Actor): Promise<{ id: string }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`UPDATE bank_transactions
                   SET matched = ${matched}, matched_type = ${matched ? (type ?? 'MANUAL') : null},
                       matched_ref = ${matched ? 'manual' : null}
                   WHERE id = ${id}::uuid RETURNING id`,
      );
      if (rows.length === 0) throw new NotFoundException('Movimento não encontrado.');
      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name,
        action: matched ? 'BANK_TX_MATCHED' : 'BANK_TX_UNMATCHED', entity: 'bank_transaction', entityId: id,
      });
      return { id };
    });
  }
}
