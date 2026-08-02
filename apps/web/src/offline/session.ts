/**
 * Sessão OFFLINE do Gestor — entrar sem rede com o mesmo e-mail + palavra-passe.
 *
 * O problema que isto resolve: o painel de gestão guardava a sessão em
 * `sessionStorage`, que morre quando a janela fecha. Na app instalada isso
 * significava que, ao reabrir sem internet, não havia sessão E não havia forma
 * de entrar — a aplicação ficava inutilizável exatamente no cenário para que foi
 * feita. O catálogo já estava em cache; o que faltava era a PORTA.
 *
 * Como funciona: no primeiro login COM ligação, o servidor confirma a identidade
 * e guardamos aqui, no aparelho, um VERIFICADOR PBKDF2 da palavra-passe (nunca a
 * palavra-passe) mais os últimos tokens. Sem rede, o gestor escreve as mesmas
 * credenciais, verificamos localmente e reabrimos a MESMA sessão.
 *
 * É o mesmo desenho já em uso na Caixa (`apps/pos/src/offline/session.ts`), para
 * as duas apps se comportarem igual e haver só uma ideia a manter na cabeça.
 *
 * Decisões de segurança:
 *   • Guardamos só o derivado PBKDF2 (150k iterações, SHA-256) — quem ler a base
 *     não descobre a palavra-passe.
 *   • A credencial EXPIRA (30 dias): um gestor afastado da empresa não fica com
 *     acesso vitalício a um posto que nunca mais viu a internet.
 *   • Comparação em tempo constante — não revela onde as chaves diferem.
 *   • SÓ na app instalada. No site (navegador), muitas vezes um computador
 *     partilhado, não deixamos rasto de credenciais: aí a rede existe sempre,
 *     porque a própria página vem dela.
 */
import { isNativeApp } from '../config';
import { durableGet, durableSet } from '../sharedCache';
import { mintOfflineToken, verifyProvisioned } from './credentials';

const KEY_VAULT = 'offline:managerVault';
const ITERATIONS = 150_000;
const VALID_DAYS = 30;

interface OfflineCred {
  companyCode: string;
  email: string;
  salt: string;       // base64
  verifier: string;   // base64 (PBKDF2 da palavra-passe)
  iterations: number;
  accessToken: string;
  refreshToken: string;
  validUntil: string; // ISO
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
  reason?: 'wrong-password' | 'unknown-user' | 'expired' | 'unavailable';
  /** Verdadeiro quando a sessão foi aberta com um token cunhado localmente (o
   *  utilizador nunca entrou com rede NESTE aparelho). Quem chama tem de a
   *  promover a uma sessão real assim que houver ligação. */
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
  // O `as BufferSource` é só para o compilador: as versões recentes do
  // TypeScript parametrizam `Uint8Array` pelo tipo de buffer e deixam de o
  // aceitar aqui, embora em execução seja exatamente o que a API espera.
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
// Armazenamento DURÁVEL (IndexedDB + espelho no localStorage): se um dos dois
// falhar — e no desktop/Android falha em silêncio — o cofre sobrevive no outro.
// Um cofre perdido é uma app que não abre sem rede.
async function readVault(): Promise<Vault> {
  try { return (await durableGet<Vault>(KEY_VAULT)) ?? {}; } catch { return {}; }
}
async function writeVault(v: Vault): Promise<void> {
  try { await durableSet(KEY_VAULT, v); } catch { /* best-effort */ }
}

/**
 * Guarda a credencial após um login ONLINE bem-sucedido. Best-effort por
 * desenho: uma falha aqui NUNCA pode impedir alguém de entrar.
 */
export async function rememberOffline(input: {
  companyCode: string; email: string; password: string;
  accessToken: string; refreshToken: string;
}): Promise<void> {
  if (!isNativeApp() || !cryptoOk()) return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const verifier = await deriveVerifier(input.password, salt, ITERATIONS);
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

/**
 * Verifica as credenciais sem rede. Tenta a empresa indicada; se não vier
 * nenhuma (o normal — o e-mail resolve a empresa), procura por e-mail.
 */
export async function verifyOffline(
  email: string, password: string, companyCode?: string | null,
): Promise<VerifyOffline> {
  if (!isNativeApp() || !cryptoOk()) return { ok: false, reason: 'unavailable' };
  const vault = await readVault();
  const em = email.trim().toLowerCase();
  const candidates: OfflineCred[] = companyCode
    ? [vault[slot(companyCode, em)]].filter(Boolean) as OfflineCred[]
    : Object.values(vault).filter((c) => c.email === em);
  let expired = false;
  for (const cred of candidates) {
    if (Date.parse(cred.validUntil) < Date.now()) { expired = true; continue; }
    const cand = await deriveVerifier(password, fromB64(cred.salt), cred.iterations);
    if (safeEqual(cand, cred.verifier)) {
      return {
        ok: true,
        identity: {
          accessToken: cred.accessToken,
          refreshToken: cred.refreshToken,
          companyCode: cred.companyCode,
        },
      };
    }
  }
  // SEGUNDA PORTA — credenciais que o servidor provisionou para a empresa.
  // É esta que faz o login offline funcionar para quem NUNCA escreveu a senha
  // neste aparelho: o gestor que troca de computador, o colega que abre a app
  // do posto, o funcionário contratado depois da última ligação. Sem ela, o
  // cofre acima só conhecia uma pessoa e a app parecia avariada sem rede.
  const prov = await verifyProvisioned(email, password, 'password', companyCode);
  if (prov.ok && prov.user && prov.companyCode) {
    return {
      ok: true,
      provisional: true,
      identity: {
        // Token cunhado aqui: identifica quem está a usar a app enquanto não há
        // rede. É trocado por tokens reais assim que a ligação voltar.
        accessToken: mintOfflineToken(prov.user, prov.companyCode),
        refreshToken: '',
        companyCode: prov.companyCode,
      },
    };
  }

  // Só reportamos "expirada" se NENHUMA credencial válida serviu — senão uma
  // credencial velha de outra empresa escondia a boa.
  if (candidates.length === 0 && prov.reason === 'unknown-user') {
    return { ok: false, reason: 'unknown-user' };
  }
  if (expired || prov.reason === 'expired') return { ok: false, reason: 'expired' };
  if (candidates.length === 0 && prov.reason === 'unavailable') {
    return { ok: false, reason: 'unavailable' };
  }
  return { ok: false, reason: 'wrong-password' };
}

// ─── Promoção da sessão offline a sessão real ────────────────────────────────
//
// Quem entra offline com credenciais provisionadas fica com um token local, que
// o servidor (bem) recusa. Guardamos aqui, EM MEMÓRIA e só em memória, o que o
// utilizador acabou de escrever, para que a app possa fazer um login verdadeiro
// mal a ligação volte — sem lhe pedir a senha outra vez. Nada disto é gravado
// em disco: morre com a página.
let pending: { email: string; password: string; companyCode?: string } | null = null;

export function setPendingUpgrade(v: { email: string; password: string; companyCode?: string }): void {
  pending = v;
}
export function getPendingUpgrade(): { email: string; password: string; companyCode?: string } | null {
  return pending;
}
export function clearPendingUpgrade(): void {
  pending = null;
}

/** Esquece as credenciais offline (logout explícito do gestor). */
export async function forgetOffline(email?: string): Promise<void> {
  if (!cryptoOk()) return;
  if (!email) { await writeVault({}); return; }
  const em = email.trim().toLowerCase();
  const vault = await readVault();
  for (const k of Object.keys(vault)) if (vault[k].email === em) delete vault[k];
  await writeVault(vault);
}
