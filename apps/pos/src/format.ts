/** Formatação pt-AO determinística (milhares com ".", decimais com ","). */

export function toNumber(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

export function formatKz(value: number | string | null | undefined): string {
  const n = toNumber(value);
  const sign = n < 0 ? '-' : '';
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
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
