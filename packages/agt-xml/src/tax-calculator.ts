import { IvaCode, requiresExemptionReason, resolveRate } from './iva';
import { round2, sum2 } from './money';
import {
  InvoiceLineComputed,
  InvoiceLineInput,
  InvoiceTotals,
  TaxGroupTotal,
} from './types';

/**
 * Compute net / IVA / gross for a single line.
 * Net base = quantity * unitPrice * (1 - discountRate), rounded to 2 decimals.
 * IVA = net * rate%, rounded to 2 decimals.
 */
export function computeLine(line: InvoiceLineInput): InvoiceLineComputed {
  if (line.quantity <= 0) {
    throw new Error(`Line "${line.productCode}": quantity must be > 0`);
  }
  if (line.unitPrice < 0) {
    throw new Error(`Line "${line.productCode}": unitPrice must be >= 0`);
  }
  const discountRate = line.discountRate ?? 0;
  if (discountRate < 0 || discountRate >= 1) {
    throw new Error(`Line "${line.productCode}": discountRate must be in [0,1)`);
  }
  if (requiresExemptionReason(line.ivaCode) && !line.exemptionReason) {
    throw new Error(
      `Line "${line.productCode}": IVA code ${line.ivaCode} requires exemptionReason`,
    );
  }

  const ivaRate = resolveRate(line.ivaCode);
  const netAmount = round2(line.quantity * line.unitPrice * (1 - discountRate));
  const ivaAmount = round2((netAmount * ivaRate) / 100);
  const grossAmount = round2(netAmount + ivaAmount);

  return { ...line, ivaRate, netAmount, ivaAmount, grossAmount };
}

/** Compute all lines and aggregate totals, grouped by IVA code for SAF-T. */
export function computeInvoice(lines: InvoiceLineInput[]): {
  lines: InvoiceLineComputed[];
  totals: InvoiceTotals;
} {
  if (lines.length === 0) {
    throw new Error('Invoice must have at least one line');
  }
  const computed = lines.map(computeLine);

  const groups = new Map<IvaCode, TaxGroupTotal>();
  for (const line of computed) {
    const g = groups.get(line.ivaCode) ?? {
      ivaCode: line.ivaCode,
      ivaRate: line.ivaRate,
      netTotal: 0,
      ivaTotal: 0,
    };
    g.netTotal = round2(g.netTotal + line.netAmount);
    g.ivaTotal = round2(g.ivaTotal + line.ivaAmount);
    groups.set(line.ivaCode, g);
  }

  const netTotal = sum2(computed.map((l) => l.netAmount));
  const ivaTotal = sum2(computed.map((l) => l.ivaAmount));
  const grossTotal = round2(netTotal + ivaTotal);

  return {
    lines: computed,
    totals: {
      netTotal,
      ivaTotal,
      grossTotal,
      byTaxCode: [...groups.values()],
    },
  };
}
