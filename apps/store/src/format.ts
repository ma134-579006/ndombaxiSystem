export function toNumber(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

/** 1234567.5 → "1.234.567,50 Kz" (convenção pt-AO). */
export function formatKz(value: number | string | null | undefined): string {
  const n = toNumber(value);
  const sign = n < 0 ? '-' : '';
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped},${dec} Kz`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (x: number) => (x < 10 ? `0${x}` : `${x}`);
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
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

/** Nome legível do meio de pagamento: a API usa o código (BANK_TRANSFER…) quando o gestor não deu nome. */
const METHOD_LABEL: Record<string, string> = {
  BANK_TRANSFER: 'Transferência bancária',
  REFERENCE: 'Pagamento por referência',
  MULTICAIXA_EXPRESS: 'Multicaixa Express',
  CASH: 'Numerário na entrega',
};
export function methodLabel(m: { type: string; label?: string | null }): string {
  const l = (m.label ?? '').trim();
  return !l || l === m.type ? METHOD_LABEL[m.type] ?? m.type : l;
}
