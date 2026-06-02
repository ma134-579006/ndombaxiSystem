import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface Alert {
  level: 'info' | 'warning' | 'danger';
  category: 'STOCK' | 'CASH' | 'SALES';
  title: string;
  detail: string;
}

/**
 * Centro de alertas do gestor: reúne sinais que exigem atenção —
 * stock abaixo do mínimo, quebras de caixa recentes e turnos por fechar.
 * Tudo em leitura (não altera dados).
 */
@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(schema: string): Promise<Alert[]> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const alerts: Alert[] = [];

      // 1. Stock abaixo do mínimo (por armazém).
      const low = await tx.$queryRaw<{ name: string; quantity: string; min_qty: string }[]>(
        Prisma.sql`SELECT p.name, si.quantity, si.min_qty
                   FROM stock_items si JOIN products p ON p.id = si.product_id
                   WHERE si.min_qty > 0 AND si.quantity <= si.min_qty
                   ORDER BY (si.quantity - si.min_qty) ASC LIMIT 50`,
      );
      for (const r of low) {
        alerts.push({
          level: Number(r.quantity) <= 0 ? 'danger' : 'warning',
          category: 'STOCK',
          title: Number(r.quantity) <= 0 ? `Esgotado: ${r.name}` : `Stock baixo: ${r.name}`,
          detail: `${Number(r.quantity)} em stock (mínimo ${Number(r.min_qty)})`,
        });
      }

      // 2. Quebras de caixa nos últimos 7 dias.
      const breaks = await tx.$queryRaw<{ opened_by_name: string | null; difference: string; closed_at: Date }[]>(
        Prisma.sql`SELECT opened_by_name, difference, closed_at FROM cash_sessions
                   WHERE status = 'CLOSED' AND difference <> 0 AND closed_at >= now() - interval '7 days'
                   ORDER BY closed_at DESC LIMIT 20`,
      );
      for (const b of breaks) {
        const d = Number(b.difference);
        alerts.push({
          level: d < 0 ? 'danger' : 'info',
          category: 'CASH',
          title: d < 0 ? `Quebra de caixa: ${b.opened_by_name ?? '—'}` : `Sobra de caixa: ${b.opened_by_name ?? '—'}`,
          detail: `${d.toLocaleString('pt-PT')} Kz · ${new Date(b.closed_at).toLocaleDateString('pt-PT')}`,
        });
      }

      // 3. Turnos abertos há mais de 16h (provavelmente esquecidos por fechar).
      const stale = await tx.$queryRaw<{ opened_by_name: string | null; opened_at: Date }[]>(
        Prisma.sql`SELECT opened_by_name, opened_at FROM cash_sessions
                   WHERE status = 'OPEN' AND opened_at < now() - interval '16 hours' LIMIT 20`,
      );
      for (const s of stale) {
        alerts.push({
          level: 'warning',
          category: 'CASH',
          title: `Turno por fechar: ${s.opened_by_name ?? '—'}`,
          detail: `Aberto desde ${new Date(s.opened_at).toLocaleString('pt-PT')}`,
        });
      }

      // ── Monitor de anomalias (OpenManus) ──────────────────────
      const reg = async (name: string) => {
        const r = await tx.$queryRaw<{ reg: string | null }[]>(Prisma.sql`SELECT to_regclass(${name})::text AS reg`);
        return !!r[0]?.reg;
      };

      // 4. Cancelamentos em excesso por operador (≥3 em 7 dias) — via auditoria.
      if (await reg('tenant_audit_log')) {
        const canc = await tx.$queryRaw<{ actor_name: string | null; n: number }[]>(
          Prisma.sql`SELECT actor_name, COUNT(*)::int AS n FROM tenant_audit_log
                     WHERE action = 'SALE_CANCELLED' AND timestamp >= now() - interval '7 days'
                     GROUP BY actor_name HAVING COUNT(*) >= 3 ORDER BY n DESC LIMIT 10`,
        );
        for (const c of canc) {
          alerts.push({
            level: 'danger', category: 'SALES',
            title: `Muitos cancelamentos: ${c.actor_name ?? '—'}`,
            detail: `${c.n} vendas anuladas nos últimos 7 dias — rever`,
          });
        }
      }

      // 5. Descontos elevados (≥30%) nos últimos 7 dias.
      const disc = await tx.$queryRaw<{ n: number; maxr: string }[]>(
        Prisma.sql`SELECT COUNT(*)::int AS n, COALESCE(MAX(ii.discount_rate),0) AS maxr
                   FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
                   WHERE i.status <> 'A' AND i.system_entry_date >= now() - interval '7 days'
                     AND ii.discount_rate >= 0.30`,
      );
      if (Number(disc[0]?.n ?? 0) > 0) {
        alerts.push({
          level: 'warning', category: 'SALES', title: 'Descontos elevados',
          detail: `${disc[0].n} linha(s) com desconto ≥ 30% (máx ${Math.round(Number(disc[0].maxr) * 100)}%) em 7 dias`,
        });
      }

      // 6. Venda abaixo do custo (margem negativa), 30 dias — exige coluna unit_cost.
      const hasCost = await tx.$queryRaw<{ ok: number }[]>(
        Prisma.sql`SELECT 1 AS ok FROM information_schema.columns
                   WHERE table_schema = current_schema() AND table_name = 'invoice_items'
                     AND column_name = 'unit_cost' LIMIT 1`,
      );
      if (hasCost.length > 0) {
        const below = await tx.$queryRaw<{ description: string; n: number }[]>(
          Prisma.sql`SELECT MAX(ii.description) AS description, COUNT(*)::int AS n
                     FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
                     WHERE i.status <> 'A' AND i.system_entry_date >= now() - interval '30 days'
                       AND ii.unit_cost > 0 AND (ii.unit_price * (1 - COALESCE(ii.discount_rate,0))) < ii.unit_cost
                     GROUP BY ii.product_code ORDER BY n DESC LIMIT 10`,
        );
        for (const b of below) {
          alerts.push({
            level: 'danger', category: 'SALES',
            title: `Venda abaixo do custo: ${b.description}`,
            detail: `${b.n} venda(s) em 30 dias com preço abaixo do custo`,
          });
        }
      }

      // 7. Produtos parados (com stock mas sem vendas há 30 dias).
      const stalled = await tx.$queryRaw<{ n: number }[]>(
        Prisma.sql`SELECT COUNT(*)::int AS n FROM products p
                   WHERE p.is_active = TRUE AND p.stock_qty > 0
                     AND NOT EXISTS (
                       SELECT 1 FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
                       WHERE ii.product_code = p.code AND i.status <> 'A'
                         AND i.system_entry_date >= now() - interval '30 days')`,
      );
      if (Number(stalled[0]?.n ?? 0) > 0) {
        alerts.push({
          level: 'info', category: 'STOCK', title: 'Produtos parados',
          detail: `${stalled[0].n} produto(s) com stock sem vendas há 30 dias`,
        });
      }

      return alerts;
    });
  }
}
