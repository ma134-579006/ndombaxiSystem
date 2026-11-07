/**
 * Vendas SUSPENSAS (estacionadas) do POS — lógica pura, testável em Node.
 *
 * Paridade com o Vendus ("Nova Venda" estaciona a venda atual e permite
 * alternar entre várias): o funcionário atende outro cliente sem perder a
 * venda em curso. Cada venda suspensa guarda as linhas e o cliente; nada aqui
 * é um documento fiscal — o stock e os preços são reconfirmados ao retomar.
 */

export interface ParkedSale<L> {
  id: string;
  lines: L[];
  customerId: string | null;
  /** Momento em que foi suspensa (ms epoch). */
  parkedAt: number;
}

export const MAX_PARKED = 20;

export function parseParked<L>(raw: string | null | undefined): ParkedSale<L>[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (s): s is ParkedSale<L> =>
        !!s && typeof s.id === 'string' && Array.isArray(s.lines) && s.lines.length > 0 && typeof s.parkedAt === 'number',
    ).map((s) => ({ ...s, customerId: typeof s.customerId === 'string' ? s.customerId : null }));
  } catch {
    return [];
  }
}

/**
 * Suspende a venda atual. Uma venda vazia não é suspensa. Recusa acima de
 * MAX_PARKED (devolve `full`) para não acumular vendas esquecidas.
 */
export function park<L>(
  list: ParkedSale<L>[],
  current: { lines: L[]; customerId: string | null },
  id: string,
  now: number,
): { list: ParkedSale<L>[]; parked: boolean; full: boolean } {
  if (current.lines.length === 0) return { list, parked: false, full: false };
  if (list.length >= MAX_PARKED) return { list, parked: false, full: true };
  return { list: [...list, { id, lines: current.lines, customerId: current.customerId, parkedAt: now }], parked: true, full: false };
}

/**
 * Retoma uma venda suspensa. Se a venda atual tiver artigos, troca: a atual
 * fica suspensa no lugar da retomada (nada se perde).
 */
export function resume<L>(
  list: ParkedSale<L>[],
  id: string,
  current: { lines: L[]; customerId: string | null },
  swapId: string,
  now: number,
): { list: ParkedSale<L>[]; sale: ParkedSale<L> | null } {
  const sale = list.find((s) => s.id === id) ?? null;
  if (!sale) return { list, sale: null };
  let next = list.filter((s) => s.id !== id);
  if (current.lines.length > 0) {
    next = [...next, { id: swapId, lines: current.lines, customerId: current.customerId, parkedAt: now }];
  }
  return { list: next, sale };
}

export function discard<L>(list: ParkedSale<L>[], id: string): ParkedSale<L>[] {
  return list.filter((s) => s.id !== id);
}
