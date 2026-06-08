/**
 * IVA (VAT) rules for Angola per AGT (§7.1).
 * Tax codes and rates are fixed by the tax authority; do not invent new ones.
 */

export enum IvaCode {
  /** Normal rate. */
  NOR = 'NOR',
  /** Intermediate rate (taxa intermédia, 7%). */
  INT = 'INT',
  /** Reduced rate. */
  RED = 'RED',
  /** Exempt (isento). */
  ISE = 'ISE',
  /** Other / out of scope. */
  OUT = 'OUT',
}

/** Statutory IVA percentage per code (whole-number percent, e.g. 14 = 14%). */
export const IVA_RATE: Record<IvaCode, number> = {
  [IvaCode.NOR]: 14,
  [IvaCode.INT]: 7,
  [IvaCode.RED]: 5,
  [IvaCode.ISE]: 0,
  [IvaCode.OUT]: 0,
};

/** SAF-T TaxType is always IVA for these; ISE/OUT may carry an exemption reason. */
export const SAFT_TAX_TYPE = 'IVA' as const;

export function resolveRate(code: IvaCode): number {
  const rate = IVA_RATE[code];
  if (rate === undefined) {
    throw new Error(`Unknown IVA code: ${code}`);
  }
  return rate;
}

/** Codes that legally require a TaxExemptionReason/Code in the document. */
export function requiresExemptionReason(code: IvaCode): boolean {
  return code === IvaCode.ISE || code === IvaCode.OUT;
}

export function isIvaCode(value: string): value is IvaCode {
  return value in IVA_RATE;
}
