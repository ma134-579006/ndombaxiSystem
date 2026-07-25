/**
 * Criptografia do motor Offline-First. Tudo assente na WebCrypto — disponível
 * no navegador, no renderer do Electron, no WebView do Capacitor e no Node 20+.
 * Não há implementações caseiras de primitivas aqui, de propósito.
 *
 * Duas responsabilidades distintas:
 *   1. AES-256-GCM para cifrar em repouso o que fica no disco do posto (catálogo,
 *      clientes, vendas em fila). Um portátil roubado não entrega a base de
 *      dados da empresa a quem o abrir.
 *   2. PBKDF2-SHA256 para o verificador do PIN/senha offline. Guardamos o
 *      derivado, NUNCA o segredo — quem ler o ficheiro não descobre o PIN.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error('WebCrypto indisponível — é exigido um contexto seguro (HTTPS ou localhost).');
  }
  return c.subtle;
}

/** True se o ambiente consegue cifrar. Permite degradar em vez de rebentar. */
export function cryptoAvailable(): boolean {
  try { return Boolean(globalThis.crypto?.subtle); } catch { return false; }
}

// ── Utilitários ──────────────────────────────────────────────

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  // Em blocos, para não estourar a pilha de argumentos com buffers grandes.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** UUID v4. É a chave de idempotência das operações — tem de ser aleatório real. */
export function uuid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; // versão 4
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Comparação em tempo constante. Numa verificação de PIN, um `===` vaza pelo
 * tempo de resposta quantos bytes iniciais acertaram.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Cifra em repouso (AES-256-GCM) ───────────────────────────

export interface SealedBlob {
  /** Versão do formato — permite rodar algoritmo sem perder dados antigos. */
  v: 1;
  /** Vetor de inicialização, base64. Único por cifragem. */
  iv: string;
  /** Texto cifrado + etiqueta de autenticação, base64. */
  ct: string;
}

/** Deriva uma chave AES-256 a partir de um segredo do dispositivo. */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations = 210_000,
): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Cifra um valor JSON. O GCM é autenticado: se alguém adulterar um byte do
 * ficheiro, a decifragem falha em vez de devolver lixo silenciosamente — é isto
 * que dá a verificação de integridade contra tampering.
 */
export async function seal(key: CryptoKey, value: unknown): Promise<SealedBlob> {
  const iv = randomBytes(12); // 96 bits, o tamanho recomendado para GCM
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    enc.encode(JSON.stringify(value)),
  );
  return { v: 1, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

/** Decifra. Lança se o conteúdo tiver sido adulterado ou a chave estiver errada. */
export async function unseal<T>(key: CryptoKey, blob: SealedBlob): Promise<T> {
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: fromBase64(blob.iv) as unknown as BufferSource },
    key,
    fromBase64(blob.ct) as unknown as BufferSource,
  );
  return JSON.parse(dec.decode(plain)) as T;
}

// ── Verificador de segredo offline (PBKDF2) ──────────────────

/** Custo do PBKDF2 para o PIN. Alto o suficiente para travar força bruta ao ficheiro. */
export const PIN_ITERATIONS = 310_000;

/** Deriva o verificador de um PIN/senha. Determinístico para o mesmo par. */
export async function deriveVerifier(
  secret: string,
  salt: Uint8Array,
  iterations = PIN_ITERATIONS,
): Promise<string> {
  const base = await subtle().importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    base,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

/** SHA-256 em base64 — usado para impressões digitais de integridade. */
export async function sha256(input: string): Promise<string> {
  const d = await subtle().digest('SHA-256', enc.encode(input));
  return toBase64(new Uint8Array(d));
}
