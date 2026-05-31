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
};
export function statusLabel(s: string): string {
  return STATUS_LABELS[s] ?? s;
}
