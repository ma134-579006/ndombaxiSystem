/** LPS Kwanza — regras partilhadas dos saques (prazo e bancos). Ver kwanza-payouts.ts. */
const H = 3_600_000;
const LUANDA = 1 * H; // UTC+1, sem hora de verão

/** Bancos de Angola para escolher (a empresa pode juntar outros). */
export const ANGOLA_BANKS = [
  'BAI', 'BFA', 'BIC', 'BPC', 'Millennium Atlântico', 'Banco Sol', 'Standard Bank', 'Banco Económico', 'BCI', 'Banco Keve',
  'Banco Yetu', 'BNI', 'Finibanco', 'Banco Caixa Geral Angola', 'Access Bank', 'Banco Comercial do Huambo', 'Banco de Fomento', 'Multicaixa Express',
];

/** Prazo do saque pedido em `at` (ver regra no topo). */
export function withdrawalDue(at: Date): Date {
  const local = new Date(at.getTime() + LUANDA);
  const dow = local.getUTCDay(); // 0 domingo … 6 sábado
  if (dow >= 1 && dow <= 4) return new Date(at.getTime() + 24 * H);
  const toMonday = (8 - dow) % 7 || 7; // sexta → 3, sábado → 2, domingo → 1
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + toMonday, 23, 59, 59) - LUANDA);
}

