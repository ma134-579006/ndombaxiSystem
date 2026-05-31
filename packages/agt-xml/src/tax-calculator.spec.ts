import { IvaCode } from './iva';
import { computeInvoice, computeLine } from './tax-calculator';

describe('computeLine', () => {
  it('computes net, iva and gross at the normal 14% rate', () => {
    const line = computeLine({
      productCode: 'P1',
      description: 'Item',
      quantity: 2,
      unitPrice: 1000,
      ivaCode: IvaCode.NOR,
    });
    expect(line.netAmount).toBe(2000);
    expect(line.ivaAmount).toBe(280);
    expect(line.grossAmount).toBe(2280);
  });

  it('applies a line discount before tax', () => {
    const line = computeLine({
      productCode: 'P1',
      description: 'Item',
      quantity: 1,
      unitPrice: 1000,
      ivaCode: IvaCode.RED,
      discountRate: 0.1,
    });
    expect(line.netAmount).toBe(900);
    expect(line.ivaAmount).toBe(45); // 5% of 900
    expect(line.grossAmount).toBe(945);
  });

  it('charges no tax on exempt lines but demands a reason', () => {
    expect(() =>
      computeLine({
        productCode: 'P1',
        description: 'Item',
        quantity: 1,
        unitPrice: 500,
        ivaCode: IvaCode.ISE,
      }),
    ).toThrow(/exemptionReason/);

    const line = computeLine({
      productCode: 'P1',
      description: 'Item',
      quantity: 1,
      unitPrice: 500,
      ivaCode: IvaCode.ISE,
      exemptionReason: 'Transmissão isenta art. 12',
    });
    expect(line.ivaAmount).toBe(0);
    expect(line.grossAmount).toBe(500);
  });

  it('rejects invalid quantity and discount', () => {
    expect(() =>
      computeLine({ productCode: 'P', description: 'd', quantity: 0, unitPrice: 1, ivaCode: IvaCode.NOR }),
    ).toThrow(/quantity/);
    expect(() =>
      computeLine({ productCode: 'P', description: 'd', quantity: 1, unitPrice: 1, ivaCode: IvaCode.NOR, discountRate: 1 }),
    ).toThrow(/discountRate/);
  });
});

describe('computeInvoice', () => {
  it('aggregates totals grouped by IVA code', () => {
    const { totals } = computeInvoice([
      { productCode: 'A', description: 'a', quantity: 1, unitPrice: 1000, ivaCode: IvaCode.NOR },
      { productCode: 'B', description: 'b', quantity: 1, unitPrice: 1000, ivaCode: IvaCode.NOR },
      { productCode: 'C', description: 'c', quantity: 1, unitPrice: 1000, ivaCode: IvaCode.RED },
    ]);
    expect(totals.netTotal).toBe(3000);
    expect(totals.ivaTotal).toBe(330); // 140 + 140 + 50
    expect(totals.grossTotal).toBe(3330);
    expect(totals.byTaxCode).toHaveLength(2);
    const nor = totals.byTaxCode.find((g) => g.ivaCode === IvaCode.NOR)!;
    expect(nor.netTotal).toBe(2000);
    expect(nor.ivaTotal).toBe(280);
  });

  it('rejects an empty invoice', () => {
    expect(() => computeInvoice([])).toThrow(/at least one line/);
  });
});
