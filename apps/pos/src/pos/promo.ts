/**
 * Motor de promoções no POS — espelha apps/api/src/promotions/promo-engine.ts
 * (versão leve para o carrinho). Calcula o desconto por linha em tempo real;
 * o POS converte-o em discountRate e envia ao backend, que aplica o desconto
 * fiscalmente (o recibo nunca diverge).
 */

export type PromoType = 'PERCENT' | 'AMOUNT' | 'BUY_X_PAY_Y' | 'QTY_TIERED';
export type PromoScope = 'PRODUCT' | 'CATEGORY' | 'ALL';

/** Promoção tal como vem de GET /promotions (snake_case do raw SQL). */
export interface PromoRow {
  id: string;
  name: string;
  type: PromoType;
  scope: PromoScope;
  target_id: string | null;
  percent: string | null;
  amount: string | null;
  buy_qty: number | null;
  pay_qty: number | null;
  min_qty: number | null;
  tier_percent: string | null;
  priority: number;
  is_active: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  weekdays?: number[] | null;
  start_time?: string | null;
  end_time?: string | null;
}

export interface PromoCartLine {
  productId: string;
  categoryId?: string | null;
  unitGross: number;
  quantity: number;
}

export interface AppliedPromo {
  discount: number;
  discountRate: number; // desconto / grossBefore (0..1)
  name: string | null;
}

function hhmm(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function isActive(p: PromoRow, now: Date): boolean {
  if (!p.is_active) return false;
  if (p.starts_at && now < new Date(p.starts_at)) return false;
  if (p.ends_at && now > new Date(p.ends_at)) return false;
  if (p.weekdays && p.weekdays.length > 0 && !p.weekdays.includes(now.getDay())) return false;
  if (p.start_time && p.end_time) {
    const cur = now.getHours() * 60 + now.getMinutes();
    const a = hhmm(p.start_time);
    const b = hhmm(p.end_time);
    if (a != null && b != null) {
      if (a <= b) { if (cur < a || cur > b) return false; }
      else { if (cur < a && cur > b) return false; }
    }
  }
  return true;
}

function matches(p: PromoRow, line: PromoCartLine): boolean {
  if (p.scope === 'ALL') return true;
  if (p.scope === 'PRODUCT') return p.target_id === line.productId;
  if (p.scope === 'CATEGORY') return !!line.categoryId && p.target_id === line.categoryId;
  return false;
}

function lineDiscount(p: PromoRow, line: PromoCartLine): number {
  const gross = line.unitGross * line.quantity;
  let d = 0;
  switch (p.type) {
    case 'PERCENT': d = gross * (Number(p.percent ?? 0) / 100); break;
    case 'AMOUNT': d = Number(p.amount ?? 0) * line.quantity; break;
    case 'BUY_X_PAY_Y': {
      const x = p.buy_qty ?? 0, y = p.pay_qty ?? 0;
      if (x > 0 && y > 0 && y < x) d = Math.floor(line.quantity / x) * (x - y) * line.unitGross;
      break;
    }
    case 'QTY_TIERED':
      if ((p.min_qty ?? 0) > 0 && line.quantity >= (p.min_qty ?? 0)) d = gross * (Number(p.tier_percent ?? 0) / 100);
      break;
  }
  return Math.min(Math.max(d, 0), gross);
}

/** Melhor promoção aplicável a uma linha (desconto + discountRate). */
export function bestPromoForLine(
  line: PromoCartLine,
  promotions: PromoRow[],
  now: Date = new Date(),
): AppliedPromo {
  const gross = line.unitGross * line.quantity;
  let best: { d: number; name: string } | null = null;
  for (const p of promotions) {
    if (!isActive(p, now) || !matches(p, line)) continue;
    const d = lineDiscount(p, line);
    if (d > 0 && (!best || d > best.d)) best = { d, name: p.name };
  }
  if (!best || gross <= 0) return { discount: 0, discountRate: 0, name: null };
  // discountRate limitado a <1 (o backend exige < 1).
  const rate = Math.min(best.d / gross, 0.9999);
  return { discount: best.d, discountRate: rate, name: best.name };
}
