/**
 * Cache PARTILHADA entre a Gestão e a Caixa NO MESMO APARELHO.
 *
 * No Android as duas apps são servidas da MESMA origem (https://localhost), por
 * isso partilham o IndexedDB: o que a Gestão descarrega (catálogo, clientes,
 * promoções) fica disponível para a Caixa SEM REDE — e vice-versa. É a
 * "sincronização local" pedida: um dado atualizado por um módulo aparece no
 * outro offline, sem passar pelo servidor.
 *
 * Base de dados própria ("ndombaxi.shared"), separada das caches internas de cada
 * app, para ser um ponto comum e estável. Tudo tolerante a falhas — NUNCA rebenta
 * a app (em erro devolve null / não escreve).
 *
 * Limites honestos: no DESKTOP (Electron) os módulos usam origens distintas
 * (ndombaxi://gestao vs //caixa) e NÃO partilham este IndexedDB — cada um tem a
 * sua cache. No SITE (online) é apenas um bónus de resiliência offline.
 */
const DB = 'ndombaxi.shared';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Guarda um valor na cache partilhada (best-effort). */
export async function sharedSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value as unknown as object, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* best-effort: nunca quebra a app */ }
}

/** Lê um valor da cache partilhada (null se não existir ou falhar). */
export async function sharedGet<T>(key: string): Promise<T | null> {
  try {
    const db = await open();
    const v = await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => resolve((r.result as T) ?? null);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return v;
  } catch { return null; }
}
