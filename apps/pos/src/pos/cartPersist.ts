/**
 * Persistência do carrinho do POS — lógica pura (sem React, sem DOM), testável
 * em Node. Corrige a perda de artigos quando a rede falha:
 *
 *  - B-01: ao recarregar, o rascunho do servidor substituía às cegas o carrinho
 *    local. Agora o local guarda `updatedAt` e `syncedAt`; alterações locais
 *    ainda não enviadas ao servidor NUNCA são substituídas pelo rascunho remoto.
 *  - B-02: a reconciliação com o stock removia linhas em silêncio. Agora devolve
 *    o que removeu/ajustou para o ecrã avisar o funcionário.
 *
 * O carrinho é só uma VENDA EM PREPARAÇÃO: nada aqui emite ou representa um
 * documento fiscal.
 */

export interface StoredLine<P> {
  product: P;
  quantity: number;
}

export interface StoredCart<P> {
  v: 2;
  lines: StoredLine<P>[];
  customerId: string | null;
  /** Última alteração local (ms epoch). */
  updatedAt: number;
  /** Última vez que o servidor confirmou ESTE conteúdo (0 = nunca). */
  syncedAt: number;
}

export interface CatalogProduct {
  id: string;
  name: string;
  stock_qty: string | number;
  has_recipe?: boolean | null;
}

/** Lê o que está guardado. Aceita o formato antigo (array de linhas). */
export function parseStoredCart<P>(raw: string | null | undefined): StoredCart<P> | null {
  if (!raw) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (Array.isArray(data)) {
    // Formato antigo: só linhas. Nunca foi confirmado pelo servidor → syncedAt 0,
    // para o rascunho remoto não o substituir.
    const lines = data.filter(isLine) as StoredLine<P>[];
    return { v: 2, lines, customerId: null, updatedAt: 1, syncedAt: 0 };
  }
  if (data && typeof data === 'object' && (data as { v?: unknown }).v === 2) {
    const d = data as StoredCart<P>;
    return {
      v: 2,
      lines: Array.isArray(d.lines) ? (d.lines.filter(isLine) as StoredLine<P>[]) : [],
      customerId: typeof d.customerId === 'string' ? d.customerId : null,
      updatedAt: Number(d.updatedAt) || 0,
      syncedAt: Number(d.syncedAt) || 0,
    };
  }
  return null;
}

function isLine(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false;
  const l = x as { product?: { id?: unknown }; quantity?: unknown };
  return !!l.product && typeof l.product.id === 'string' && typeof l.quantity === 'number' && l.quantity > 0;
}

/** Há alterações locais que o servidor ainda não tem? */
export function hasUnsyncedChanges<P>(c: StoredCart<P> | null): boolean {
  return !!c && c.lines.length > 0 && c.updatedAt > c.syncedAt;
}

/**
 * Decide a origem do carrinho ao hidratar:
 *  - local com alterações por enviar → fica o LOCAL (o servidor está atrasado);
 *  - local vazio → fica o SERVIDOR (cross-device);
 *  - local já sincronizado → o SERVIDOR é a versão mais recente (pode ter mudado
 *    noutro aparelho ou a venda ter sido concluída lá).
 */
export function decideHydration<P>(
  local: StoredCart<P> | null,
  serverHasLines: boolean,
): 'local' | 'server' {
  if (hasUnsyncedChanges(local)) return 'local';
  if (!local || local.lines.length === 0) return serverHasLines ? 'server' : 'local';
  return 'server';
}

export interface ReconcileResult<P> {
  lines: StoredLine<P>[];
  removed: { name: string; reason: 'missing' | 'out_of_stock' }[];
  clamped: { name: string; from: number; to: number }[];
  changed: boolean;
}

/**
 * Reconcilia o carrinho com o catálogo/stock atual. Pratos sob encomenda
 * (ficha técnica) não têm stock próprio — nunca são removidos nem limitados.
 */
export function reconcileWithCatalog<P extends CatalogProduct>(
  lines: StoredLine<P>[],
  products: P[],
): ReconcileResult<P> {
  const byId = new Map(products.map((p) => [p.id, p]));
  const out: StoredLine<P>[] = [];
  const removed: ReconcileResult<P>['removed'] = [];
  const clamped: ReconcileResult<P>['clamped'] = [];
  let changed = false;
  for (const l of lines) {
    const fresh = byId.get(l.product.id);
    if (!fresh) { removed.push({ name: l.product.name, reason: 'missing' }); changed = true; continue; }
    const madeToOrder = !!fresh.has_recipe;
    const stock = Number(fresh.stock_qty);
    if (!madeToOrder && !(stock > 0)) { removed.push({ name: fresh.name, reason: 'out_of_stock' }); changed = true; continue; }
    const qty = madeToOrder ? l.quantity : Math.min(l.quantity, stock);
    if (qty !== l.quantity) clamped.push({ name: fresh.name, from: l.quantity, to: qty });
    if (qty !== l.quantity || fresh !== l.product) changed = true;
    out.push({ product: fresh, quantity: qty });
  }
  return { lines: changed ? out : lines, removed, clamped, changed };
}

/** Texto curto para avisar o funcionário do que a reconciliação mudou. */
export function describeReconcile(r: Pick<ReconcileResult<unknown>, 'removed' | 'clamped'>): string | null {
  const parts: string[] = [];
  const missing = r.removed.filter((x) => x.reason === 'missing').map((x) => x.name);
  const out = r.removed.filter((x) => x.reason === 'out_of_stock').map((x) => x.name);
  if (out.length) parts.push(`Sem stock, retirado do carrinho: ${out.join(', ')}`);
  if (missing.length) parts.push(`Já não está à venda, retirado do carrinho: ${missing.join(', ')}`);
  if (r.clamped.length) parts.push(`Quantidade ajustada ao stock: ${r.clamped.map((c) => `${c.name} (${c.from}→${c.to})`).join(', ')}`);
  return parts.length ? parts.join('. ') + '.' : null;
}
