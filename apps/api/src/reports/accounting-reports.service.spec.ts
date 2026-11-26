import { AO_IVA_RATES, FISCAL_SALE_TYPES, LISTABLE_TYPES, parseTypes, withAllRates } from './accounting-reports.service';

describe('Contabilidade (relatórios como o Vendus)', () => {
  it('tipos: aceita só os permitidos, sem repetir; vazio → os fiscais', () => {
    expect(parseTypes('ft, nc,XX,NC', LISTABLE_TYPES, FISCAL_SALE_TYPES)).toEqual(['FT', 'NC']);
    expect(parseTypes(undefined, LISTABLE_TYPES, FISCAL_SALE_TYPES)).toEqual([...FISCAL_SALE_TYPES]);
    expect(parseTypes("FT'; DROP TABLE x;--", LISTABLE_TYPES, FISCAL_SALE_TYPES)).toEqual([...FISCAL_SALE_TYPES]);
  });

  it('mapa de fornecedores mostra todas as taxas de Angola, mesmo a zero', () => {
    const rows = withAllRates([{ rate: 14, products: 3, iva: 140, base: 1000, total: 1140 }], (rate) => ({ rate, products: 0, iva: 0, base: 0, total: 0 }));
    expect(rows.map((r) => r.rate)).toEqual(AO_IVA_RATES.map((r) => r.rate));
    expect(rows.find((r) => r.rate === 14)).toMatchObject({ products: 3, iva: 140, label: 'IVA - Taxa Normal (14%)' });
    expect(rows.find((r) => r.rate === 0)).toMatchObject({ products: 0, label: 'IVA - Isento (0%)' });
  });

  it('taxa fora da tabela não se perde', () => {
    const rows = withAllRates([{ rate: 10, products: 1, iva: 10, base: 100, total: 110 }], (rate) => ({ rate, products: 0, iva: 0, base: 0, total: 0 }));
    expect(rows.at(-1)).toMatchObject({ rate: 10, label: 'IVA (10%)' });
  });
});
