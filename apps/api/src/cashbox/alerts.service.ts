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

      return alerts;
    });
  }
}
