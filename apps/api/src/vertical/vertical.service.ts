import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface VerticalKpi { label: string; value: string; hint?: string; tone?: 'ok' | 'warn' | 'info' }
export interface VerticalMetrics { businessType: string; title: string; kpis: VerticalKpi[] }

const KZ = (n: number) => new Intl.NumberFormat('pt-PT').format(Math.round(n)) + ' Kz';
const pct = (n: number) => `${Math.round(n)}%`;

/**
 * Métricas/relatório adaptados ao VERTICAL da empresa (Hotelaria, Serviços,
 * Restauração). Lê as tabelas próprias do schema do tenant. Para Retalho não há
 * KPIs próprios — usa os relatórios de vendas normais.
 */
@Injectable()
export class VerticalService {
  constructor(private readonly prisma: PrismaService) {}

  async metrics(schema: string, businessType: string): Promise<VerticalMetrics> {
    if (businessType === 'HOSPITALITY') return this.hospitality(schema);
    if (businessType === 'SERVICES') return this.services(schema);
    if (businessType === 'RESTAURANT') return this.restaurant(schema);
    return { businessType, title: 'Resumo', kpis: [] };
  }

  private async hospitality(schema: string): Promise<VerticalMetrics> {
    const r = await this.prisma.runInTenant(schema, async (tx) => {
      const rooms = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM hotel_rooms WHERE is_active = TRUE`);
      const occupied = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM hotel_reservations WHERE status = 'CHECKED_IN'`);
      const booked = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM hotel_reservations WHERE status = 'BOOKED'`);
      const onlinePending = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM hotel_reservations WHERE status = 'BOOKED' AND source = 'ONLINE'`);
      const arrivals = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM hotel_reservations WHERE check_in = CURRENT_DATE AND status IN ('BOOKED','CHECKED_IN')`);
      const rev = await tx.$queryRaw<{ s: number }[]>(Prisma.sql`SELECT COALESCE(SUM(total),0)::float8 AS s FROM hotel_reservations WHERE status = 'CHECKED_OUT' AND updated_at >= now() - interval '30 days'`);
      return { rooms: rooms[0]?.n ?? 0, occupied: occupied[0]?.n ?? 0, booked: booked[0]?.n ?? 0, onlinePending: onlinePending[0]?.n ?? 0, arrivals: arrivals[0]?.n ?? 0, rev: rev[0]?.s ?? 0 };
    });
    const occRate = r.rooms > 0 ? (r.occupied / r.rooms) * 100 : 0;
    return {
      businessType: 'HOSPITALITY', title: '🏨 Hotelaria — resumo',
      kpis: [
        { label: 'Ocupação agora', value: pct(occRate), hint: `${r.occupied}/${r.rooms} quartos`, tone: occRate >= 80 ? 'warn' : 'ok' },
        { label: 'Hóspedes alojados', value: String(r.occupied), hint: 'check-in feito' },
        { label: 'Reservas por confirmar', value: String(r.booked), hint: r.onlinePending ? `${r.onlinePending} da loja online` : 'balcão', tone: r.booked ? 'info' : undefined },
        { label: 'Entradas hoje', value: String(r.arrivals), hint: 'check-ins previstos' },
        { label: 'Receita (30 dias)', value: KZ(r.rev), hint: 'estadias concluídas' },
      ],
    };
  }

  private async services(schema: string): Promise<VerticalMetrics> {
    const r = await this.prisma.runInTenant(schema, async (tx) => {
      const open = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM service_orders WHERE status = 'OPEN'`);
      const inProg = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM service_orders WHERE status IN ('QUOTED','APPROVED','IN_PROGRESS')`);
      const ready = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM service_orders WHERE status = 'READY'`);
      const onlinePending = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM service_orders WHERE status = 'OPEN' AND source = 'ONLINE'`);
      const rev = await tx.$queryRaw<{ s: number }[]>(Prisma.sql`SELECT COALESCE(SUM(total),0)::float8 AS s FROM service_orders WHERE status = 'DELIVERED' AND updated_at >= now() - interval '30 days'`);
      return { open: open[0]?.n ?? 0, inProg: inProg[0]?.n ?? 0, ready: ready[0]?.n ?? 0, onlinePending: onlinePending[0]?.n ?? 0, rev: rev[0]?.s ?? 0 };
    });
    return {
      businessType: 'SERVICES', title: '🔧 Serviços — resumo',
      kpis: [
        { label: 'OS abertas', value: String(r.open), hint: r.onlinePending ? `${r.onlinePending} da loja online` : 'por diagnosticar', tone: r.open ? 'info' : undefined },
        { label: 'Em curso', value: String(r.inProg), hint: 'orçamento/execução' },
        { label: 'Prontas a entregar', value: String(r.ready), hint: 'aguardam cliente', tone: r.ready ? 'warn' : undefined },
        { label: 'Receita (30 dias)', value: KZ(r.rev), hint: 'OS entregues' },
      ],
    };
  }

  private async restaurant(schema: string): Promise<VerticalMetrics> {
    const r = await this.prisma.runInTenant(schema, async (tx) => {
      const openTables = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM restaurant_orders WHERE status = 'OPEN'`);
      const openTotal = await tx.$queryRaw<{ s: number }[]>(Prisma.sql`SELECT COALESCE(SUM(total),0)::float8 AS s FROM restaurant_orders WHERE status = 'OPEN'`);
      // `restaurant_orders` não tem `updated_at` (só created_at/closed_at) — usar
      // closed_at (preenchido no fecho da comanda) senão dá 42703 "column updated_at".
      const todayN = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM restaurant_orders WHERE status = 'CLOSED' AND closed_at::date = CURRENT_DATE`);
      const todayRev = await tx.$queryRaw<{ s: number }[]>(Prisma.sql`SELECT COALESCE(SUM(total),0)::float8 AS s FROM restaurant_orders WHERE status = 'CLOSED' AND closed_at::date = CURRENT_DATE`);
      return { openTables: openTables[0]?.n ?? 0, openTotal: openTotal[0]?.s ?? 0, todayN: todayN[0]?.n ?? 0, todayRev: todayRev[0]?.s ?? 0 };
    });
    return {
      businessType: 'RESTAURANT', title: '🍔 Restauração — resumo',
      kpis: [
        { label: 'Mesas abertas', value: String(r.openTables), hint: 'comandas a decorrer', tone: r.openTables ? 'info' : undefined },
        { label: 'Em aberto (mesas)', value: KZ(r.openTotal), hint: 'por fechar' },
        { label: 'Contas hoje', value: String(r.todayN), hint: 'comandas fechadas' },
        { label: 'Receita hoje', value: KZ(r.todayRev), hint: 'mesas fechadas' },
      ],
    };
  }
}
