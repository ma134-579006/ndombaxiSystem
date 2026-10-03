/**
 * Oferece a sessão ao posto para ele trazer a empresa para a base local.
 *
 * Gémeo do ficheiro com o mesmo nome no Gestor, com **uma diferença que só
 * existe aqui**: a Caixa sabe se está a decorrer trabalho. Um turno aberto ou
 * uma venda por fechar tornam este posto o pior sítio do mundo para começar a
 * puxar dezenas de milhares de linhas — o operador tem um cliente à frente.
 *
 * Porque é que a Caixa também oferece a sessão, se o Gestor já o faz: há lojas
 * onde o dono NUNCA abre o Gestor no computador do balcão. Se só o Gestor
 * oferecesse, o posto que mais precisa de funcionar sem internet seria
 * justamente o único a nunca receber a cópia — ficava preso à nuvem para
 * sempre, sem nada na interface a explicar porquê.
 *
 * Este ficheiro não decide nada. Quem decide é o processo principal do Electron
 * (`@nexus/local-server/autoprovision`): é lá que se sabe se os ficheiros do
 * PostgreSQL vieram no instalador, quanto espaço há em disco e quantas
 * tentativas já falharam. E é lá que se exige uma sessão de ADMINISTRADOR — um
 * operador de caixa a entrar num posto emprestado nunca deixa lá a empresa.
 */
import { API_URL, CLOUD_API_URL } from '../config';

interface Host {
  provisionLocal?(session: {
    accessToken: string; companyCode: string; apiUrl: string; role: string; busy?: boolean;
  }): Promise<{ done: boolean; reason?: string; rows?: number }>;
}

function host(): Host | null {
  const w = window as unknown as { ndombaxi?: Host };
  return w.ndombaxi ?? null;
}

/** Este posto é um desktop com servidor local possível? */
export function canHostLocalServer(): boolean {
  return typeof host()?.provisionLocal === 'function';
}

/**
 * A Caixa está ocupada? Escrito pelo ecrã de vendas (turno aberto ou carrinho
 * com artigos), lido na oferta da sessão.
 *
 * É uma variável de módulo, e não estado do React, de propósito: quem escreve
 * (o ecrã de vendas) e quem lê (o contexto de autenticação) não têm relação de
 * pai-e-filho, e pôr isto num contexto novo obrigaria a re-renderizar a grelha
 * de produtos a cada mudança do carrinho — precisamente o "engasgo" que já foi
 * corrigido uma vez neste ecrã.
 */
let busy = false;

/** Chamado pelo ecrã de vendas sempre que o estado de ocupação muda. */
export function setPosBusy(value: boolean): void {
  busy = value;
}

export function isPosBusy(): boolean {
  return busy;
}

/**
 * Diz ao posto que há uma sessão disponível. Best-effort e silencioso: uma
 * falha aqui nunca pode estorvar quem está a cobrar.
 */
export async function offerSessionToHost(input: {
  accessToken: string; companyCode: string; role: string;
}): Promise<void> {
  const h = host();
  if (!h?.provisionLocal) return;
  // Token emitido pelo servidor local não vale na nuvem: não o entregar ao posto
  // (a sincronização ficaria a falar consigo mesma). A Gestão trata da sessão da nuvem.
  if (API_URL !== CLOUD_API_URL) return;
  try {
    await h.provisionLocal({
      accessToken: input.accessToken,
      companyCode: input.companyCode,
      apiUrl: API_URL,
      role: input.role,
      busy,
    });
  } catch {
    /* o posto regista o motivo; aqui não se estorva o operador */
  }
}

let cloudTimer: number | null = null;

/** Papel dentro de um token (só para o posto escolher a sessão; a nuvem verifica tudo). */
function roleOf(token: string): string {
  try {
    const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string };
    return p.role ?? '';
  } catch { return ''; }
}

/**
 * SESSÃO DA NUVEM para a replicação, quando a Caixa trabalha no SERVIDOR LOCAL.
 *
 * O login foi feito contra o posto (token local, que a nuvem não aceita). Em
 * segundo plano entra também na nuvem com as mesmas credenciais e entrega ESSE
 * token ao processo principal — assim as vendas feitas sem internet sobem com a
 * sessão do próprio caixa, sem esperar que um administrador entre. A nuvem só
 * deixa o caixa enviar o que é dele (vendas, turnos, caixa, stock). Sem rede
 * tenta mais tarde; o operador nunca vê nada disto.
 */
export function startCloudSession(cred: { email: string; pin?: string; password?: string; companyCode?: string }): void {
  if (!canHostLocalServer() || API_URL === CLOUD_API_URL) return;
  stopCloudSession();
  let refreshToken: string | null = null;
  const post = async <T,>(path: string, body: unknown): Promise<T> => {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 60_000);
    try {
      const res = await fetch(`${CLOUD_API_URL}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
      });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      return (await res.json()) as T;
    } finally { window.clearTimeout(t); }
  };
  type Pair = { accessToken: string; refreshToken: string; companyCode?: string };
  const tick = async () => {
    try {
      let pair: Pair | null = null;
      if (refreshToken) { try { pair = await post<Pair>('/auth/refresh', { refreshToken }); } catch { refreshToken = null; } }
      if (!pair) {
        pair = cred.pin
          ? await post<Pair>('/auth/login/staff', { email: cred.email, pin: cred.pin })
          : await post<Pair>('/auth/login', { email: cred.email, password: cred.password, ...(cred.companyCode ? { companyCode: cred.companyCode } : {}) });
      }
      refreshToken = pair.refreshToken;
      const code = pair.companyCode ?? cred.companyCode;
      const h = host();
      if (code && h?.provisionLocal) {
        await h.provisionLocal({
          accessToken: pair.accessToken, companyCode: code, apiUrl: CLOUD_API_URL, role: roleOf(pair.accessToken), busy,
        }).catch(() => undefined);
      }
    } catch (e) {
      const st = (e as { status?: number }).status;
      if (st === 401 || st === 403) { stopCloudSession(); return; } // credenciais recusadas pela nuvem
      /* sem rede → próximo ciclo */
    }
  };
  void tick();
  cloudTimer = window.setInterval(() => { void tick(); }, 10 * 60_000);
}

export function stopCloudSession(): void {
  if (cloudTimer) { window.clearInterval(cloudTimer); cloudTimer = null; }
}
