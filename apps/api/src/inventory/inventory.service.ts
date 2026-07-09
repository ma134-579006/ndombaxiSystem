import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAuditService } from '../cashbox/tenant-audit.service';
import { StockService } from '../erp/stock.service';

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface FraudSignal {
  type: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  detail: string;
  who?: string | null;
  count: number;
}

/**
 * Inventário EMPRESARIAL — análises e controlo interno por cima do livro de
 * stock já existente (stock_items + stock_movements append-only) e da
 * auditoria por tenant (tenant_audit_log com hash encadeado). Tudo ADITIVO:
 * nenhum fluxo de venda/stock existente é alterado.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: TenantAuditService,
  ) {}

  // ── Curva ABC ────────────────────────────────────────────────
  /**
   * Classificação ABC por VALOR de venda no período (A = 80% do valor,
   * B = 80–95%, C = resto) + rotatividade (unidades vendidas / stock actual).
   * Vendas líquidas de devoluções (NC descontadas).
   */
  async abc(
    schema: string,
    f: { from?: string; to?: string; storeId?: string } = {},
  ): Promise<{ rows: Array<Record<string, unknown>>; summary: Record<string, unknown>; period: { from: string; to: string } }> {
    const to = isDate(f.to) ? f.to! : new Date().toISOString().slice(0, 10);
    const from = isDate(f.from) ? f.from! : new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const storeCond = f.storeId ? Prisma.sql` AND i.store_id = ${f.storeId}::uuid` : Prisma.empty;
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string; code: string; name: string; category: string | null;
        stock_qty: string; cost_price: string; unit_price: string;
        net: string | null; units: string | null; nc_net: string | null; nc_units: string | null;
      }>>(
        Prisma.sql`
          SELECT p.id, p.code, p.name, c.name AS category,
                 p.stock_qty, p.cost_price, p.unit_price,
                 s.net, s.units, n.net AS nc_net, n.units AS nc_units
          FROM products p
          LEFT JOIN product_categories c ON c.id = p.category_id
          LEFT JOIN LATERAL (
            SELECT SUM(ii.net_amount) AS net, SUM(ii.quantity) AS units
            FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
            WHERE ii.product_id = p.id AND i.doc_type IN ('FT','FS') AND i.status <> 'A'
              AND i.system_entry_date >= ${from}::date AND i.system_entry_date < (${to}::date + 1)
              ${storeCond}
          ) s ON TRUE
          LEFT JOIN LATERAL (
            SELECT SUM(ii.net_amount) AS net, SUM(ii.quantity) AS units
            FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
            WHERE ii.product_id = p.id AND i.doc_type = 'NC'
              AND i.system_entry_date >= ${from}::date AND i.system_entry_date < (${to}::date + 1)
              ${storeCond}
          ) n ON TRUE
          WHERE p.is_active = TRUE`,
      );
      const enriched = rows.map((r) => {
        const value = Math.max(0, round2((Number(r.net) || 0) - (Number(r.nc_net) || 0)));
        const units = Math.max(0, round3((Number(r.units) || 0) - (Number(r.nc_units) || 0)));
        const stock = Number(r.stock_qty) || 0;
        return {
          productId: r.id, code: r.code, name: r.name, category: r.category,
          stockQty: stock, costPrice: Number(r.cost_price) || 0, unitPrice: Number(r.unit_price) || 0,
          salesValue: value, unitsSold: units,
          // Rotatividade no período: quantas vezes o stock actual "girou".
          rotation: stock > 0 ? round2(units / stock) : (units > 0 ? Infinity : 0),
        };
      }).sort((a, b) => b.salesValue - a.salesValue);
      const total = enriched.reduce((s, r) => s + r.salesValue, 0);
      let cum = 0;
      const withClass = enriched.map((r) => {
        cum += r.salesValue;
        const cumPct = total > 0 ? (cum / total) * 100 : 0;
        const cls = r.salesValue <= 0 ? 'C' : cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C';
        return {
          ...r,
          rotation: Number.isFinite(r.rotation) ? r.rotation : null,
          sharePct: total > 0 ? round2((r.salesValue / total) * 100) : 0,
          cumulativePct: round2(cumPct),
          abcClass: cls,
        };
      });
      const count = (c: string) => withClass.filter((r) => r.abcClass === c).length;
      const value = (c: string) => round2(withClass.filter((r) => r.abcClass === c).reduce((s, r) => s + r.salesValue, 0));
      return {
        rows: withClass,
        summary: {
          totalSales: round2(total), products: withClass.length,
          aCount: count('A'), bCount: count('B'), cCount: count('C'),
          aValue: value('A'), bValue: value('B'), cValue: value('C'),
        },
        period: { from, to },
      };
    });
  }

  // ── Previsão de reposição + sugestão automática de compra ────
  /**
   * Por produto/loja: consumo médio diário (histórico de saídas), dias de
   * stock restantes e QUANTIDADE SUGERIDA de compra para cobrir `coverage`
   * dias — sugere quando o stock está no mínimo ou acaba antes do lead time.
   */
  async replenishment(
    schema: string,
    f: { days?: number; coverage?: number; leadDays?: number; storeId?: string } = {},
  ): Promise<{ rows: Array<Record<string, unknown>>; params: Record<string, number> }> {
    const days = Math.min(Math.max(f.days ?? 30, 7), 365);
    const coverage = Math.min(Math.max(f.coverage ?? 30, 7), 180);
    const leadDays = Math.min(Math.max(f.leadDays ?? 7, 1), 60);
    const storeCond = f.storeId ? Prisma.sql` AND si.warehouse_id = ${f.storeId}::uuid` : Prisma.empty;
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        product_id: string; code: string; name: string; store_id: string; store_name: string;
        quantity: string; min_qty: string; location: string | null; cost_price: string; sold: string | null;
      }>>(
        Prisma.sql`
          SELECT si.product_id, p.code, p.name, w.id AS store_id, w.name AS store_name,
                 si.quantity, si.min_qty, si.location, p.cost_price, mv.sold
          FROM stock_items si
          JOIN products p ON p.id = si.product_id AND p.is_active = TRUE
          JOIN stores w ON w.id = si.warehouse_id
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(-m.quantity), 0) AS sold
            FROM stock_movements m
            WHERE m.product_id = si.product_id AND m.warehouse_id = si.warehouse_id
              AND m.type = 'OUT' AND m.created_at >= now() - make_interval(days => ${days}::int)
          ) mv ON TRUE
          WHERE TRUE ${storeCond}
          ORDER BY p.name, w.name`,
      );
      const out = rows.map((r) => {
        const qty = Number(r.quantity) || 0;
        const minQty = Number(r.min_qty) || 0;
        const sold = Math.max(0, Number(r.sold) || 0);
        const perDay = sold / days;
        const daysLeft = perDay > 0 ? Math.floor(qty / perDay) : null;
        // Alvo = consumo previsto para `coverage` dias + margem do stock mínimo.
        const target = perDay * coverage + minQty;
        const suggested = round3(Math.max(0, target - qty));
        const atMin = minQty > 0 && qty <= minQty;
        const runsOut = daysLeft != null && daysLeft <= leadDays;
        const shouldBuy = suggested > 0 && (atMin || runsOut);
        return {
          productId: r.product_id, code: r.code, name: r.name,
          storeId: r.store_id, storeName: r.store_name, location: r.location,
          quantity: qty, minQty, soldPeriod: sold, perDay: round3(perDay), daysLeft,
          suggestedQty: shouldBuy ? Math.ceil(suggested) : 0,
          suggestedCost: shouldBuy ? round2(Math.ceil(suggested) * (Number(r.cost_price) || 0)) : 0,
          reason: shouldBuy ? (atMin ? 'STOCK_MINIMO' : 'ACABA_ANTES_DO_LEAD') : null,
        };
      });
      return { rows: out, params: { days, coverage, leadDays } };
    });
  }

  // ── Valorização financeira do stock (FIFO / LIFO / CMP) ──────
  /**
   * Valoriza o stock actual pelos 3 métodos: CMP (custo médio ponderado — a
   * política do ERP), FIFO (o que resta são as ENTRADAS mais recentes) e LIFO
   * (o que resta são as mais antigas). Camadas reconstruídas do livro
   * `stock_movements` (entradas com custo); sem camadas suficientes, o
   * remanescente usa o CMP do produto.
   */
  async valuation(
    schema: string,
    f: { method?: 'FIFO' | 'LIFO' | 'CMP'; storeId?: string } = {},
  ): Promise<{ rows: Array<Record<string, unknown>>; totals: { FIFO: number; LIFO: number; CMP: number }; method: string }> {
    const method = f.method === 'FIFO' || f.method === 'LIFO' ? f.method : 'CMP';
    return this.prisma.runInTenant(schema, async (tx) => {
      const stock = f.storeId
        ? await tx.$queryRaw<Array<{ id: string; code: string; name: string; qty: string; cost_price: string }>>(
            Prisma.sql`SELECT p.id, p.code, p.name, si.quantity AS qty, p.cost_price
                       FROM stock_items si JOIN products p ON p.id = si.product_id
                       WHERE si.warehouse_id = ${f.storeId}::uuid AND si.quantity > 0 AND p.is_active = TRUE
                       ORDER BY p.name`,
          )
        : await tx.$queryRaw<Array<{ id: string; code: string; name: string; qty: string; cost_price: string }>>(
            Prisma.sql`SELECT p.id, p.code, p.name, p.stock_qty AS qty, p.cost_price
                       FROM products p WHERE p.stock_qty > 0 AND p.is_active = TRUE ORDER BY p.name`,
          );
      const ids = stock.map((s) => s.id);
      const layerCond = f.storeId ? Prisma.sql` AND m.warehouse_id = ${f.storeId}::uuid` : Prisma.empty;
      const layers = ids.length
        ? await tx.$queryRaw<Array<{ product_id: string; quantity: string; unit_cost: string }>>(
            Prisma.sql`SELECT m.product_id, m.quantity, m.unit_cost
                       FROM stock_movements m
                       WHERE m.type = 'IN' AND m.quantity > 0 AND m.unit_cost IS NOT NULL
                         AND m.product_id = ANY(ARRAY[${Prisma.join(ids)}]::uuid[])
                         ${layerCond}
                       ORDER BY m.created_at ASC`,
          )
        : [];
      const byProduct = new Map<string, { qty: number; cost: number }[]>();
      for (const l of layers) {
        const list = byProduct.get(l.product_id) ?? [];
        list.push({ qty: Number(l.quantity), cost: Number(l.unit_cost) });
        byProduct.set(l.product_id, list);
      }
      // Aloca o stock actual às camadas: FIFO → consome-se primeiro o antigo,
      // logo o que RESTA são as camadas do fim; LIFO → o que resta é do início.
      const allocate = (list: { qty: number; cost: number }[], qty: number, mode: 'FIFO' | 'LIFO', fallback: number) => {
        let remaining = qty;
        let value = 0;
        const ordered = mode === 'FIFO' ? [...list].reverse() : list;
        for (const layer of ordered) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, layer.qty);
          value += take * layer.cost;
          remaining -= take;
        }
        if (remaining > 0) value += remaining * fallback; // sem histórico suficiente → CMP
        return round2(value);
      };
      const totals = { FIFO: 0, LIFO: 0, CMP: 0 };
      const rows = stock.map((s) => {
        const qty = Number(s.qty) || 0;
        const cmpCost = Number(s.cost_price) || 0;
        const list = byProduct.get(s.id) ?? [];
        const vFifo = allocate(list, qty, 'FIFO', cmpCost);
        const vLifo = allocate(list, qty, 'LIFO', cmpCost);
        const vCmp = round2(qty * cmpCost);
        totals.FIFO = round2(totals.FIFO + vFifo);
        totals.LIFO = round2(totals.LIFO + vLifo);
        totals.CMP = round2(totals.CMP + vCmp);
        const value = method === 'FIFO' ? vFifo : method === 'LIFO' ? vLifo : vCmp;
        return {
          productId: s.id, code: s.code, name: s.name, quantity: qty,
          value, unitValue: qty > 0 ? round2(value / qty) : 0,
          valueFIFO: vFifo, valueLIFO: vLifo, valueCMP: vCmp,
        };
      });
      return { rows, totals, method };
    });
  }

  // ── Motor antifraude ─────────────────────────────────────────
  /**
   * Heurísticas de CONTROLO INTERNO sobre o livro de stock e a auditoria:
   * ajustes frequentes, cancelamentos excessivos, quebras repetidas do mesmo
   * produto, transferências anormais, movimentos fora de horário e variações
   * fortes de custo. Sinais para investigação humana — não acusações.
   */
  async fraudSignals(schema: string, f: { days?: number } = {}): Promise<{ signals: FraudSignal[]; periodDays: number }> {
    const days = Math.min(Math.max(f.days ?? 30, 7), 180);
    return this.prisma.runInTenant(schema, async (tx) => {
      const signals: FraudSignal[] = [];
      // ${days}::int — o Prisma envia o número como bigint e make_interval(days=>…)
      // espera int4; sem o cast o Postgres não resolve a função (400 DatabaseError).
      const cutoff = Prisma.sql`now() - make_interval(days => ${days}::int)`;

      // 1. Ajustes de inventário frequentes pelo MESMO utilizador.
      const adj = await tx.$queryRaw<Array<{ who: string; n: number }>>(
        Prisma.sql`SELECT COALESCE(u.name, 'Desconhecido') AS who, COUNT(*)::int AS n
                   FROM stock_movements m LEFT JOIN users u ON u.id = m.created_by
                   WHERE m.type = 'ADJUST' AND m.created_at >= ${cutoff}
                   GROUP BY 1 HAVING COUNT(*) >= 5 ORDER BY n DESC LIMIT 20`,
      );
      for (const r of adj) signals.push({
        type: 'AJUSTES_FREQUENTES', severity: r.n >= 15 ? 'HIGH' : 'MEDIUM',
        title: 'Ajustes de inventário frequentes',
        detail: `${r.who} fez ${r.n} ajustes de inventário nos últimos ${days} dias.`,
        who: r.who, count: r.n,
      });

      // 2. Cancelamentos/devoluções excessivos pelo MESMO funcionário.
      const canc = await tx.$queryRaw<Array<{ who: string; n: number }>>(
        Prisma.sql`SELECT COALESCE(actor_name, 'Desconhecido') AS who, COUNT(*)::int AS n
                   FROM tenant_audit_log
                   WHERE action IN ('SALE_CANCELLED','SALE_RETURNED') AND timestamp >= ${cutoff}
                   GROUP BY 1 HAVING COUNT(*) >= 5 ORDER BY n DESC LIMIT 20`,
      );
      for (const r of canc) signals.push({
        type: 'CANCELAMENTOS_EXCESSIVOS', severity: r.n >= 15 ? 'HIGH' : 'MEDIUM',
        title: 'Cancelamentos de venda excessivos',
        detail: `${r.who} cancelou/devolveu ${r.n} vendas nos últimos ${days} dias.`,
        who: r.who, count: r.n,
      });

      // 3. Quebras repetidas (ajustes NEGATIVOS) no mesmo produto.
      const shrink = await tx.$queryRaw<Array<{ what: string; n: number; delta: number }>>(
        Prisma.sql`SELECT p.name AS what, COUNT(*)::int AS n, SUM(m.quantity)::float AS delta
                   FROM stock_movements m JOIN products p ON p.id = m.product_id
                   WHERE m.type = 'ADJUST' AND m.quantity < 0 AND m.created_at >= ${cutoff}
                   GROUP BY p.name HAVING COUNT(*) >= 3 ORDER BY n DESC LIMIT 20`,
      );
      for (const r of shrink) signals.push({
        type: 'QUEBRAS_REPETIDAS', severity: 'HIGH',
        title: 'Diferenças de inventário repetidas',
        detail: `"${r.what}" teve ${r.n} acertos negativos (total ${r.delta}) nos últimos ${days} dias.`,
        count: r.n,
      });

      // 4. Transferências anormais entre lojas pelo mesmo utilizador.
      //    (cada transferência gera 2 movimentos TRANSFER — saída + entrada)
      const trans = await tx.$queryRaw<Array<{ who: string; n: number }>>(
        Prisma.sql`SELECT COALESCE(u.name, 'Desconhecido') AS who, (COUNT(*) / 2)::int AS n
                   FROM stock_movements m LEFT JOIN users u ON u.id = m.created_by
                   WHERE m.type = 'TRANSFER' AND m.created_at >= ${cutoff}
                   GROUP BY 1 HAVING COUNT(*) >= 20 ORDER BY n DESC LIMIT 20`,
      );
      for (const r of trans) signals.push({
        type: 'TRANSFERENCIAS_ANORMAIS', severity: 'MEDIUM',
        title: 'Volume anormal de transferências',
        detail: `${r.who} fez ~${r.n} transferências entre lojas nos últimos ${days} dias.`,
        who: r.who, count: r.n,
      });

      // 5. Movimentos de stock fora do horário normal (06h–22h de Luanda).
      const offHours = await tx.$queryRaw<Array<{ who: string; n: number }>>(
        Prisma.sql`SELECT COALESCE(u.name, 'Desconhecido') AS who, COUNT(*)::int AS n
                   FROM stock_movements m LEFT JOIN users u ON u.id = m.created_by
                   WHERE m.created_at >= ${cutoff}
                     AND (EXTRACT(HOUR FROM (m.created_at AT TIME ZONE 'Africa/Luanda')) < 6
                          OR EXTRACT(HOUR FROM (m.created_at AT TIME ZONE 'Africa/Luanda')) >= 22)
                   GROUP BY 1 HAVING COUNT(*) >= 3 ORDER BY n DESC LIMIT 20`,
      );
      for (const r of offHours) signals.push({
        type: 'FORA_DE_HORARIO', severity: 'MEDIUM',
        title: 'Movimentações fora do horário normal',
        detail: `${r.who} registou ${r.n} movimentos de stock entre as 22h e as 06h nos últimos ${days} dias.`,
        who: r.who, count: r.n,
      });

      // 6. Variações fortes e recorrentes do custo de entrada do mesmo produto.
      const cost = await tx.$queryRaw<Array<{ what: string; n: number; mn: number; mx: number }>>(
        Prisma.sql`SELECT p.name AS what, COUNT(*)::int AS n,
                          MIN(m.unit_cost)::float AS mn, MAX(m.unit_cost)::float AS mx
                   FROM stock_movements m JOIN products p ON p.id = m.product_id
                   WHERE m.type = 'IN' AND m.unit_cost > 0 AND m.created_at >= ${cutoff}
                   GROUP BY p.name
                   HAVING COUNT(*) >= 3 AND MAX(m.unit_cost) > MIN(m.unit_cost) * 1.5
                   ORDER BY (MAX(m.unit_cost) / NULLIF(MIN(m.unit_cost),0)) DESC LIMIT 20`,
      );
      for (const r of cost) signals.push({
        type: 'CUSTOS_INSTAVEIS', severity: 'LOW',
        title: 'Alterações recorrentes de custo',
        detail: `"${r.what}" entrou com custos entre ${r.mn} e ${r.mx} (${r.n} entradas) nos últimos ${days} dias.`,
        count: r.n,
      });

      const order = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
      signals.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
      return { signals, periodDays: days };
    });
  }

  // ── Localização física (corredor/prateleira) ─────────────────
  async listLocations(
    schema: string,
    f: { storeId?: string; q?: string } = {},
  ): Promise<Array<Record<string, unknown>>> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const conds: Prisma.Sql[] = [Prisma.sql`p.is_active = TRUE`];
      if (f.storeId) conds.push(Prisma.sql`si.warehouse_id = ${f.storeId}::uuid`);
      if (f.q?.trim()) {
        const like = `%${f.q.trim()}%`;
        conds.push(Prisma.sql`(p.name ILIKE ${like} OR p.code ILIKE ${like} OR si.location ILIKE ${like})`);
      }
      return tx.$queryRaw<Array<Record<string, unknown>>>(
        Prisma.sql`SELECT si.product_id, p.code, p.name, w.id AS store_id, w.name AS store_name,
                          si.quantity::float AS quantity, si.location
                   FROM stock_items si
                   JOIN products p ON p.id = si.product_id
                   JOIN stores w ON w.id = si.warehouse_id
                   WHERE ${Prisma.join(conds, ' AND ')}
                   ORDER BY si.location NULLS LAST, p.name
                   LIMIT 500`,
      );
    });
  }

  async setLocation(
    schema: string,
    input: { productId: string; storeId: string; location: string | null; actorId?: string | null; actorName?: string | null },
  ): Promise<{ ok: true }> {
    const loc = input.location?.trim() || null;
    await this.prisma.runInTenant(schema, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO stock_items (product_id, warehouse_id, quantity, location)
                   VALUES (${input.productId}::uuid, ${input.storeId}::uuid, 0, ${loc})
                   ON CONFLICT (product_id, warehouse_id)
                   DO UPDATE SET location = ${loc}, updated_at = now()`,
      );
      await this.audit.recordInTx(tx, {
        actorId: input.actorId ?? null, actorName: input.actorName ?? null,
        action: 'STOCK_LOCATION_SET', entity: 'product', entityId: input.productId,
        details: { storeId: input.storeId, location: loc },
      });
    });
    return { ok: true };
  }

  // ── Transferências com aprovação (workflow) ──────────────────
  async listTransferRequests(schema: string, status?: string): Promise<Array<Record<string, unknown>>> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const cond = status ? Prisma.sql`WHERE t.status = ${status}` : Prisma.empty;
      return tx.$queryRaw<Array<Record<string, unknown>>>(
        Prisma.sql`SELECT t.id, t.status, t.quantity::float AS quantity, t.note, t.reject_reason,
                          t.requested_by_name, t.approved_by_name, t.received_by_name,
                          t.created_at, t.approved_at, t.received_at,
                          p.code AS product_code, p.name AS product_name,
                          fo.name AS from_store, de.name AS to_store
                   FROM stock_transfer_requests t
                   JOIN products p ON p.id = t.product_id
                   JOIN stores fo ON fo.id = t.from_store_id
                   JOIN stores de ON de.id = t.to_store_id
                   ${cond}
                   ORDER BY t.created_at DESC LIMIT 300`,
      );
    });
  }

  async createTransferRequest(
    schema: string,
    input: { productId: string; fromStoreId: string; toStoreId: string; quantity: number; note?: string | null; actorId?: string | null; actorName?: string | null },
  ): Promise<{ id: string; status: string }> {
    if (input.fromStoreId === input.toStoreId) throw new BadRequestException('Escolha lojas diferentes.');
    if (!(input.quantity > 0)) throw new BadRequestException('Quantidade inválida.');
    return this.prisma.runInTenant(schema, async (tx) => {
      const prod = await tx.$queryRaw<{ id: string; name: string }[]>(
        Prisma.sql`SELECT id, name FROM products WHERE id = ${input.productId}::uuid AND is_active = TRUE LIMIT 1`,
      );
      if (!prod[0]) throw new BadRequestException('Produto não encontrado.');
      const rows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO stock_transfer_requests
            (product_id, from_store_id, to_store_id, quantity, note, status, requested_by, requested_by_name)
          VALUES (${input.productId}::uuid, ${input.fromStoreId}::uuid, ${input.toStoreId}::uuid,
                  ${input.quantity}, ${input.note ?? null}, 'PENDING',
                  ${input.actorId ?? null}::uuid, ${input.actorName ?? null})
          RETURNING id`,
      );
      await this.audit.recordInTx(tx, {
        actorId: input.actorId ?? null, actorName: input.actorName ?? null,
        action: 'TRANSFER_REQUESTED', entity: 'stock_transfer', entityId: rows[0].id,
        details: { product: prod[0].name, quantity: input.quantity, from: input.fromStoreId, to: input.toStoreId, note: input.note ?? null },
      });
      return { id: rows[0].id, status: 'PENDING' };
    });
  }

  /** Aprova/rejeita (administrador). Só pedidos PENDING mudam de estado. */
  async decideTransferRequest(
    schema: string,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    input: { reason?: string | null; actorId?: string | null; actorName?: string | null },
  ): Promise<{ id: string; status: string }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; status: string }[]>(
        Prisma.sql`SELECT id, status FROM stock_transfer_requests WHERE id = ${id}::uuid FOR UPDATE`,
      );
      if (!rows[0]) throw new BadRequestException('Pedido não encontrado.');
      if (rows[0].status !== 'PENDING') throw new BadRequestException(`Este pedido já está ${rows[0].status}.`);
      await tx.$executeRaw(
        Prisma.sql`UPDATE stock_transfer_requests
                   SET status = ${decision}, approved_by = ${input.actorId ?? null}::uuid,
                       approved_by_name = ${input.actorName ?? null}, approved_at = now(),
                       reject_reason = ${decision === 'REJECTED' ? (input.reason ?? null) : null}
                   WHERE id = ${id}::uuid`,
      );
      await this.audit.recordInTx(tx, {
        actorId: input.actorId ?? null, actorName: input.actorName ?? null,
        action: decision === 'APPROVED' ? 'TRANSFER_APPROVED' : 'TRANSFER_REJECTED',
        entity: 'stock_transfer', entityId: id,
        details: { reason: input.reason ?? null },
      });
      return { id, status: decision };
    });
  }

  /**
   * RECEÇÃO: só aqui o stock se move de facto (saída na origem + entrada no
   * destino, na MESMA transacção, via StockService.applyMovement — o livro
   * append-only e o espelho global ficam coerentes). Pedido tem de estar APPROVED.
   */
  async receiveTransferRequest(
    schema: string,
    id: string,
    input: { actorId?: string | null; actorName?: string | null },
  ): Promise<{ id: string; status: string }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{
        id: string; status: string; product_id: string; from_store_id: string; to_store_id: string; quantity: string;
      }[]>(
        Prisma.sql`SELECT id, status, product_id, from_store_id, to_store_id, quantity
                   FROM stock_transfer_requests WHERE id = ${id}::uuid FOR UPDATE`,
      );
      if (!rows[0]) throw new BadRequestException('Pedido não encontrado.');
      if (rows[0].status !== 'APPROVED') {
        throw new BadRequestException(rows[0].status === 'PENDING'
          ? 'O pedido ainda não foi aprovado pelo administrador.'
          : `Este pedido já está ${rows[0].status}.`);
      }
      const t = rows[0];
      const qty = Number(t.quantity);
      const ref = `Transferência aprovada (${id.slice(0, 8)})`;
      // Saída na origem (bloqueia se não houver stock suficiente).
      await StockService.applyMovement(tx, {
        productId: t.product_id, warehouseId: t.from_store_id, type: 'TRANSFER',
        quantity: -qty, reference: ref, referenceId: id, createdBy: input.actorId ?? null,
        allowNegative: false,
      });
      // Entrada no destino.
      await StockService.applyMovement(tx, {
        productId: t.product_id, warehouseId: t.to_store_id, type: 'TRANSFER',
        quantity: qty, reference: ref, referenceId: id, createdBy: input.actorId ?? null,
        allowNegative: true,
      });
      await tx.$executeRaw(
        Prisma.sql`UPDATE stock_transfer_requests
                   SET status = 'RECEIVED', received_by = ${input.actorId ?? null}::uuid,
                       received_by_name = ${input.actorName ?? null}, received_at = now()
                   WHERE id = ${id}::uuid`,
      );
      await this.audit.recordInTx(tx, {
        actorId: input.actorId ?? null, actorName: input.actorName ?? null,
        action: 'TRANSFER_RECEIVED', entity: 'stock_transfer', entityId: id,
        details: { productId: t.product_id, quantity: qty, from: t.from_store_id, to: t.to_store_id },
      });
      return { id, status: 'RECEIVED' };
    });
  }

  // ── Auditoria por funcionário ────────────────────────────────
  /** Trilha completa filtrável por funcionário/ação/período (quem deu entrada,
   *  transferiu, cancelou, ajustou, alterou custos, fez inventários…). */
  async auditTrail(
    schema: string,
    f: { actorId?: string; action?: string; from?: string; to?: string } = {},
  ): Promise<Array<Record<string, unknown>>> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const conds: Prisma.Sql[] = [Prisma.sql`TRUE`];
      if (f.actorId) conds.push(Prisma.sql`actor_id = ${f.actorId}::uuid`);
      if (f.action) conds.push(Prisma.sql`action = ${f.action}`);
      if (isDate(f.from)) conds.push(Prisma.sql`timestamp >= ${f.from}::date`);
      if (isDate(f.to)) conds.push(Prisma.sql`timestamp < (${f.to}::date + 1)`);
      const rows = await tx.$queryRaw<Array<Record<string, unknown>>>(
        Prisma.sql`SELECT seq, timestamp, actor_name, action, entity, entity_id, details
                   FROM tenant_audit_log
                   WHERE ${Prisma.join(conds, ' AND ')}
                   ORDER BY seq DESC LIMIT 300`,
      );
      return rows.map((r) => ({ ...r, seq: typeof r.seq === 'bigint' ? Number(r.seq) : r.seq }));
    });
  }

  /** Funcionários e ações que aparecem na trilha (para os filtros da UI). */
  async auditFilters(schema: string): Promise<{ actors: Array<{ id: string | null; name: string | null }>; actions: string[] }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const actors = await tx.$queryRaw<Array<{ id: string | null; name: string | null }>>(
        Prisma.sql`SELECT DISTINCT actor_id AS id, actor_name AS name FROM tenant_audit_log
                   WHERE actor_id IS NOT NULL ORDER BY 2 NULLS LAST LIMIT 200`,
      );
      const actions = await tx.$queryRaw<Array<{ action: string }>>(
        Prisma.sql`SELECT DISTINCT action FROM tenant_audit_log ORDER BY 1 LIMIT 200`,
      );
      return { actors, actions: actions.map((a) => a.action) };
    });
  }
}
