/**
 * Formatação determinística (sem depender de dados de locale do motor JS,
 * que variam entre Hermes/Android/iOS). Convenções de Angola (pt-AO):
 *   • milhares separados por ponto, decimais por vírgula
 *   • moeda: Kwanza (Kz)
 */

export function toNumber(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

/** 1234567.5 → "1.234.567,50 Kz" */
export function formatKz(value: number | string | null | undefined): string {
  const n = toNumber(value);
  const sign = n < 0 ? '-' : '';
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped},${dec} Kz`;
}

/** Número inteiro/decimal com agrupamento de milhares (sem moeda). */
export function formatNumber(value: number | string | null | undefined, decimals = 0): string {
  const n = toNumber(value);
  const sign = n < 0 ? '-' : '';
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, dec] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec ? `${sign}${grouped},${dec}` : `${sign}${grouped}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** ISO → "30/05/2026" */
export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** ISO → "30/05 14:22" */
export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO → "14:22" */
export function formatTime(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  PAID: 'Paga',
  SHIPPED: 'Expedida',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelada',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

const PAYMENT_LABELS: Record<string, string> = {
  BANK_TRANSFER: 'Transferência bancária',
  REFERENCE: 'Pagamento por referência',
  MULTICAIXA_EXPRESS: 'Multicaixa Express',
  CASH: 'Numerário',
};

export function paymentLabel(method: string | null | undefined): string {
  if (!method) return '—';
  return PAYMENT_LABELS[method] ?? method;
}
