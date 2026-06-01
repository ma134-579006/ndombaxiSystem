/**
 * Motor PURO de promoções (sem BD) — nível supermercado.
 * Aplica campanhas a um carrinho e devolve o desconto por linha + total.
 * Tipos suportados (realidade de retalho angolano):
 *   • PERCENT      — X% de desconto (no produto/categoria/tudo)
 *   • AMOUNT       — valor fixo de desconto por unidade
 *   • BUY_X_PAY_Y  — leve X, pague Y (ex.: 3x2)
 *   • QTY_TIERED   — desconto por quantidade (ex.: a partir de 10 un, 5%)
 * Regras de janela: dias da semana + intervalo horário (happy-hour) + datas.
 */

export type PromoType = 'PERCENT' | 'AMOUNT' | 'BUY_X_PAY_Y' | 'QTY_TIERED';
export type PromoScope = 'PRODUCT' | 'CATEGORY' | 'ALL';

export interface Promotion {
  id: string;
  name: string;
  type: PromoType;
  scope: PromoScope;
  /** Alvo: id do produto (PRODUCT) ou da categoria (CATEGORY); ignorado em ALL. */
  targetId?: string | null;
  percent?: number | null; // PERCENT: 0..100
  amount?: number | null; // AMOUNT: Kz por unidade
  buyQty?: number | null; // BUY_X_PAY_Y: X
  payQty?: number | null; // BUY_X_PAY_Y: Y
  minQty?: number | null; // QTY_TIERED: a partir de N unidades
  tierPercent?: number | null; // QTY_TIERED: % aplicada
  priority?: number | null; // maior = aplicada primeiro
  active?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  /** Dias da semana permitidos (0=Dom..6=Sáb). Vazio/ausente = todos. */
  weekdays?: number[] | null;
  /** Hora de início/fim no formato "HH:MM" (happy-hour). */
  startTime?: string | null;
  endTime?: string | null;
}

export interface PromoCartLine {
  productId: string;
  categoryId?: string | null;
  /** Preço unitário BRUTO (com IVA) já calculado. */
  unitGross: number;
  quantity: number;
}

export interface PromoLineResult {
  productId: string;
  quantity: number;
  grossBefore: number;
  discount: number;
  grossAfter: number;
  appliedPromo?: { id: string; name: string } | null;
}

export interface PromoResult {
  lines: PromoLineResult[];
  totalBefore: number;
  totalDiscount: number;
  totalAfter: number;
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = n < 0 ? -1 : 1;
  return (s * Math.round(Math.abs(n) * 100)) / 100 || 0;
}

function hhmmToMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Diz se a promoção está activa no instante `now`. */
export function isPromoActive(p: Promotion, now: Date = new Date()): boolean {
  if (p.active === false) return false;
  if (p.startsAt && now < new Date(p.startsAt)) return false;
  if (p.endsAt && now > new Date(p.endsAt)) return false;
  if (p.weekdays && p.weekdays.length > 0 && !p.weekdays.includes(now.getDay())) return false;
  if (p.startTime && p.endTime) {
    const cur = now.getHours() * 60 + now.getMinutes();
    const a = hhmmToMinutes(p.startTime);
    const b = hhmmToMinutes(p.endTime);
    if (a != null && b != null) {
      if (a <= b) { if (cur < a || cur > b) return false; }
      else { if (cur < a && cur > b) return false; } // janela que cruza a meia-noite
    }
  }
  return true;
}

/** Uma promoção aplica-se a esta linha (por âmbito)? */
function matches(p: Promotion, line: PromoCartLine): boolean {
  if (p.scope === 'ALL') return true;
  if (p.scope === 'PRODUCT') return p.targetId === line.productId;
  if (p.scope === 'CATEGORY') return !!line.categoryId && p.targetId === line.categoryId;
  return false;
}

/** Desconto que uma promoção dá a uma linha (sem ultrapassar o valor da linha). */
function lineDiscount(p: Promotion, line: PromoCartLine): number {
  const lineGross = line.unitGross * line.quantity;
  let d = 0;
  switch (p.type) {
    case 'PERCENT':
      d = lineGross * ((p.percent ?? 0) / 100);
      break;
    case 'AMOUNT':
      d = (p.amount ?? 0) * line.quantity;
      break;
    case 'BUY_X_PAY_Y': {
      const x = p.buyQty ?? 0;
      const y = p.payQty ?? 0;
      if (x > 0 && y > 0 && y < x) {
        const groups = Math.floor(line.quantity / x);
        const freeUnits = groups * (x - y);
        d = freeUnits * line.unitGross;
      }
      break;
    }
    case 'QTY_TIERED':
      if ((p.minQty ?? 0) > 0 && line.quantity >= (p.minQty ?? 0)) {
        d = lineGross * ((p.tierPercent ?? 0) / 100);
      }
      break;
  }
  return round2(Math.min(Math.max(d, 0), lineGross));
}

/**
 * Aplica o melhor desconto a cada linha. Por linha escolhe a promoção activa,
 * aplicável e de maior desconto (com desempate por prioridade). Não acumula
 * (regra de retalho conservadora: a melhor promoção por artigo).
 */
export function applyPromotions(
  lines: PromoCartLine[],
  promotions: Promotion[],
  now: Date = new Date(),
): PromoResult {
  const active = promotions
    .filter((p) => isPromoActive(p, now))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const out: PromoLineResult[] = lines.map((line) => {
    const grossBefore = round2(line.unitGross * line.quantity);
    let best: { d: number; p: Promotion } | null = null;
    for (const p of active) {
      if (!matches(p, line)) continue;
      const d = lineDiscount(p, line);
      if (d > 0 && (!best || d > best.d)) best = { d, p };
    }
    const discount = best?.d ?? 0;
    return {
      productId: line.productId,
      quantity: line.quantity,
      grossBefore,
      discount,
      grossAfter: round2(grossBefore - discount),
      appliedPromo: best ? { id: best.p.id, name: best.p.name } : null,
    };
  });

  const totalBefore = round2(out.reduce((s, l) => s + l.grossBefore, 0));
  const totalDiscount = round2(out.reduce((s, l) => s + l.discount, 0));
  return { lines: out, totalBefore, totalDiscount, totalAfter: round2(totalBefore - totalDiscount) };
}
