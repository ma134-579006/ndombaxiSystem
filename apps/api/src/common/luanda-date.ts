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

/**
 * Data-hora LOCAL de Luanda com o desvio explícito: 'YYYY-MM-DDTHH:mm:ss+01:00'.
 * Os primeiros 19 caracteres (o que se assina e vai no SAF-T/FE) são a hora de
 * Angola; o desvio garante que o Postgres grava o instante certo.
 */
export function luandaDateTime(at: Date | number = Date.now()): string {
  const t = typeof at === 'number' ? at : at.getTime();
  return `${new Date(t + LUANDA_OFFSET_MS).toISOString().slice(0, 19)}+01:00`;
}

/**
 * SystemEntryDate exactamente como foi ASSINADO (2.º campo da string assinada).
 * Documentos antigos foram assinados com a hora UTC; os novos com a de Luanda —
 * ler daqui mantém o SAF-T e a FE iguais à assinatura em ambos os casos.
 */
export function signedEntryDate(signable: string | null | undefined, fallback: Date): string {
  const part = signable?.split(';')[1];
  return part && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(part) ? part : luandaDateTime(fallback).slice(0, 19);
}
