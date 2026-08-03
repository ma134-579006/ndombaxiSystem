/**
 * Camada offline da Caixa.
 *   • kv: cache do catálogo/clientes/recibo/identidade (para abrir offline).
 *   • pendingSales: fila de vendas feitas sem internet, à espera de emissão fiscal.
 *
 * ONDE isto fica gravado deixou de estar aqui: vive em `store.ts`, que usa o
 * **SQLite do aparelho** (memória interna) quando existe — Android pelo
 * Capacitor, Windows pelo Electron — e recua para IndexedDB no navegador. Uma
 * venda por enviar não é cache: é dinheiro e obrigação fiscal, e merece escrita
 * confirmada em disco e lotes tudo-ou-nada.
 *
 * IMPORTANTE (lei fiscal AGT): o número e o hash do documento são SEMPRE
 * atribuídos pelo servidor (sequência sem saltos). Uma venda offline fica em
 * fila e só recebe o número fiscal quando é sincronizada — nunca o inventamos.
 */
import type { CartLine } from '../pos/cart';
import {
  indexedDbSupported, kvGet as storeKvGet, kvSet as storeKvSet,
  salesAdd, salesCount, salesDelete, salesList, salesPut,
} from './store';

export interface PendingSaleLine {
  productCode: string;
  productName: string;
  quantity: number;
  unitPriceGross: number;
}

export type PendingSaleStatus = 'PENDING' | 'SYNCING' | 'ERROR';

export interface PendingSale {
  id?: number; // autoIncrement
  localRef: string; // referência local legível (ex.: OFFLINE-7F3A)
  /**
   * Chave de idempotência da venda — gerada UMA vez, ao entrar na fila, e
   * enviada IGUAL em todas as tentativas. Fecha a janela em que o servidor
   * gravava a fatura e a resposta se perdia: sem ela, a tentativa seguinte
   * criava um SEGUNDO documento fiscal, com stock e dinheiro em dobro.
   * Opcional porque vendas já em fila (versões anteriores) não a têm.
   */
  clientOpId?: string;
  createdAt: string; // ISO
  customerId: string | null;
  customerName: string | null;
  lines: PendingSaleLine[];
  netTotal: number;
  ivaTotal: number;
  grossTotal: number;
  status: PendingSaleStatus;
  lastError?: string;
  attempts: number;
}

/**
 * True quando há onde guardar. Mantém o nome antigo porque é o que o resto da
 * Caixa usa — o que mudou foi só o sítio onde se guarda.
 */
export function offlineSupported(): boolean {
  // A ponte para o SQLite é assíncrona; esta pergunta é feita em pontos
  // síncronos da interface. O IndexedDB estar disponível é garantia suficiente
  // de que há cave, e nas apps instaladas há sempre a melhor das duas.
  return indexedDbSupported();
}

// ── Cache chave/valor ──────────────────────────────────────
export function kvSet<T>(key: string, value: T): Promise<void> {
  return storeKvSet(key, value);
}

export function kvGet<T>(key: string): Promise<T | null> {
  return storeKvGet<T>(key);
}

// ── Fila de vendas offline ─────────────────────────────────
/**
 * @param clientOpId chave a REUTILIZAR quando a venda já foi TENTADA online e caiu
 *   para a fila por falha de rede. É o que impede a duplicação no caso pior: o
 *   servidor gravou a fatura, a resposta perdeu-se, a venda foi para a fila e
 *   depois reenviada. Com a MESMA chave, o servidor devolve a fatura original em
 *   vez de emitir uma segunda. Omisso → venda nova, chave nova.
 */
export function buildPendingSale(
  cart: CartLine[],
  totals: { net: number; iva: number; gross: number },
  customer: { id: string; name: string } | null,
  clientOpId?: string,
): PendingSale {
  const rand = Math.random().toString(16).slice(2, 6).toUpperCase();
  return {
    localRef: `OFFLINE-${rand}`,
    clientOpId: clientOpId ?? newUuid(), // ver PendingSale.clientOpId
    createdAt: new Date().toISOString(),
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? null,
    lines: cart.map((l) => ({
      productCode: l.product.code,
      productName: l.product.name,
      quantity: l.quantity,
      unitPriceGross: Number(l.product.unit_price) * (1 + ivaRate(l.product.iva_code) / 100),
    })),
    netTotal: totals.net,
    ivaTotal: totals.iva,
    grossTotal: totals.gross,
    status: 'PENDING',
    attempts: 0,
  };
}

/**
 * UUID v4. Usa `crypto.randomUUID` quando existe (contexto seguro: `ndombaxi://`
 * no Electron e `https://localhost` no Android) e cai num gerador equivalente
 * sobre `getRandomValues` quando não — nunca em `Math.random`, porque esta chave
 * é o que impede uma fatura duplicada e não pode ter colisões.
 */
export function newUuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; // versão 4
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function ivaRate(code: string): number {
  return code === 'NOR' ? 14 : code === 'RED' ? 5 : 0;
}

export function queueSale(sale: PendingSale): Promise<number> {
  return salesAdd(sale as unknown as Record<string, unknown>);
}

export function listPendingSales(): Promise<PendingSale[]> {
  return salesList<PendingSale>();
}

export function updateSale(sale: PendingSale): Promise<void> {
  return salesPut(sale as unknown as { id?: number } & Record<string, unknown>);
}

export function deleteSale(id: number): Promise<void> {
  return salesDelete(id);
}

export function countPendingSales(): Promise<number> {
  return salesCount();
}
