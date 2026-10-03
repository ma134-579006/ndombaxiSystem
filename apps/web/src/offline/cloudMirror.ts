/**
 * FUNCIONÁRIOS DO SERVIDOR LOCAL → NUVEM, pela API normal da nuvem.
 *
 * Com o servidor local, criar um funcionário, mudar-lhe o PIN, repor a senha ou
 * desativá-lo grava no posto. A replicação genérica NÃO leva utilizadores (quem
 * tem acesso não se escreve linha a linha a partir de um posto), por isso estas
 * operações seguem também para a nuvem PELA API, onde passam pelas mesmas regras
 * de sempre: papéis, e-mail único, cifragem da senha.
 *
 * Sem rede ficam nesta fila e sobem quando a ligação volta, com a sessão da
 * nuvem que a app mantém em 2.º plano (`startCloudSession`). Cada operação leva
 * o seu X-Client-Op-Id: um reenvio nunca a faz duas vezes.
 */
import { CLOUD_API_URL } from '../config';
import { sharedGet, sharedSet } from '../sharedCache';
import { newOpId } from './outbox';

const KEY = 'outbox:cloud:v1';
const STAFF = /^\/staff\/users(\/[^/?]+(\/(reset-password|set-pin|deactivate|unlock))?)?$/;

interface MirrorOp { id: string; method: string; path: string; body?: unknown; at: number }

let auth: { token: string; companyCode: string } | null = null;
let chain: Promise<unknown> = Promise.resolve();
/** Serializa leituras/escritas da fila (várias gravações seguidas não se sobrepõem). */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}
/** Sessão da nuvem obtida em 2.º plano (chamado por `startCloudSession`). */
export function setCloudAuth(a: { token: string; companyCode: string } | null): void {
  auth = a;
  if (a) void flushCloudMirror();
}

/** Esta escrita (feita no servidor local) tem de seguir também para a nuvem? */
export function mirrorsToCloud(method: string, path: string): boolean {
  return method.toUpperCase() !== 'GET' && STAFF.test(path.split('?')[0]);
}

/**
 * Guarda a operação para a nuvem, com o que o posto decidiu: o MESMO id do
 * funcionário criado e a MESMA senha temporária que o posto gerou (senão o
 * funcionário teria uma senha no posto e outra na nuvem).
 */
export async function mirrorStaffWrite(method: string, path: string, body: unknown, resp: unknown): Promise<void> {
  try {
    const p = path.split('?')[0];
    const b = (body && typeof body === 'object' ? { ...(body as Record<string, unknown>) } : {}) as Record<string, unknown>;
    const r = (resp && typeof resp === 'object' ? resp : {}) as { user?: { id?: string }; temporaryPassword?: string };
    if (method.toUpperCase() === 'POST' && p === '/staff/users') {
      if (r.user?.id) b.id = r.user.id;
      if (r.temporaryPassword) { b.password = r.temporaryPassword; b.mustResetPw = true; }
    } else if (p.endsWith('/reset-password') && r.temporaryPassword) {
      b.password = r.temporaryPassword; b.mustResetPw = true;
    }
    const op: MirrorOp = { id: newOpId(), method: method.toUpperCase(), path: p, body: b, at: Date.now() };
    await locked(async () => {
      const list = (await sharedGet<MirrorOp[]>(KEY)) ?? [];
      await sharedSet(KEY, [...list, op]);
    });
    void flushCloudMirror();
  } catch { /* best-effort: nunca estorva a gravação local, que já foi feita */ }
}

let flushing = false;
/** Envia a fila, por ordem. Rede/5xx/401 → para e tenta depois; outra recusa (4xx) → descarta. */
export async function flushCloudMirror(): Promise<void> {
  if (flushing || !auth) return;
  flushing = true;
  try {
    for (;;) {
      const list = (await sharedGet<MirrorOp[]>(KEY)) ?? [];
      const op = list[0];
      if (!op || !auth) break;
      let status = 0;
      let detalhe = '';
      try {
        const ctrl = new AbortController();
        const t = window.setTimeout(() => ctrl.abort(), 60_000);
        const res = await fetch(`${CLOUD_API_URL}${op.path}`, {
          method: op.method,
          headers: {
            'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}`,
            'X-Tenant-Code': auth.companyCode, 'X-Client-Op-Id': op.id,
          },
          body: op.body === undefined ? undefined : JSON.stringify(op.body),
          signal: ctrl.signal,
        });
        window.clearTimeout(t);
        status = res.status;
        if (status === 400) detalhe = await res.text().catch(() => '');
      } catch { status = 0; }
      if (status === 0 || status >= 500 || status === 401 || status === 429 || status === 408) break;
      // Nuvem ainda numa versão anterior (não conhece `id`/`mustResetPw`): guarda e
      // tenta depois — descartar perdia o funcionário criado no posto.
      if (status === 400 && /should not exist/.test(detalhe)) break;
      if (status >= 400) console.warn(`[nuvem] funcionário: ${op.method} ${op.path} recusado (${status})`);
      await locked(async () => {
        const atual = (await sharedGet<MirrorOp[]>(KEY)) ?? [];
        await sharedSet(KEY, atual.filter((x) => x.id !== op.id));
      });
    }
  } finally { flushing = false; }
}
