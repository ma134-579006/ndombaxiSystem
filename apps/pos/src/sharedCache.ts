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

// ─── Armazenamento DURÁVEL para o que não pode falhar ────────────────────────
//
// O IndexedDB é a escolha certa para dados grandes, mas tem um defeito que aqui
// pesa: quando falha, falha em silêncio (quota, base corrompida, contexto sem
// permissões). Para o catálogo isso é um contratempo; para as CREDENCIAIS é a
// diferença entre entrar e não entrar sem rede — e só se descobre no aparelho
// do cliente, sem internet para corrigir.
//
// Por isso o que é pequeno e crítico (o cofre e o pacote de credenciais) é
// escrito nos DOIS sítios e lido de qualquer um deles. O `localStorage` é
// síncrono e limitado (~5 MB), o que o desqualifica para dados grandes e o
// torna perfeito para estes.
const MIRROR_PREFIX = 'ndombaxi.durable.';

/** Guarda um valor pequeno e crítico em DOIS sítios (IndexedDB + localStorage). */
export async function durableSet<T>(key: string, value: T): Promise<void> {
  try { localStorage.setItem(MIRROR_PREFIX + key, JSON.stringify(value)); } catch { /* sem espaço/permissão */ }
  await sharedSet(key, value);
}

/** Lê de onde estiver — e repõe o espelho em falta, para o próximo arranque. */
export async function durableGet<T>(key: string): Promise<T | null> {
  const fromIdb = await sharedGet<T>(key);
  if (fromIdb !== null) {
    // Reposição silenciosa: se o espelho tiver desaparecido, volta a existir.
    try { localStorage.setItem(MIRROR_PREFIX + key, JSON.stringify(fromIdb)); } catch { /* ignora */ }
    return fromIdb;
  }
  try {
    const raw = localStorage.getItem(MIRROR_PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw) as T;
    void sharedSet(key, v); // repõe o IndexedDB a partir do espelho
    return v;
  } catch { return null; }
}

/** Apaga nos dois sítios. */
export async function durableDel(key: string): Promise<void> {
  try { localStorage.removeItem(MIRROR_PREFIX + key); } catch { /* ignora */ }
  await sharedSet(key, null);
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
