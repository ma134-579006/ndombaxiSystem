import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Programa de associados da LPS Kwanza (como o mercado de associados do Kikolo):
 *  • o gestor define a % de comissão em cada produto (sem % = produto fora do mercado);
 *  • cada associado aprovado tem um código pessoal (6 caracteres) para as suas ligações;
 *  • a encomenda feita com esse código (último clique) gera comissão por linha;
 *  • a comissão fica "pendente" até a empresa marcar a encomenda como VENDIDA (paga/faturada), "cancelada" se for cancelada;
 *  • o saldo disponível pode ser pedido em saque; o gestor marca como pago ou recusa.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const num = (v: unknown) => Number(v ?? 0) || 0;
const round2 = (v: number) => Math.round(v * 100) / 100;

export type CommissionState = 'PENDING' | 'AVAILABLE' | 'CANCELLED';
/** Vendida = a empresa marcou a encomenda como paga (faturada); daí em diante a comissão é do associado. */
export const SOLD_STATUSES = ['PAID', 'SHIPPED', 'DELIVERED'];
export const stateOf = (orderStatus: string): CommissionState =>
  SOLD_STATUSES.includes(orderStatus) ? 'AVAILABLE' : orderStatus === 'CANCELLED' ? 'CANCELLED' : 'PENDING';

export interface AffiliateSummary {
  code: string;
  pending: number; available: number; withdrawn: number; requested: number; balance: number;
  sales: { orderNumber: string; date: string; product: string; quantity: number; amount: number; state: CommissionState }[];
  withdrawals: { id: string; amount: number; method: string; details: string | null; status: string; date: string; note: string | null; proofUrl: string | null }[];
}

@Injectable()
export class AffiliatesService {
  constructor(private readonly prisma: PrismaService) {}

  /* ───────────── mercado ───────────── */
  async market(schema: string): Promise<{ productCode: string; percent: number }[]> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ code: string; pct: unknown }[]>(Prisma.sql`
        SELECT code, affiliate_percent AS pct FROM products
        WHERE is_active = TRUE AND affiliate_percent IS NOT NULL AND affiliate_percent > 0`),
    );
    return rows.map((r) => ({ productCode: r.code, percent: num(r.pct) }));
  }

  /* ───────────── código pessoal ───────────── */
  private async customerId(tx: Prisma.TransactionClient, email: string): Promise<string> {
    const r = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM customers WHERE lower(email) = ${email.toLowerCase()} LIMIT 1`);
    if (!r[0]) throw new NotFoundException('Cliente não encontrado.');
    return r[0].id;
  }

  async ensureCode(schema: string, email: string): Promise<string> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const id = await this.customerId(tx, email);
      const cur = await tx.$queryRaw<{ c: string | null }[]>(Prisma.sql`SELECT affiliate_code AS c FROM customers WHERE id = ${id}::uuid`);
      if (cur[0]?.c) return cur[0].c;
      for (let i = 0; i < 8; i++) {
        const code = genCode();
        const n = await tx.$executeRaw(Prisma.sql`
          UPDATE customers SET affiliate_code = ${code}
          WHERE id = ${id}::uuid AND affiliate_code IS NULL
            AND NOT EXISTS (SELECT 1 FROM customers WHERE affiliate_code = ${code})`);
        if (n) return code;
      }
      throw new BadRequestException('Não foi possível gerar o código. Tente de novo.');
    });
  }

  /* ───────────── atribuição no checkout (último clique) ───────────── */
  async attribute(schema: string, orderId: string, rawCode: string | undefined, buyerEmail: string | null): Promise<void> {
    const code = (rawCode ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return;
    await this.prisma.runInTenant(schema, async (tx) => {
      const aff = await tx.$queryRaw<{ id: string; email: string; s: string }[]>(Prisma.sql`
        SELECT id, email, member_status AS s FROM customers WHERE affiliate_code = ${code} LIMIT 1`);
      const a = aff[0];
      // Só associados aprovados ganham; ninguém ganha comissão das próprias compras.
      if (!a || a.s !== 'APPROVED') return;
      if (buyerEmail && a.email.toLowerCase() === buyerEmail.toLowerCase()) return;
      await tx.$executeRaw(Prisma.sql`UPDATE web_orders SET affiliate_customer_id = ${a.id}::uuid, affiliate_code = ${code} WHERE id = ${orderId}::uuid AND affiliate_customer_id IS NULL`);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO affiliate_commissions (order_id, customer_id, product_id, quantity, base_amount, percent, amount)
        SELECT wi.order_id, ${a.id}::uuid, wi.product_id, wi.quantity, wi.gross_amount, p.affiliate_percent,
               ROUND(wi.gross_amount * p.affiliate_percent / 100, 2)
        FROM web_order_items wi JOIN products p ON p.id = wi.product_id
        WHERE wi.order_id = ${orderId}::uuid AND p.affiliate_percent IS NOT NULL AND p.affiliate_percent > 0
        ON CONFLICT (order_id, product_id) DO NOTHING`);
    });
  }

  /* ───────────── painel do associado ───────────── */
  async summary(schema: string, email: string): Promise<AffiliateSummary> {
    const code = await this.ensureCode(schema, email);
    return this.prisma.runInTenant(schema, async (tx) => {
      const id = await this.customerId(tx, email);
      const sales = await tx.$queryRaw<{ n: string; d: Date; prod: string; q: unknown; amt: unknown; st: string }[]>(Prisma.sql`
        SELECT wo.order_number AS n, ac.created_at AS d, COALESCE(p.name, '—') AS prod, ac.quantity AS q, ac.amount AS amt, wo.status AS st
        FROM affiliate_commissions ac JOIN web_orders wo ON wo.id = ac.order_id LEFT JOIN products p ON p.id = ac.product_id
        WHERE ac.customer_id = ${id}::uuid ORDER BY ac.created_at DESC LIMIT 300`);
      const wd = await tx.$queryRaw<{ id: string; amt: unknown; m: string; det: string | null; s: string; d: Date; note: string | null; proof: string | null }[]>(Prisma.sql`
        SELECT id, amount AS amt, method AS m, details AS det, status AS s, created_at AS d, note, proof_url AS proof FROM affiliate_withdrawals
        WHERE customer_id = ${id}::uuid ORDER BY created_at DESC LIMIT 100`);
      let pending = 0; let available = 0;
      const list = sales.map((s) => {
        const state = stateOf(s.st);
        if (state === 'PENDING') pending += num(s.amt);
        if (state === 'AVAILABLE') available += num(s.amt);
        return { orderNumber: s.n, date: s.d.toISOString(), product: s.prod, quantity: num(s.q), amount: num(s.amt), state };
      });
      const withdrawn = wd.filter((w) => w.s === 'PAID').reduce((t, w) => t + num(w.amt), 0);
      const requested = wd.filter((w) => w.s === 'REQUESTED').reduce((t, w) => t + num(w.amt), 0);
      return {
        code, pending: round2(pending), available: round2(available), withdrawn: round2(withdrawn), requested: round2(requested),
        balance: round2(Math.max(0, available - withdrawn - requested)),
        sales: list,
        withdrawals: wd.map((w) => ({ id: w.id, amount: num(w.amt), method: w.m, details: w.det, status: w.s, date: w.d.toISOString(), note: w.note, proofUrl: w.proof })),
      };
    });
  }

  async requestWithdrawal(schema: string, email: string, amount: number, method: string, details: string): Promise<{ ok: true }> {
    const a = round2(amount);
    if (!(a > 0)) throw new BadRequestException('Indique o valor do saque.');
    const s = await this.summary(schema, email);
    if (a > s.balance) throw new BadRequestException('O valor é maior do que o saldo disponível.');
    await this.prisma.runInTenant(schema, async (tx) => {
      const id = await this.customerId(tx, email);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO affiliate_withdrawals (customer_id, amount, method, details, status)
        VALUES (${id}::uuid, ${a}, ${method.trim().slice(0, 40)}, ${details.trim().slice(0, 300)}, 'REQUESTED')`);
    });
    return { ok: true };
  }

  /* ───────────── gestão (painel) ───────────── */
  async products(schema: string, q?: string): Promise<{ code: string; name: string; percent: number | null }[]> {
    const term = `%${(q ?? '').trim().toLowerCase()}%`;
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ code: string; name: string; pct: unknown }[]>(Prisma.sql`
        SELECT code, name, affiliate_percent AS pct FROM products
        WHERE is_active = TRUE AND (lower(name) LIKE ${term} OR lower(code) LIKE ${term})
        ORDER BY (affiliate_percent IS NULL), name LIMIT 60`),
    );
    return rows.map((r) => ({ code: r.code, name: r.name, percent: r.pct == null ? null : num(r.pct) }));
  }

  async setPercent(schema: string, productCode: string, percent: number | null): Promise<{ ok: true }> {
    const p = percent == null || percent <= 0 ? null : Math.min(90, round2(percent));
    const n = await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE products SET affiliate_percent = ${p} WHERE code = ${productCode}`));
    if (!n) throw new NotFoundException('Produto não encontrado.');
    return { ok: true };
  }

  async associates(schema: string) {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ id: string; name: string; code: string | null; sales: bigint; pending: unknown; available: unknown; paid: unknown; requested: unknown }[]>(Prisma.sql`
        SELECT c.id, c.name, c.affiliate_code AS code,
          (SELECT COUNT(DISTINCT ac.order_id) FROM affiliate_commissions ac WHERE ac.customer_id = c.id) AS sales,
          (SELECT COALESCE(SUM(ac.amount),0) FROM affiliate_commissions ac JOIN web_orders wo ON wo.id = ac.order_id WHERE ac.customer_id = c.id AND wo.status NOT IN ('PAID','SHIPPED','DELIVERED','CANCELLED')) AS pending,
          (SELECT COALESCE(SUM(ac.amount),0) FROM affiliate_commissions ac JOIN web_orders wo ON wo.id = ac.order_id WHERE ac.customer_id = c.id AND wo.status IN ('PAID','SHIPPED','DELIVERED')) AS available,
          (SELECT COALESCE(SUM(w.amount),0) FROM affiliate_withdrawals w WHERE w.customer_id = c.id AND w.status = 'PAID') AS paid,
          (SELECT COALESCE(SUM(w.amount),0) FROM affiliate_withdrawals w WHERE w.customer_id = c.id AND w.status = 'REQUESTED') AS requested
        FROM customers c WHERE c.affiliate_code IS NOT NULL ORDER BY c.name LIMIT 500`),
    );
    return rows.map((r) => ({ id: r.id, name: r.name, code: r.code, sales: Number(r.sales), pending: num(r.pending), available: num(r.available), paid: num(r.paid), requested: num(r.requested) }));
  }

  async withdrawals(schema: string) {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ id: string; name: string; amt: unknown; m: string; det: string | null; s: string; d: Date; note: string | null }[]>(Prisma.sql`
        SELECT w.id, c.name, w.amount AS amt, w.method AS m, w.details AS det, w.status AS s, w.created_at AS d, w.note
        FROM affiliate_withdrawals w JOIN customers c ON c.id = w.customer_id
        ORDER BY (w.status = 'REQUESTED') DESC, w.created_at DESC LIMIT 300`),
    );
    return rows.map((r) => ({ id: r.id, name: r.name, amount: num(r.amt), method: r.m, details: r.det, status: r.s, date: r.d.toISOString(), note: r.note }));
  }

  async decideWithdrawal(schema: string, id: string, paid: boolean, note?: string, proofUrl?: string): Promise<{ ok: true }> {
    const n = await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`
        UPDATE affiliate_withdrawals SET status = ${paid ? 'PAID' : 'REJECTED'}, note = ${(note ?? '').trim().slice(0, 300) || null}, proof_url = ${paid ? (proofUrl || null) : null}, decided_at = now()
        WHERE id = ${id}::uuid AND status = 'REQUESTED'`));
    if (!n) throw new NotFoundException('Pedido de saque não encontrado ou já decidido.');
    return { ok: true };
  }

  /* ───────────── contas para receber os saques (até 3) ───────────── */
  async listAccounts(schema: string, email: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const id = await this.customerId(tx, email);
      const rows = await tx.$queryRaw<{ id: string; method: string; bank: string | null; holder: string; details: string; d: Date }[]>(Prisma.sql`
        SELECT id, method, bank, holder, details, created_at AS d FROM affiliate_payout_accounts WHERE customer_id = ${id}::uuid ORDER BY created_at`);
      return rows.map((r) => ({ id: r.id, method: r.method, bank: r.bank, holder: r.holder, details: r.details, createdAt: r.d.toISOString() }));
    });
  }

  async addAccount(schema: string, email: string, a: { method: string; bank?: string; holder: string; details: string }) {
    const method = a.method.trim().slice(0, 40);
    const holder = a.holder.trim().slice(0, 120);
    const details = a.details.trim().slice(0, 60);
    if (!method || holder.length < 3 || details.length < 6) throw new BadRequestException('Preencha o titular e o número da conta.');
    return this.prisma.runInTenant(schema, async (tx) => {
      const id = await this.customerId(tx, email);
      const n = await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS n FROM affiliate_payout_accounts WHERE customer_id = ${id}::uuid`);
      if (Number(n[0]?.n ?? 0) >= 3) throw new BadRequestException('Pode ter no máximo 3 contas.');
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO affiliate_payout_accounts (customer_id, method, bank, holder, details)
        VALUES (${id}::uuid, ${method}, ${(a.bank ?? '').trim().slice(0, 60) || null}, ${holder}, ${details})`);
      return { ok: true as const };
    });
  }

  async removeAccount(schema: string, email: string, accountId: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const id = await this.customerId(tx, email);
      const n = await tx.$executeRaw(Prisma.sql`DELETE FROM affiliate_payout_accounts WHERE id = ${accountId}::uuid AND customer_id = ${id}::uuid`);
      if (!n) throw new NotFoundException('Conta não encontrada.');
      return { ok: true as const };
    });
  }

  /** Saque para uma conta guardada (os dados ficam copiados no pedido). */
  async withdrawToAccount(schema: string, email: string, amount: number, accountId: string): Promise<{ ok: true }> {
    const acc = (await this.listAccounts(schema, email)).find((x) => x.id === accountId);
    if (!acc) throw new BadRequestException('Escolha uma conta para receber.');
    const label = acc.method === 'Multicaixa Express' ? acc.method : `${acc.method}${acc.bank ? ` · ${acc.bank}` : ''}`;
    return this.requestWithdrawal(schema, email, amount, label, `${acc.details} · ${acc.holder}`);
  }
}

