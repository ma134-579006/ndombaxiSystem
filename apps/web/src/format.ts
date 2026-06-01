export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (x: number) => (x < 10 ? `0${x}` : `${x}`);
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  ACTIVE: 'Activa',
  SUSPENDED: 'Suspensa',
  CANCELLED: 'Cancelada',
  PAID: 'Paga',
  SHIPPED: 'Expedida',
  DELIVERED: 'Entregue',
};
export function statusLabel(s: string): string {
  return STATUS_LABELS[s] ?? s;
}

/** Formata um montante em Kwanzas (AOA). Aceita number ou string NUMERIC. */
export function formatKz(value: number | string): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kz`;
}
