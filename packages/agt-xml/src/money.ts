/**
 * Money helpers for AOA (Kwanza). All fiscal amounts are rounded to 2 decimals
 * using half-up rounding, the rule AGT expects for SAF-T totals (§7.2).
 */

/** Round to 2 decimals, half-up, avoiding binary float drift (e.g. 1.005 → 1.01). */
export function round2(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`round2: value must be finite, got ${value}`);
  }
  // Scale, nudge away from float error, then round half-up.
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Format an amount as a SAF-T monetary string: fixed 2 decimals, dot separator. */
export function money(value: number): string {
  return round2(value).toFixed(2);
}

/** Sum a list of amounts and round the total once, to 2 decimals. */
export function sum2(values: number[]): number {
  return round2(values.reduce((acc, v) => acc + v, 0));
}
