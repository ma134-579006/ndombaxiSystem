import type { Product } from '../api/types';
import { IVA_RATE } from '../api/types';

export interface CartLine {
  product: Product;
  quantity: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
