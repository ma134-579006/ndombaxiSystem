/**
 * Camada offline da Caixa — IndexedDB puro (sem dependências).
 *   • kv: cache do catálogo/clientes/recibo/identidade (para abrir offline).
 *   • pendingSales: fila de vendas feitas sem internet, à espera de emissão fiscal.
 *
 * IMPORTANTE (lei fiscal AGT): o número e o hash do documento são SEMPRE
 * atribuídos pelo servidor (sequência sem saltos). Uma venda offline fica em
 * fila e só recebe o número fiscal quando é sincronizada — nunca o inventamos.
 */
import type { CartLine } from '../pos/cart';

const DB_NAME = 'ndombaxi-pos';
const DB_VERSION = 1;
const STORE_KV = 'kv';
const STORE_SALES = 'pendingSales';

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

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV);
      if (!db.objectStoreNames.contains(STORE_SALES)) {
        db.createObjectStore(STORE_SALES, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponível'));
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Falha de IndexedDB'));
      }),
  );
}

/** True se o ambiente suporta IndexedDB (degradação graciosa em modo restrito). */
export function offlineSupported(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

// ── Cache chave/valor ──────────────────────────────────────
export async function kvSet<T>(key: string, value: T): Promise<void> {
  if (!offlineSupported()) return;
  try {
    await tx(STORE_KV, 'readwrite', (s) => s.put(value as unknown as object, key));
  } catch {
    /* cache best-effort */
  }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  if (!offlineSupported()) return null;
  try {
    const v = await tx<T>(STORE_KV, 'readonly', (s) => s.get(key) as IDBRequest<T>);
    return (v ?? null) as T | null;
  } catch {
    return null;
  }
}

// ── Fila de vendas offline ─────────────────────────────────
export function buildPendingSale(
  cart: CartLine[],
  totals: { net: number; iva: number; gross: number },
  customer: { id: string; name: string } | null,
): PendingSale {
  const rand = Math.random().toString(16).slice(2, 6).toUpperCase();
  return {
    localRef: `OFFLINE-${rand}`,
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

function ivaRate(code: string): number {
  return code === 'NOR' ? 14 : code === 'RED' ? 5 : 0;
}

export async function queueSale(sale: PendingSale): Promise<number> {
  const id = await tx<IDBValidKey>(STORE_SALES, 'readwrite', (s) => s.add(sale) as IDBRequest<IDBValidKey>);
  return Number(id);
}

export async function listPendingSales(): Promise<PendingSale[]> {
  if (!offlineSupported()) return [];
  try {
    const all = await tx<PendingSale[]>(STORE_SALES, 'readonly', (s) => s.getAll() as IDBRequest<PendingSale[]>);
    return all ?? [];
  } catch {
    return [];
  }
}

export async function updateSale(sale: PendingSale): Promise<void> {
  await tx(STORE_SALES, 'readwrite', (s) => s.put(sale));
}

export async function deleteSale(id: number): Promise<void> {
  await tx(STORE_SALES, 'readwrite', (s) => s.delete(id));
}

export async function countPendingSales(): Promise<number> {
  if (!offlineSupported()) return 0;
  try {
    return await tx<number>(STORE_SALES, 'readonly', (s) => s.count() as IDBRequest<number>);
  } catch {
    return 0;
  }
}
