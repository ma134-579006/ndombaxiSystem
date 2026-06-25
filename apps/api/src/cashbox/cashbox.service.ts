import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { round2 } from '@nexus/agt-xml';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAuditService } from './tenant-audit.service';
import type { CashMovementDto, CloseSessionDto, OpenSessionDto } from './dto/cashbox.dto';

const fmtKz = (n: number) => `${n.toLocaleString('pt-PT')} Kz`;

interface Actor { id?: string | null; name?: string | null }

interface SessionRow {
  id: string; status: string; opening_float: string; store_id: string | null;
  opened_by: string | null; opened_by_name: string | null; opened_at: Date; register_code: string | null;
}

/**
 * Caixa por turnos (enterprise, estilo supermercado):
 *  • abrir turno (funcionário + fundo de troco)
 *  • registar vendas e movimentos de dinheiro (reforço/sangria) durante o turno
 *  • fechar: o operador conta o dinheiro físico; o sistema calcula o esperado
 *    (fundo + entradas em numerário − saídas) e a diferença → OK / quebra / sobra
 * Tudo registado na auditoria do tenant (data/hora/funcionário).
 */
@Injectable()
export class CashboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: TenantAuditService,
  ) {}

  /** Turno aberto do funcionário (1 por utilizador de cada vez). */
  async currentSession(schema: string, userId: string): Promise<unknown | null> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<SessionRow[]>(
        Prisma.sql`SELECT * FROM cash_sessions
                   WHERE status = 'OPEN' AND opened_by = ${userId}::uuid
                   ORDER BY opened_at DESC LIMIT 1`,
      ),
    );
    return rows[0] ?? null;
  }

  async open(schema: string, dto: OpenSessionDto, actor: Actor): Promise<{ id: string }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      // Impede dois turnos abertos para o mesmo funcionário.
      const open = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM cash_sessions
                   WHERE status = 'OPEN' AND opened_by = ${actor.id ?? null}::uuid LIMIT 1`,
      );
      if (open[0]) {
        throw new BadRequestException('Já tem um turno aberto. Feche-o antes de abrir outro.');
      }
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO cash_sessions
            (store_id, register_code, opened_by, opened_by_name, opening_float, status)
          VALUES (${dto.storeId ?? null}::uuid, ${dto.registerCode ?? null},
                  ${actor.id ?? null}::uuid, ${actor.name ?? null}, ${round2(dto.openingFloat)}, 'OPEN')
          RETURNING id`,
      );
      const id = rows[0].id;
      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name, action: 'SHIFT_OPEN',
        entity: 'cash_session', entityId: id,
        details: { openingFloat: round2(dto.openingFloat), registerCode: dto.registerCode ?? null },
      });
      return { id };
    });
  }

  /** Movimento manual: reforço (CASH_IN) ou sangria (CASH_OUT). */
  async addMovement(schema: string, dto: CashMovementDto, actor: Actor): Promise<{ id: string }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const session = await this.requireOpenSession(tx, actor.id);
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO cash_movements (session_id, type, amount, payment_type, reference, created_by)
          VALUES (${session.id}::uuid, ${dto.type}, ${round2(dto.amount)}, 'CASH',
                  ${dto.reference ?? null}, ${actor.id ?? null}::uuid)
          RETURNING id`,
      );
      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name,
        action: dto.type === 'CASH_IN' ? 'CASH_IN' : 'CASH_OUT',
        entity: 'cash_movement', entityId: rows[0].id,
        details: { amount: round2(dto.amount), reference: dto.reference ?? null },
      });
      return { id: rows[0].id };
    });
  }

  /**
   * Fecho do turno: calcula o esperado em numerário e compara com o contado.
   * Devolve o resumo completo (para imprimir o recibo de fecho).
   */
  async close(schema: string, dto: CloseSessionDto, actor: Actor) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const session = await this.requireOpenSession(tx, actor.id);

      // Agrega os movimentos do turno.
      const agg = await tx.$queryRaw<
        { type: string; payment_type: string | null; total: string; n: number }[]
      >(
        Prisma.sql`SELECT type, payment_type, COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS n
                   FROM cash_movements WHERE session_id = ${session.id}::uuid
                   GROUP BY type, payment_type`,
      );

      let salesTotal = 0, cashIn = 0, cashOut = 0, salesCount = 0;
      let cashSales = 0; // só vendas pagas em numerário entram no esperado físico
      let cashRefunds = 0; // reembolsos em numerário SAEM da gaveta (anulações/devoluções)
      for (const r of agg) {
        const total = Number(r.total);
        if (r.type === 'SALE') {
          salesTotal += total; salesCount += r.n;
          if ((r.payment_type ?? 'CASH') === 'CASH') cashSales += total;
        } else if (r.type === 'CASH_IN') cashIn += total;
        else if (r.type === 'CASH_OUT') cashOut += total;
        else if (r.type === 'REFUND') {
          if ((r.payment_type ?? 'CASH') === 'CASH') cashRefunds += total;
        }
      }

      // Vendas em CARTÃO/Multicaixa TPA (não entram no esperado físico da gaveta).
      const cardSales = round2(salesTotal - cashSales);

      // Adiantamentos APROVADOS pelo gestor e ainda não levantados: o caixa pode
      // levantar esse dinheiro da gaveta — é uma saída LEGÍTIMA, por isso reduz o
      // esperado (não dá quebra). Marca-os como levantados neste fecho.
      const advRows = await tx.$queryRaw<{ id: string; staff_name: string; amount: string }[]>(
        Prisma.sql`SELECT id, staff_name, amount FROM salary_advances
                   WHERE user_id = ${actor.id ?? null}::uuid AND status = 'APPROVED' AND disbursed_at IS NULL`,
      );
      const advancesPaid = round2(advRows.reduce((s, r) => s + Number(r.amount), 0));
      if (advRows.length > 0) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE salary_advances SET disbursed_at = now(), disbursed_session_id = ${session.id}::uuid
                     WHERE user_id = ${actor.id ?? null}::uuid AND status = 'APPROVED' AND disbursed_at IS NULL`,
        );
      }
      // Adiantamentos ainda POR APROVAR: se o caixa levantou dinheiro sem aprovação,
      // isso aparece como quebra — guardamos o motivo para mostrar no fecho.
      const pendRows = await tx.$queryRaw<{ staff_name: string; amount: string }[]>(
        Prisma.sql`SELECT staff_name, amount FROM salary_advances
                   WHERE user_id = ${actor.id ?? null}::uuid AND status = 'PENDING'`,
      );
      const pendingAdvances = pendRows.map((r) => ({ staffName: r.staff_name, amount: round2(Number(r.amount)) }));

      const openingFloat = Number(session.opening_float);
      // Esperado = fundo + vendas em numerário + reforços − sangrias − reembolsos
      //            − adiantamentos aprovados levantados.
      const expected = round2(openingFloat + cashSales + cashIn - cashOut - cashRefunds - advancesPaid);
      const counted = round2(dto.countedCash);
      const difference = round2(counted - expected);
      // estado: OK | quebra (falta) | sobra
      const verdict = difference === 0 ? 'OK' : difference < 0 ? 'QUEBRA' : 'SOBRA';
      // Motivo provável da quebra (ex.: levantamento de adiantamento sem aprovação).
      let breakReason: string | null = null;
      if (verdict === 'QUEBRA' && pendingAdvances.length > 0) {
        const tot = round2(pendingAdvances.reduce((s, a) => s + a.amount, 0));
        breakReason = `Há ${pendingAdvances.length} adiantamento(s) POR APROVAR (${fmtKz(tot)}). Se levantaste dinheiro sem o gestor aprovar, isso causa esta quebra — pede a aprovação primeiro.`;
      }

      await tx.$executeRaw(
        Prisma.sql`UPDATE cash_sessions SET
            status = 'CLOSED', closed_by = ${actor.id ?? null}::uuid, closed_by_name = ${actor.name ?? null},
            closed_at = now(), counted_cash = ${counted}, expected_cash = ${expected},
            difference = ${difference}, notes = ${dto.notes ?? null},
            total_sales = ${round2(salesTotal)}, total_cash_in = ${round2(cashIn)},
            total_cash_out = ${round2(cashOut + advancesPaid)}, sales_count = ${salesCount}
          WHERE id = ${session.id}::uuid`,
      );

      await this.audit.recordInTx(tx, {
        actorId: actor.id, actorName: actor.name, action: 'SHIFT_CLOSE',
        entity: 'cash_session', entityId: session.id,
        details: { openingFloat, cashSales, cardSales, cashIn, cashOut, cashRefunds, advancesPaid, expected, counted, difference, verdict, salesCount },
      });

      // Produtos vendidos no turno (para o recibo de fecho).
      const products = await tx.$queryRaw<{ product_code: string; description: string; qty: string; gross: string }[]>(
        Prisma.sql`SELECT ii.product_code, MAX(ii.description) AS description,
                          SUM(ii.quantity) AS qty, SUM(ii.gross_amount) AS gross
                   FROM cash_movements cm
                   JOIN invoices i ON i.id = cm.reference_id
                   JOIN invoice_items ii ON ii.invoice_id = i.id
                   WHERE cm.session_id = ${session.id}::uuid AND cm.type = 'SALE'
                   GROUP BY ii.product_code ORDER BY gross DESC`,
      );

      return {
        sessionId: session.id,
        openedByName: session.opened_by_name,
        openedAt: session.opened_at,
        closedAt: new Date().toISOString(),
        openingFloat, salesTotal: round2(salesTotal), cashSales, cardSales, cashIn, cashOut,
        cashRefunds: round2(cashRefunds), advancesPaid, pendingAdvances, breakReason,
        expected, counted, difference, verdict, salesCount,
        products: products.map((p) => ({
          productCode: p.product_code, description: p.description,
          quantity: Number(p.qty), grossTotal: Number(p.gross),
        })),
      };
    });
  }

  /**
   * Relatório X: leitura do turno ABERTO do funcionário, sem fechar (espreitar
   * o estado a meio do turno). Mesma agregação do fecho, mas não altera nada.
   */
  async reportX(schema: string, userId: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const session = await this.requireOpenSession(tx, userId);
      const agg = await tx.$queryRaw<{ type: string; payment_type: string | null; total: string; n: number }[]>(
        Prisma.sql`SELECT type, payment_type, COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS n
                   FROM cash_movements WHERE session_id = ${session.id}::uuid GROUP BY type, payment_type`,
      );
      let salesTotal = 0, cashIn = 0, cashOut = 0, salesCount = 0, cashSales = 0, cashRefunds = 0;
      const byPayment: Record<string, number> = {};
      for (const r of agg) {
        const total = Number(r.total);
        if (r.type === 'SALE') {
          salesTotal += total; salesCount += r.n;
          const pt = r.payment_type ?? 'CASH';
          byPayment[pt] = (byPayment[pt] ?? 0) + total;
          if (pt === 'CASH') cashSales += total;
        } else if (r.type === 'CASH_IN') cashIn += total;
        else if (r.type === 'CASH_OUT') cashOut += total;
        else if (r.type === 'REFUND') {
          if ((r.payment_type ?? 'CASH') === 'CASH') cashRefunds += total;
        }
      }
      const openingFloat = Number(session.opening_float);
      const cardSales = round2(salesTotal - cashSales);
      // Adiantamentos aprovados por levantar (reduzem o esperado no fecho).
      const advAgg = await tx.$queryRaw<{ total: string }[]>(
        Prisma.sql`SELECT COALESCE(SUM(amount),0)::text AS total FROM salary_advances
                   WHERE user_id = ${userId}::uuid AND status = 'APPROVED' AND disbursed_at IS NULL`,
      );
      const advancesApproved = round2(Number(advAgg[0]?.total) || 0);
      return {
        type: 'X',
        sessionId: session.id,
        openedByName: session.opened_by_name,
        openedAt: session.opened_at,
        now: new Date().toISOString(),
        openingFloat, salesTotal: round2(salesTotal), salesCount,
        cashSales: round2(cashSales), cardSales, cashIn: round2(cashIn), cashOut: round2(cashOut),
        cashRefunds: round2(cashRefunds), advancesApproved,
        expectedCash: round2(openingFloat + cashSales + cashIn - cashOut - cashRefunds - advancesApproved),
        byPayment,
      };
    });
  }

  /** Histórico de turnos (gerente). */
  listSessions(schema: string, limit = 50): Promise<unknown[]> {
    const n = Math.min(Math.max(limit, 1), 200);
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT id, register_code, opened_by_name, opened_at, closed_by_name, closed_at,
                          opening_float, counted_cash, expected_cash, difference, status,
                          total_sales, sales_count
                   FROM cash_sessions ORDER BY opened_at DESC LIMIT ${n}`,
      ),
    );
  }

  private async requireOpenSession(tx: Prisma.TransactionClient, userId?: string | null): Promise<SessionRow> {
    const rows = await tx.$queryRaw<SessionRow[]>(
      Prisma.sql`SELECT * FROM cash_sessions
                 WHERE status = 'OPEN' AND opened_by = ${userId ?? null}::uuid
                 ORDER BY opened_at DESC LIMIT 1`,
    );
    if (!rows[0]) throw new BadRequestException('Não há turno de caixa aberto. Abra um turno primeiro.');
    return rows[0];
  }
}
