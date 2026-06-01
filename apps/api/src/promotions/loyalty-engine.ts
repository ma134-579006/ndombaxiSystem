/**
 * Motor PURO de fidelização (cartão de pontos) — sem BD.
 * Regra simples e robusta para retalho angolano:
 *   • ganham-se pontos por cada Kwanza gasto (taxa configurável);
 *   • 1 ponto vale uma fracção de Kwanza no resgate (taxa configurável);
 *   • o resgate é limitado pelos pontos disponíveis e por um tecto opcional
 *     (ex.: máx. 50% do valor da compra pago em pontos).
 */

export interface LoyaltyConfig {
  /** Pontos ganhos por cada Kwanza gasto (ex.: 1 ponto / 100 Kz → 0.01). */
  pointsPerKz: number;
  /** Valor em Kz de cada ponto no resgate (ex.: 1 ponto = 0.5 Kz). */
  kzPerPoint: number;
  /** Fracção máxima da compra que pode ser paga em pontos [0..1]. */
  maxRedeemFraction?: number;
}

export const DEFAULT_LOYALTY: LoyaltyConfig = {
  pointsPerKz: 0.01, // 1 ponto por cada 100 Kz
  kzPerPoint: 0.5, // cada ponto vale 0,5 Kz
  maxRedeemFraction: 0.5,
};

/** Pontos ganhos numa compra de `grossTotal` Kz (arredonda para baixo). */
export function pointsEarned(grossTotal: number, cfg: LoyaltyConfig): number {
  if (!(grossTotal > 0)) return 0;
  return Math.floor(grossTotal * cfg.pointsPerKz);
}

export interface RedeemResult {
  pointsUsed: number;
  discountKz: number;
  remainingPoints: number;
}

/**
 * Calcula quanto se pode resgatar: limitado pelos pontos pedidos, pelos pontos
 * disponíveis, pelo tecto da compra e pelo próprio valor da compra.
 */
export function redeemPoints(
  requestedPoints: number,
  availablePoints: number,
  grossTotal: number,
  cfg: LoyaltyConfig,
): RedeemResult {
  const maxByCart = grossTotal * (cfg.maxRedeemFraction ?? 1);
  const maxPointsByCart = Math.floor(maxByCart / cfg.kzPerPoint);
  const pointsUsed = Math.max(
    0,
    Math.min(requestedPoints, availablePoints, maxPointsByCart, Math.floor(grossTotal / cfg.kzPerPoint)),
  );
  const discountKz = Math.round(pointsUsed * cfg.kzPerPoint * 100) / 100;
  return { pointsUsed, discountKz, remainingPoints: availablePoints - pointsUsed };
}
