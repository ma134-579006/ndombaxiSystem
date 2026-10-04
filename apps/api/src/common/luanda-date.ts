/**
 * Datas de negócio na hora LOCAL de Angola (Africa/Luanda, UTC+1, sem hora de
 * verão). O servidor corre em UTC: `toISOString()` dava o dia ANTERIOR às
 * vendas feitas entre as 00:00 e a 01:00, e `getFullYear()` dependia do fuso
 * da máquina (nuvem vs. posto local).
 */
const LUANDA_OFFSET_MS = 60 * 60 * 1000;

/** 'YYYY-MM-DD' do dia em Luanda para o instante dado (por omissão: agora). */
export function luandaDate(at: Date | number = Date.now()): string {
  const t = typeof at === 'number' ? at : at.getTime();
  return new Date(t + LUANDA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Ano civil em Luanda (para séries fiscais e contadores). */
export function luandaYear(at: Date | number = Date.now()): number {
  return Number(luandaDate(at).slice(0, 4));
}
