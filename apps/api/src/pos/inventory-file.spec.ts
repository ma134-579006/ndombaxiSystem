import { buildInventoryFile, formatQty, productCategory } from './inventory-file';

const base = { barcode: null, unit: null, isIngredient: false, isProduction: false };

describe('Ficheiro de inventário (AG Tributária › Inventário)', () => {
  it('classifica mercadorias, matérias-primas e produtos acabados', () => {
    expect(productCategory({ isIngredient: false, isProduction: false })).toBe('M');
    expect(productCategory({ isIngredient: true, isProduction: false })).toBe('P');
    expect(productCategory({ isIngredient: false, isProduction: true })).toBe('A');
  });

  it('formata quantidades com ponto e até 3 casas', () => {
    expect(formatQty(12)).toBe('12');
    expect(formatQty(1.5)).toBe('1.5');
    expect(formatQty(0.12345)).toBe('0.123');
  });

  it('gera CSV com «;», escapando o separador e aspas', () => {
    const csv = buildInventoryFile([
      { ...base, code: 'P1', name: 'Arroz; 1kg "Tio"', barcode: '560123', unit: 'un', qty: 10 },
      { ...base, code: 'F2', name: 'Farinha', qty: 2.5, unit: 'kg', isIngredient: true },
    ], 'csv');
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('ProductCategory;ProductCode;ProductDescription;ProductNumberCode;ClosingStockQuantity;UnitOfMeasure');
    expect(lines[1]).toBe('M;P1;"Arroz; 1kg ""Tio""";560123;10;UN');
    expect(lines[2]).toBe('P;F2;Farinha;F2;2.5;KG');
  });

  it('gera XML válido com os caracteres escapados', () => {
    const xml = buildInventoryFile([{ ...base, code: 'A&B', name: 'Pão <grande>', qty: 3 }], 'xml');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<StockFile>')).toBe(true);
    expect(xml).toContain('<ProductCode>A&amp;B</ProductCode>');
    expect(xml).toContain('<ProductDescription>Pão &lt;grande&gt;</ProductDescription>');
    expect(xml).toContain('<ClosingStockQuantity>3</ClosingStockQuantity>');
    expect(xml.trim().endsWith('</StockFile>')).toBe(true);
  });

  it('sem produtos dá um ficheiro só com o cabeçalho', () => {
    expect(buildInventoryFile([], 'xml')).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<StockFile>\n</StockFile>\n');
    expect(buildInventoryFile([], 'csv').split('\r\n').filter(Boolean)).toHaveLength(1);
  });
});
