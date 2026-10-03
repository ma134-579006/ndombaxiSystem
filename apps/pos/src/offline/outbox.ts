/**
 * FILA DE ESCRITA OFFLINE DO CAIXA (cópia da do Gestão, com chave própria).
 *
 * Qualquer alteração feita SEM REDE (criar, editar, eliminar em qualquer módulo)
 * fica guardada na memória do aparelho e sobe sozinha quando a ligação volta. É o
 * padrão "outbox + idempotência" das apps offline: cada operação leva um UUID
 * (`X-Client-Op-Id`) e o servidor devolve a resposta guardada se a receber duas
 * vezes — por isso uma resposta perdida nunca duplica nada.
 *
 * O que NÃO entra (exige servidor/tempo real ou tem efeito fiscal imediato):
 * chats, notificações, IA, pagamentos, emissão/anulação de documentos fiscais,
 * processamento de folha, autenticação, ficheiros. As VENDAS do balcão têm o seu
 * próprio motor (`/sync/push`) e não passam por aqui.
 *
 * Tudo best-effort e tolerante a falhas: guardar na fila nunca pode rebentar a app.
 */
import { sharedGet, sharedSet } from '../sharedCache';

export interface OutboxOp {
  id: string; method: string; path: string; body?: unknown; createdAt: number;
  /** Id provisório atribuído a um registo criado offline (para o trocar pelo definitivo). */
  localId?: string;
}
export interface OutboxFailure extends OutboxOp { status: number; message: string; at: number }

const KEY = 'outbox:pos:v1';
const FAIL_KEY = 'outbox:pos:failed:v1';
const IDMAP_KEY = 'outbox:pos:idmap:v1';

/**
 * Id definitivo de um registo criado SEM REDE (ex.: cliente escolhido numa venda
 * em fila). `undefined` = ainda não subiu; `null` = já não está na fila e nunca
 * teve id (a criação foi recusada).
 */
export async function resolveLocalId(localId: string): Promise<string | null | undefined> {
  const mapa = (await sharedGet<Record<string, string>>(IDMAP_KEY)) ?? {};
  if (mapa[localId]) return mapa[localId];
  const pendente = (await load()).some((op) => op.localId === localId);
  return pendente ? undefined : null;
}

/** Nunca em fila: tempo real, fiscal, pagamentos, autenticação, ficheiros, motores próprios. */
const NEVER = /\/(auth|chat|customer-chat|support|assistant|agent|ai|notifications?|subscription|payments?|gateways?|platform|super|tenants?|downloads?|fiscal|saft|einvoice|agt|invoices?|credit-notes?|cancel|emit|sales|payroll|backup|migration|upload|sync|devices?|register|login|logout|refresh|password|pin|google|close|pay|checkout|check-out|check-in|bill|issue|folio|deliver|void|refund|returns?|cashbox|cash-sessions?|shifts?|cart-draft)(\/|$|\?)/i;

/**
 * Exceções à lista acima: são CRUD da empresa (não fiscais, não tempo real) e o
 * servidor processa-as quando chegam, com o mesmo X-Client-Op-Id (nunca em
 * dobro). Sem isto, editar o perfil, as formas de pagamento ou registar um
 * pagamento sem rede dava erro em vez de ficar guardado.
 */
const ALLOW = [
  /^\/auth\/me\/preferences$/,                       // perfil (tema, foto, nome)
  /^\/payments\/methods(\/[^/]+)?$/,                  // formas de pagamento (configuração)
  /^\/(receivables|payables)\/[^/]+\/payment$/,        // pagamento registado (recibo emitido na nuvem)
  /^\/inventory\/counts\/[^/]+\/close$/,              // fecho de contagem de stock
  /^\/clinic\/prescriptions\/[^/]+\/cancel$/,         // anular receita (não fiscal)
  /^\/hotel\/folio\/[^/]+$/,                          // apagar consumo do folio
  /^\/hotel\/reservations\/[^/]+\/folio$/,            // lançar consumo no folio
  /^\/ecommerce\/orders\/[^/]+\/(cancel|deliver)$/,   // estado da encomenda
];

export function canQueue(method: string, path: string): boolean {
  const m = method.toUpperCase();
  if (m !== 'POST' && m !== 'PUT' && m !== 'PATCH' && m !== 'DELETE') return false;
  const p = path.split('?')[0].replace(/\/$/, '');
  if (ALLOW.some((re) => re.test(p))) return true;
  return !NEVER.test(p);
}

const uuid = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));

export const newOpId = (): string => uuid();

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
export const withSnake = (o: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...o };
  for (const [k, v] of Object.entries(o)) if (/[A-Z]/.test(k)) out[snake(k)] = v;
  return out;
};

type Listener = (count: number) => void;
const listeners = new Set<Listener>();
let cache: OutboxOp[] | null = null;
let chain: Promise<unknown> = Promise.resolve();
/** Serializa as operações sobre a fila (sem corridas entre enfileirar e reenviar). */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.then(() => undefined, () => undefined);
  return next;
}

async function load(): Promise<OutboxOp[]> {
  if (cache) return cache;
  cache = (await sharedGet<OutboxOp[]>(KEY)) ?? [];
  return cache;
}
async function save(list: OutboxOp[]): Promise<void> {
  cache = list;
  await sharedSet(KEY, list);
  listeners.forEach((l) => l(list.length));
}

export function subscribeOutbox(fn: Listener): () => void {
  listeners.add(fn);
  void load().then((l) => fn(l.length));
  return () => { listeners.delete(fn); };
}
export async function outboxCount(): Promise<number> { return (await load()).length; }
export async function failedWrites(): Promise<OutboxFailure[]> { return (await sharedGet<OutboxFailure[]>(FAIL_KEY)) ?? []; }
export async function clearFailedWrites(): Promise<void> { await sharedSet(FAIL_KEY, []); }

/** Atualiza a cópia local das listas para a interface já mostrar a alteração (best-effort). */
async function patchCache(method: string, path: string, body: unknown, localId?: string): Promise<void> {
  try {
    const clean = path.split('?')[0].replace(/\/$/, '');
    const parts = clean.split('/');
    const m = method.toUpperCase();
    const last = parts[parts.length - 1];
    const isItem = m !== 'POST' && /^[0-9a-f-]{8,}$/i.test(last);
    const listPath = isItem ? parts.slice(0, -1).join('/') : clean;
    const listKey = `GET ${listPath}`;
    const list = await sharedGet<unknown>(listKey);
    if (!Array.isArray(list)) return;
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    let next: unknown[] = list;
    if (m === 'POST') next = [...list, { ...withSnake(b), id: localId, __offline: true, is_active: true }];
    else if (m === 'DELETE') next = list.filter((x) => (x as { id?: string })?.id !== last);
    else next = list.map((x) => ((x as { id?: string })?.id === last ? { ...(x as object), ...withSnake(b), __offline: true } : x));
    await sharedSet(listKey, next);
  } catch { /* cópia local é um bónus; nunca falha a gravação */ }
}

/** Guarda a alteração e devolve uma resposta provisória (a interface continua como se tivesse gravado). */
export async function enqueueWrite(method: string, path: string, body: unknown, opId?: string): Promise<unknown> {
  const m = method.toUpperCase();
  const id = opId ?? uuid();
  const localId = m === 'POST' ? `local-${uuid()}` : undefined;
  await locked(async () => {
    const list = await load();
    await save([...list, { id, method: m, path, body, createdAt: Date.now(), localId }]);
  });
  await patchCache(m, path, body, localId);
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (m === 'DELETE') return { ok: true, offline: true };
  if (m === 'POST') return { ...withSnake(b), id: localId, offline: true };
  return { ...withSnake(b), offline: true };
}

export type SendResult = { ok: true; data: unknown } | { ok: false; status: number; message: string; retry: boolean };

/**
 * Reenvia a fila, por ordem. 4xx = o servidor recusou (guarda em "falhadas" para o
 * utilizador ver); rede/5xx = para e volta a tentar mais tarde. Devolve quantas subiram.
 */
export async function replayOutbox(send: (op: OutboxOp) => Promise<SendResult>): Promise<number> {
  return locked(async () => {
    let sent = 0;
    for (;;) {
      const list = await load();
      const op = list[0];
      if (!op) break;
      const r = await send(op);
      if (r.ok) {
        // Troca o id provisório pelo definitivo nas operações seguintes.
        let rest = list.slice(1);
        const serverId = (r.data && typeof r.data === 'object' ? (r.data as { id?: unknown }).id : undefined);
        if (op.localId && typeof serverId === 'string') {
          const s = JSON.stringify(rest).split(op.localId).join(serverId);
          try { rest = JSON.parse(s) as OutboxOp[]; } catch { /* mantém */ }
          const mapa = (await sharedGet<Record<string, string>>(IDMAP_KEY)) ?? {};
          await sharedSet(IDMAP_KEY, { ...mapa, [op.localId]: serverId });
        }
        await save(rest);
        sent++;
        continue;
      }
      if (r.retry) break; // sem rede / servidor ocupado: tenta mais tarde
      const fails = await failedWrites();
      await sharedSet(FAIL_KEY, [...fails, { ...op, status: r.status, message: r.message, at: Date.now() }].slice(-50));
      await save(list.slice(1));
      window.dispatchEvent(new CustomEvent('ndombaxi:outbox-failed', { detail: { op, message: r.message } }));
    }
    return sent;
  });
}
