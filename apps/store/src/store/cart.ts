import type { CatalogProduct } from '../api/types';

export interface CartLine {
  product: CatalogProduct;
  quantity: number;
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.product.grossPrice * l.quantity, 0);
}
