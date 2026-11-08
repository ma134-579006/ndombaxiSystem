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
  // Nunca mostra «-0,00»: zero negativo e valores que arredondam a zero saem como 0,00.
  // Mesmo formato do Caixa e da Loja (pt-AO): milhares com «.», decimais com «,» — SEMPRE
  // agrupado (o pt-PT do browser não agrupa 4 dígitos: dava «5000,00» ao lado de «17 100,00»).
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  const sign = n < 0 && (int !== '0' || dec !== '00') ? '-' : '';
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec} Kz`;
}

/** Data LOCAL no formato AAAA-MM-DD (para campos de data e filtros por dia).
 *  Não usar toISOString(): em UTC+1 a meia-noite local cai no dia anterior. */
export function localIso(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
