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

/** Decimal exato de um número: mantissa inteira e nº de casas (null se vier em notação exponencial). */
function toDecimal(value: number): { m: bigint; s: number } | null {
  const txt = String(Math.abs(value));
  if (!/^\d+(\.\d+)?$/.test(txt)) return null;
  const [int, frac = ''] = txt.split('.');
  return { m: BigInt(int + frac) * (value < 0 ? -1n : 1n), s: frac.length };
}

/**
 * Produto de vários fatores arredondado a 2 casas, meio para cima, SEM passar por
 * vírgula flutuante: 12 × 11828.65 × 0.875 = 124200.825 exatos, mas em float dá
 * 124200.82499999998 e `round2` arredondava para BAIXO (1 cêntimo a menos na linha
 * e no IVA). Os fatores entram pelo seu decimal exato (quantidade a 3 casas, preço
 * a 2, desconto a 4), multiplicam-se em inteiros e só o resultado é arredondado.
 */
export function mulRound2(...factors: number[]): number {
  let m = 1n;
  let s = 0;
  for (const f of factors) {
    if (!Number.isFinite(f)) throw new Error(`mulRound2: value must be finite, got ${f}`);
    const d = toDecimal(f);
    if (!d) return round2(factors.reduce((a, b) => a * b, 1)); // notação exponencial: caminho antigo
    m *= d.m;
    s += d.s;
  }
  const neg = m < 0n;
  if (neg) m = -m;
  let cents: bigint;
  if (s <= 2) cents = m * 10n ** BigInt(2 - s);
  else {
    const div = 10n ** BigInt(s - 2);
    cents = (m * 2n + div) / (div * 2n); // meio para cima
  }
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('mulRound2: amount out of range');
  const out = Number(cents) / 100;
  return neg ? -out || 0 : out;
}

/** `1 - rate` exato (0.125 → 0.875) para não introduzir drift antes do produto. */
export function complement(rate: number): number {
  const d = toDecimal(rate);
  if (!d) return 1 - rate;
  const one = 10n ** BigInt(d.s);
  const txt = (one - d.m).toString().padStart(d.s + 1, '0');
  return Number(d.s ? `${txt.slice(0, -d.s)}.${txt.slice(-d.s)}` : txt);
}

/** Format an amount as a SAF-T monetary string: fixed 2 decimals, dot separator. */
export function money(value: number): string {
  return round2(value).toFixed(2);
}

/** Sum a list of amounts and round the total once, to 2 decimals. */
export function sum2(values: number[]): number {
  return round2(values.reduce((acc, v) => acc + v, 0));
}
