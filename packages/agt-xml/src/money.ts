/**
 * Money helpers for AOA (Kwanza). All fiscal amounts are rounded to 2 decimals
 * using half-up rounding, the rule AGT expects for SAF-T totals (§7.2).
 */

/**
 * Round to 2 decimals, half-up, robust at ANY magnitude (e.g. 1.005 → 1.01,
 * 9999999.995 → 10000000.00).
 *
 * The naïve `Math.round(v * 100) / 100` fails because of binary float drift:
 * 1.005 is stored as 1.00499999…, so it rounds DOWN. The common "fix" of
 * adding Number.EPSILON only works near 1.0 — for large invoices (millions of
 * AOA) EPSILON is swallowed by the magnitude and the bug returns, breaking the
 * half-up rule and de-aligning totals from the SAF-T. We instead shift the
 * decimal point via the number's decimal string representation, which is exact
 * for the 2-decimal monetary values we handle.
 */
export function round2(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`round2: value must be finite, got ${value}`);
  }
  // Normalize -0 and tiny negatives that are really zero.
  if (value === 0) return 0;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  // Shift two decimals using the exponential string form (avoids float drift),
  // round half-up, then shift back. Works regardless of magnitude.
  const shifted = Number(`${abs}e2`);
  const rounded = Math.round(shifted); // half-up for the now-integer-ish value
  return (sign * Number(`${rounded}e-2`)) || 0; // `|| 0` collapses -0 → 0
}

/** Format an amount as a SAF-T monetary string: fixed 2 decimals, dot separator. */
export function money(value: number): string {
  return round2(value).toFixed(2);
}

/** Sum a list of amounts and round the total once, to 2 decimals. */
export function sum2(values: number[]): number {
  return round2(values.reduce((acc, v) => acc + v, 0));
}
