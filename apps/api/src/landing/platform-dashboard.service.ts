import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PlatformKpis {
  companies: { total: number; pending: number; active: number; suspended: number; newToday: number; new7d: number };
  subscriptions: { total: number; active: number; inReview: number; pendingPayment: number };
  revenue: { activeMonthlyKz: number; collectedKz: number; pendingKz: number };
  plans: { tier: string; name: string; companies: number; priceKz: number }[];
}

export interface PlatformSeriesPoint { day: string; companies: number; subscriptions: number }

/**
 * Dashboard GLOBAL da plataforma (Super Admin). Agrega dados do schema público
 * (nexus_public): empresas, subscrições e receita — em tempo real. Não usa
 * runInTenant (os dados são globais, não de um tenant).
 */
@Injectable()
export class PlatformDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async kpis(): Promise<PlatformKpis> {
    const [
      total, pending, active, suspended, newToday, new7d,
      subsTotal, subsActive, subsReview, subsPending,
      revenueRows, collectedRow, pendingRow, planRows,
    ] = await Promise.all([
      this.prisma.company.count(),
      this.prisma.company.count({ where: { status: 'PENDING' } }),
      this.prisma.company.count({ where: { status: 'ACTIVE' } }),
      this.prisma.company.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.company.count({ where: { createdAt: { gte: startOfToday() } } }),
      this.prisma.company.count({ where: { createdAt: { gte: daysAgo(7) } } }),
      this.prisma.subscription.count(),
      this.prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.subscription.count({ where: { status: 'IN_REVIEW' } }),
      this.prisma.subscription.count({ where: { status: 'PENDING_PAYMENT' } }),
      // Receita mensal recorrente = soma dos amountKz das subscrições ACTIVE.
      this.prisma.subscription.aggregate({ _sum: { amountKz: true }, where: { status: 'ACTIVE' } }),
      // Cobrado = soma de todos os comprovativos de subscrições ACTIVE.
      this.prisma.subscription.aggregate({ _sum: { amountKz: true }, where: { status: 'ACTIVE' } }),
      // Pendente = subscrições à espera de pagamento/revisão.
      this.prisma.subscription.aggregate({
        _sum: { amountKz: true },
        where: { status: { in: ['PENDING_PAYMENT', 'IN_REVIEW'] } },
      }),
      this.prisma.plan.findMany({
        orderBy: { sortOrder: 'asc' },
        include: { _count: { select: { companies: true } } },
      }),
    ]);

    return {
      companies: { total, pending, active, suspended, newToday, new7d },
      subscriptions: { total: subsTotal, active: subsActive, inReview: subsReview, pendingPayment: subsPending },
      revenue: {
        activeMonthlyKz: revenueRows._sum.amountKz ?? 0,
        collectedKz: collectedRow._sum.amountKz ?? 0,
        pendingKz: pendingRow._sum.amountKz ?? 0,
      },
      plans: planRows.map((p) => ({
        tier: p.tier,
        name: p.name,
        companies: p._count.companies,
        priceKz: p.priceKz,
      })),
    };
  }

  /** Série diária dos últimos N dias: novas empresas + novas subscrições. */
  async series(days = 14): Promise<PlatformSeriesPoint[]> {
    const span = Math.min(Math.max(days, 1), 90);
    const since = daysAgo(span - 1);
    const [companies, subs] = await Promise.all([
      this.prisma.company.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      this.prisma.subscription.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    ]);

    const map = new Map<string, PlatformSeriesPoint>();
    for (let i = 0; i < span; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      map.set(key, { day: key, companies: 0, subscriptions: 0 });
    }
    for (const c of companies) {
      const k = c.createdAt.toISOString().slice(0, 10);
      const p = map.get(k);
      if (p) p.companies += 1;
    }
    for (const s of subs) {
      const k = s.createdAt.toISOString().slice(0, 10);
      const p = map.get(k);
      if (p) p.subscriptions += 1;
    }
    return [...map.values()];
  }

  /** Empresas mais recentes (para a lista "atividade recente"). */
  recentCompanies(limit = 8) {
    return this.prisma.company.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
      select: { id: true, name: true, code: true, status: true, createdAt: true, plan: { select: { name: true } } },
    });
  }
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function daysAgo(n: number): Date {
  const d = startOfToday();
  d.setDate(d.getDate() - n);
  return d;
}
