/** Formatação pt-AO determinística (milhares com ".", decimais com ","). */

export function toNumber(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

export function formatKz(value: number | string | null | undefined): string {
  const n = toNumber(value);
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  const sign = n < 0 && (int !== '0' || dec !== '00') ? '-' : '';
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped},${dec} Kz`;
}

export function formatNumber(value: number | string | null | undefined, decimals = 0): string {
  const n = toNumber(value);
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, dec] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = n < 0 ? '-' : '';
  return dec ? `${sign}${grouped},${dec}` : `${sign}${grouped}`;
}

export function formatDateTime(d: Date = new Date()): string {
  const p = (x: number) => (x < 10 ? `0${x}` : `${x}`);
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Lê um valor em Kz escrito à angolana: "2000,50", "5.000,00", "5 000", "1.234.567".
 * `Number("2000,50")` dava NaN (venda bloqueada por "insuficiente") e
 * `Number("5.000,00")` gravava o fundo de caixa a 0. Um único ponto seguido de
 * exatamente 3 dígitos é separador de milhares ("5.000" = 5000); caso contrário
 * é decimal ("3370.56"). Devolve NaN se não for um número.
 */
export function parseKz(raw: string | number | null | undefined): number {
  if (typeof raw === 'number') return raw;
  let s = String(raw ?? '').replace(/\s|kz/gi, '').replace(/[−–]/g, '-');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) ?? []).length > 1 || /^-?\d{1,3}\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}
