/**
 * Ficheiro de inventário de existências (como o «Inventário» da página AG Tributária
 * do Vendus): uma linha por produto com stock, no formato de inventário da
 * administração fiscal — CSV separado por «;» ou XML <StockFile>.
 *
 * Categorias (ProductCategory): M = mercadorias, P = matérias-primas e
 * consumíveis, A = produtos acabados (fabrico próprio).
 */
export interface InventoryRow {
  code: string;
  name: string;
  barcode: string | null;
  unit: string | null;
  qty: number;
  isIngredient: boolean;
  isProduction: boolean;
}

export type InventoryFormat = 'csv' | 'xml';

export function productCategory(r: Pick<InventoryRow, 'isIngredient' | 'isProduction'>): 'M' | 'P' | 'A' {
  if (r.isIngredient) return 'P';
  if (r.isProduction) return 'A';
  return 'M';
}

/** Quantidade com ponto decimal e até 3 casas, sem zeros à direita. */
export function formatQty(n: number): string {
  const v = Math.round(n * 1000) / 1000;
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '');
}

const csvCell = (s: string) => (/[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const xmlText = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // caracteres de controlo não são válidos em XML 1.0
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export function buildInventoryFile(rows: InventoryRow[], format: InventoryFormat): string {
  const lines = rows.map((r) => ({
    category: productCategory(r),
    code: r.code,
    description: r.name.trim(),
    numberCode: (r.barcode || r.code).trim(),
    qty: formatQty(r.qty),
    unit: (r.unit || 'UN').trim().toUpperCase(),
  }));
  if (format === 'xml') {
    const body = lines.map((l) => [
      '  <Stock>',
      `    <ProductCategory>${l.category}</ProductCategory>`,
      `    <ProductCode>${xmlText(l.code)}</ProductCode>`,
      `    <ProductDescription>${xmlText(l.description)}</ProductDescription>`,
      `    <ProductNumberCode>${xmlText(l.numberCode)}</ProductNumberCode>`,
      `    <ClosingStockQuantity>${l.qty}</ClosingStockQuantity>`,
      `    <UnitOfMeasure>${xmlText(l.unit)}</UnitOfMeasure>`,
      '  </Stock>',
    ].join('\n')).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<StockFile>\n${body}${body ? '\n' : ''}</StockFile>\n`;
  }
  const head = 'ProductCategory;ProductCode;ProductDescription;ProductNumberCode;ClosingStockQuantity;UnitOfMeasure';
  return [head, ...lines.map((l) => [l.category, l.code, l.description, l.numberCode, l.qty, l.unit].map(csvCell).join(';'))].join('\r\n') + '\r\n';
}
