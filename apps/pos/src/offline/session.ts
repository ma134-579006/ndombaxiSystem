/**
 * Sessão OFFLINE da Caixa — entrar sem rede com o mesmo e-mail + PIN.
 *
 * Como funciona: no primeiro login COM ligação, o servidor confirma a identidade
 * e guardamos aqui, no aparelho, um VERIFICADOR PBKDF2 do PIN (nunca o PIN) mais
 * os últimos tokens da sessão. A partir daí, sem internet, o operador digita o
 * mesmo PIN, verificamos localmente e reabrimos a MESMA sessão — a Caixa continua
 * a vender (catálogo em cache) e as vendas entram na fila para subir ao reconectar.
 *
 * Aditivo e defensivo: NÃO toca no login online (que já funciona). Só entra em
 * ação quando o login online falha por FALTA DE REDE (status 0). Reutiliza o
 * mesmo IndexedDB (KV) da fila de vendas — sem dependências novas.
 *
 * Segurança: guardamos só o derivado PBKDF2 do PIN (quem ler a base não o
 * descobre) e a credencial tem validade (30 dias) — um funcionário que saia não
 * fica com acesso vitalício a um posto que nunca mais viu a internet. Os tokens
 * ficam no armazenamento privado da app (sandbox), como a fila de vendas.
 */
import { kvGet, kvSet } from './db';
import { durableGet, durableSet } from '../sharedCache';
import { mintOfflineToken, verifyProvisioned } from './credentials';

const KV_VAULT = 'offline:sessionVault';
const ITERATIONS = 150_000;
const VALID_DAYS = 30;

interface OfflineCred {
  companyCode: string;
  email: string;
  salt: string;         // base64
  verifier: string;     // base64 (PBKDF2 do PIN)
  iterations: number;
  accessToken: string;
  refreshToken: string;
  validUntil: string;   // ISO
}
type Vault = Record<string, OfflineCred>;

export interface OfflineIdentity {
  accessToken: string;
  refreshToken: string;
  companyCode: string;
}
export interface VerifyOffline {
  ok: boolean;
  identity?: OfflineIdentity;
  reason?: 'wrong-pin' | 'unknown-user' | 'expired' | 'unavailable';
  /** Sessão aberta com um token cunhado no posto (o operador nunca entrou aqui
   *  com rede). Tem de ser promovida a sessão real assim que houver ligação. */
  provisional?: boolean;
}

function cryptoOk(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}
function slot(company: string, email: string): string {
  return `${company.trim().toUpperCase()}|${email.trim().toLowerCase()}`;
}
function toB64(b: Uint8Array): string {
  let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function deriveVerifier(secret: string, salt: Uint8Array, iterations: number): Promise<string> {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  // `as BufferSource` é só para o compilador: o TypeScript recente parametriza
  // `Uint8Array` pelo tipo de buffer e deixa de o aceitar aqui, embora em
  // execução seja exatamente o que a API espera (igual em web/offline/session.ts).
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, km, 256,
  );
  return toB64(new Uint8Array(bits));
}
/** Comparação em tempo constante (não revela onde diferem). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
// O cofre vive em DOIS sítios: a base da fila de vendas (onde sempre viveu, por
// compatibilidade com postos já instalados) e o armazenamento durável
// (IndexedDB partilhado + espelho no localStorage). O IndexedDB falha em
// silêncio — quota, base corrompida, contexto sem permissões — e um cofre
// perdido é uma Caixa que não abre sem rede.
async function readVault(): Promise<Vault> {
  try {
    const v = await kvGet<Vault>(KV_VAULT);
    if (v && Object.keys(v).length > 0) return v;
  } catch { /* segue para o espelho */ }
  try { return (await durableGet<Vault>(KV_VAULT)) ?? {}; } catch { return {}; }
}
async function writeVault(v: Vault): Promise<void> {
  try { await kvSet(KV_VAULT, v); } catch { /* best-effort */ }
  try { await durableSet(KV_VAULT, v); } catch { /* best-effort */ }
}

/**
 * Guarda a credencial após um login ONLINE bem-sucedido. Best-effort: qualquer
 * falha aqui NUNCA quebra o login (é envolvido em try/catch pelo chamador).
 */
export async function rememberOffline(input: {
  companyCode: string; email: string; pin: string;
  accessToken: string; refreshToken: string;
}): Promise<void> {
  if (!cryptoOk()) return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const verifier = await deriveVerifier(input.pin, salt, ITERATIONS);
  const vault = await readVault();
  vault[slot(input.companyCode, input.email)] = {
    companyCode: input.companyCode,
    email: input.email.trim().toLowerCase(),
    salt: toB64(salt),
    verifier,
    iterations: ITERATIONS,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    validUntil: new Date(Date.now() + VALID_DAYS * 86_400_000).toISOString(),
  };
  await writeVault(vault);
}

/** Verifica o PIN sem rede. Tenta a empresa dada; senão procura pelo e-mail. */
export async function verifyOffline(email: string, pin: string, companyCode?: string | null): Promise<VerifyOffline> {
  if (!cryptoOk()) return { ok: false, reason: 'unavailable' };
  const vault = await readVault();
  const em = email.trim().toLowerCase();
  const candidates: OfflineCred[] = companyCode
    ? [vault[slot(companyCode, em)]].filter(Boolean) as OfflineCred[]
    : Object.values(vault).filter((c) => c.email === em);
  let expired = false;
  for (const cred of candidates) {
    if (Date.parse(cred.validUntil) < Date.now()) { expired = true; continue; }
    const cand = await deriveVerifier(pin, fromB64(cred.salt), cred.iterations);
    if (safeEqual(cand, cred.verifier)) {
      return { ok: true, identity: { accessToken: cred.accessToken, refreshToken: cred.refreshToken, companyCode: cred.companyCode } };
    }
  }

  // SEGUNDA PORTA — credenciais provisionadas pelo servidor para a empresa.
  // É o que permite ao operador do turno da noite abrir a Caixa num posto onde
  // nunca escreveu o PIN, sem rede. Antes disto, o posto só conhecia quem lá
  // tivesse entrado uma vez com internet — e a Caixa parecia avariada.
  const prov = await verifyProvisioned(email, pin, 'pin', companyCode);
  if (prov.ok && prov.user && prov.companyCode) {
    return {
      ok: true,
      provisional: true,
      identity: {
        accessToken: mintOfflineToken(prov.user, prov.companyCode),
        refreshToken: '',
        companyCode: prov.companyCode,
      },
    };
  }

  if (candidates.length === 0 && prov.reason === 'unknown-user') return { ok: false, reason: 'unknown-user' };
  if (expired || prov.reason === 'expired') return { ok: false, reason: 'expired' };
  if (candidates.length === 0 && prov.reason === 'unavailable') return { ok: false, reason: 'unavailable' };
  return { ok: false, reason: 'wrong-pin' };
}

// ─── Promoção da sessão offline a sessão real ────────────────────────────────
// Guardado EM MEMÓRIA e só em memória (morre com a página): o que o operador
// escreveu ao entrar sem rede, para a app fazer um login verdadeiro mal a
// ligação volte, sem lhe pedir o PIN outra vez.
let pending: { email: string; pin: string } | null = null;

export function setPendingUpgrade(v: { email: string; pin: string }): void { pending = v; }
export function getPendingUpgrade(): { email: string; pin: string } | null { return pending; }
export function clearPendingUpgrade(): void { pending = null; }
