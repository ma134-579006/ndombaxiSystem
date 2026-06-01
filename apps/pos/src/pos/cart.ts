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
