/**
 * Recuo exponencial com dispersão (jitter).
 *
 * O jitter não é enfeite. Sem ele, uma loja com 8 caixas que perde a internet
 * volta a atacar o servidor exatamente no mesmo milissegundo quando ela regressa
 * — e derruba a API precisamente no pior momento. A dispersão espalha a rajada.
 */

export interface BackoffPolicy {
  /** Espera base da 1.ª tentativa, em ms. */
  baseMs: number;
  /** Teto de espera, em ms. Impede esperas absurdas ao fim de muitas falhas. */
  maxMs: number;
  /** Fator de crescimento por tentativa. */
  factor: number;
  /** Fração de dispersão aleatória (0..1). 0.5 = ±50 %. */
  jitter: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseMs: 2_000,
  maxMs: 5 * 60_000, // 5 min: mesmo ao fim de horas offline, reage depressa ao regresso
  factor: 2,
  jitter: 0.5,
};

/** Espera, em ms, antes da tentativa nº `attempt` (1 = primeira repetição). */
export function backoffDelay(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF): number {
  const n = Math.max(1, Math.floor(attempt));
  const raw = policy.baseMs * Math.pow(policy.factor, n - 1);
  const capped = Math.min(raw, policy.maxMs);
  const spread = capped * policy.jitter;
  const delta = (Math.random() * 2 - 1) * spread;
  return Math.max(0, Math.round(capped + delta));
}

/** Instante (epoch ms) da próxima tentativa. */
export function nextAttemptAt(
  attempt: number,
  now: number = Date.now(),
  policy: BackoffPolicy = DEFAULT_BACKOFF,
): number {
  return now + backoffDelay(attempt, policy);
}
