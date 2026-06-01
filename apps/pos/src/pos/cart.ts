import type { Product } from '../api/types';
import { IVA_RATE } from '../api/types';

export interface CartLine {
  product: Product;
  quantity: number;
}

/**
 * Arredondamento a 2 casas (meio-acima), robusto em qualquer magnitude —
 * espelha exactamente o motor fiscal do backend (@nexus/agt-xml money.ts) para
 * que a pré-visualização do carrinho nunca divirja 0,01 do documento emitido.
 */
function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n === 0) return 0;
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  const rounded = Math.round(Number(`${abs}e2`));
  return (sign * Number(`${rounded}e-2`)) || 0;
}

/** Líquido da linha (preço unitário é já o valor antes de IVA). */
export function lineNet(line: CartLine): number {
  return round2(Number(line.product.unit_price) * line.quantity);
}

export function lineIva(line: CartLine): number {
  return round2((lineNet(line) * IVA_RATE[line.product.iva_code]) / 100);
}

export function lineGross(line: CartLine): number {
  return round2(lineNet(line) + lineIva(line));
}

export interface CartTotals {
  net: number;
  iva: number;
  gross: number;
  count: number;
}

/** Pré-visualização dos totais (espelha o motor fiscal: arredonda por linha). */
export function cartTotals(lines: CartLine[]): CartTotals {
  let net = 0;
  let iva = 0;
  let count = 0;
  for (const l of lines) {
    net += lineNet(l);
    iva += lineIva(l);
    count += l.quantity;
  }
  net = round2(net);
  iva = round2(iva);
  return { net, iva, gross: round2(net + iva), count };
}

/** Totais com desconto por linha (mapa productId → discountRate 0..1). */
export function cartTotalsWithDiscount(
  lines: CartLine[],
  discountRateByProduct: Record<string, number>,
): CartTotals & { discount: number } {
  let net = 0, iva = 0, count = 0, grossBefore = 0;
  for (const l of lines) {
    const rate = discountRateByProduct[l.product.id] ?? 0;
    const ln = round2(lineNet(l) * (1 - rate));
    net += ln;
    iva += round2((ln * IVA_RATE[l.product.iva_code]) / 100);
    count += l.quantity;
    grossBefore += lineGross(l);
  }
  net = round2(net);
  iva = round2(iva);
  const gross = round2(net + iva);
  return { net, iva, gross, count, discount: round2(round2(grossBefore) - gross) };
}
