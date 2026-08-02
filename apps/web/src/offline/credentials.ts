/**
 * CREDENCIAIS DA EMPRESA NO APARELHO — o que faz o login offline funcionar de
 * verdade.
 *
 * O que estava mal: o cofre local (`session.ts`) só conhecia quem tivesse
 * escrito a senha NAQUELE aparelho. Bastava um segundo gestor, um funcionário
 * contratado depois, ou uma senha trocada noutro computador para a app dizer
 * "utilizador desconhecido" assim que faltasse a rede — e sem rede não havia
 * como corrigir. Era este o buraco por onde o Android e o desktop caíam.
 *
 * O que passa a acontecer: à PRIMEIRA entrada com internet, a app descarrega o
 * pacote de credenciais da empresa (`GET /auth/offline-credentials`) e guarda-o
 * no armazenamento do aparelho. A partir daí qualquer utilizador ativo dessa
 * empresa entra sem rede, mesmo que nunca tenha escrito a senha ali. O pacote é
 * re-sincronizado a cada entrada e periodicamente, para acompanhar senhas
 * trocadas, funcionários novos e saídas.
 *
 * O que o servidor manda (e o que não manda): um VERIFICADOR PBKDF2-SHA256
 * (150k iterações) do segredo — o mesmo desenho que o cofre local já usava. O
 * hash de autenticação (Argon2id) nunca sai do servidor.
 *
 * Guardado só na APP INSTALADA. No site (muitas vezes um computador partilhado)
 * não deixamos credenciais da empresa no navegador — e lá a rede existe sempre,
 * porque a própria página vem dela.
 */
import { isNativeApp } from '../config';
import { durableGet, durableSet } from '../sharedCache';

const KEY_BUNDLES = 'offline:credBundles';
/** Sem uma entrada com rede há tanto tempo, a cópia deixa de servir. */
const VALID_DAYS = 60;
/** Re-sincroniza no máximo de 6 em 6 horas (fora do arranque). */
export const RESYNC_MS = 6 * 60 * 60 * 1000;

export interface ProvisionedVerifier {
  salt: string;
  verifier: string;
  iterations: number;
}
export interface ProvisionedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  storeId: string | null;
  storeName: string | null;
  photoUrl: string | null;
  password: ProvisionedVerifier | null;
  pin: ProvisionedVerifier | null;
  updatedAt: string | null;
}
export interface CredentialBundle {
  companyCode: string;
  companyName: string;
  serverTime: string;
  revision: string | null;
  users: ProvisionedUser[];
}
/** O que fica no aparelho: pacotes por empresa + quando os fomos buscar. */
interface StoredBundle extends CredentialBundle {
  fetchedAt: string;
}
type Store = Record<string, StoredBundle>;

export interface ProvisionedMatch {
  ok: boolean;
  user?: ProvisionedUser;
  companyCode?: string;
  reason?: 'wrong-secret' | 'unknown-user' | 'expired' | 'unavailable';
}

function cryptoOk(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function toB64(b: Uint8Array): string {
  let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s);
}
/** Mesmos parâmetros do servidor e do cofre local — não mexer de um lado só. */
async function derive(secret: string, salt: Uint8Array, iterations: number): Promise<string> {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, km, 256,
  );
  return toB64(new Uint8Array(bits));
}
/** Comparação em tempo constante (não revela onde as chaves diferem). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readStore(): Promise<Store> {
  try { return (await durableGet<Store>(KEY_BUNDLES)) ?? {}; } catch { return {}; }
}
async function writeStore(s: Store): Promise<void> {
  try { await durableSet(KEY_BUNDLES, s); } catch { /* best-effort */ }
}

/**
 * Guarda (ou substitui) o pacote de uma empresa. Best-effort por desenho: uma
 * falha aqui nunca pode estragar um login que já teve sucesso.
 */
export async function saveBundle(bundle: CredentialBundle): Promise<void> {
  if (!isNativeApp() || !bundle?.companyCode) return;
  const store = await readStore();
  store[bundle.companyCode.toUpperCase()] = { ...bundle, fetchedAt: new Date().toISOString() };
  await writeStore(store);
}

/** Momento da última sincronização desta empresa (null se nunca houve). */
export async function lastSyncAt(companyCode: string): Promise<number | null> {
  const store = await readStore();
  const b = store[companyCode.toUpperCase()];
  return b ? Date.parse(b.fetchedAt) : null;
}

/**
 * Verifica um segredo contra as credenciais provisionadas pelo servidor.
 * `kind` distingue a senha do painel do PIN da caixa — o mesmo pacote serve os
 * dois módulos, e no Android partilham mesmo o armazenamento.
 */
export async function verifyProvisioned(
  email: string, secret: string, kind: 'password' | 'pin', companyCode?: string | null,
): Promise<ProvisionedMatch> {
  if (!isNativeApp() || !cryptoOk()) return { ok: false, reason: 'unavailable' };
  const store = await readStore();
  const bundles = companyCode
    ? [store[companyCode.toUpperCase()]].filter(Boolean)
    : Object.values(store);
  if (bundles.length === 0) return { ok: false, reason: 'unknown-user' };

  const em = email.trim().toLowerCase();
  let sawUser = false;
  let expired = false;
  for (const b of bundles) {
    const stale = Date.parse(b.fetchedAt) + VALID_DAYS * 86_400_000 < Date.now();
    for (const u of b.users) {
      if (u.email.trim().toLowerCase() !== em) continue;
      const cred = kind === 'pin' ? u.pin : u.password;
      if (!cred) continue;
      sawUser = true;
      // A validade só conta depois de sabermos que o utilizador existe — senão
      // uma cópia velha de outra empresa escondia a boa.
      if (stale) { expired = true; continue; }
      const cand = await derive(secret, fromB64(cred.salt), cred.iterations);
      if (safeEqual(cand, cred.verifier)) {
        return { ok: true, user: u, companyCode: b.companyCode };
      }
    }
  }
  if (!sawUser) return { ok: false, reason: 'unknown-user' };
  return { ok: false, reason: expired ? 'expired' : 'wrong-secret' };
}

/**
 * Constrói um token de sessão LOCAL para um utilizador que autenticou offline
 * mas de quem não temos tokens do servidor (nunca entrou neste aparelho com
 * rede).
 *
 * É um JWT sem assinatura válida — de propósito, e sem risco: o servidor
 * recusa-o, como deve. Serve só para o interface saber quem está a usar a app
 * (nome, papel, loja) enquanto não há rede. Assim que a ligação voltar, o
 * `AuthContext` troca-o por tokens verdadeiros com as credenciais que o
 * utilizador acabou de escrever (ver `pendingUpgrade` em session.ts).
 */
export function mintOfflineToken(user: ProvisionedUser, companyCode: string): string {
  const b64url = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = { alg: 'none', typ: 'JWT' };
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    subjectType: 'TENANT' as const,
    storeId: user.storeId ?? undefined,
    companyCode,
    // SEM `exp`: um token local não deve accionar a renovação proativa nem
    // parecer expirado ao fim de 15 minutos sem rede.
    offline: true,
    iat: Math.floor(Date.now() / 1000),
  };
  return `${b64url(header)}.${b64url(payload)}.offline`;
}

/** Este token foi cunhado aqui (sessão offline) e não pelo servidor? */
export function isOfflineToken(token: string | null | undefined): boolean {
  return !!token && token.endsWith('.offline');
}

/**
 * Vai buscar o pacote da empresa e guarda-o. Chamada no login e de tempos a
 * tempos; `force` ignora o intervalo mínimo.
 *
 * Falha em silêncio de propósito: sem rede não há nada a fazer, e a cópia que já
 * está no aparelho continua a servir.
 */
export async function syncCredentials(companyCode?: string | null, force = false): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    if (!force && companyCode) {
      const last = await lastSyncAt(companyCode);
      if (last !== null && Date.now() - last < RESYNC_MS) return false;
    }
    const { api } = await import('../api/client');
    const bundle = await api.offlineCredentials();
    await saveBundle(bundle);
    return true;
  } catch {
    return false;
  }
}

/** Esquece os pacotes guardados (ex.: "esquecer este dispositivo"). */
export async function forgetProvisioned(): Promise<void> {
  await writeStore({});
}
