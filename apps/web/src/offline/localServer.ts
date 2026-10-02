/**
 * Oferece a sessão ao posto para ele trazer a empresa para a base local.
 *
 * O que este ficheiro **não** faz: decidir. Não há aqui nenhuma regra sobre
 * quando copiar — isso vive no processo principal do Electron
 * (`@nexus/local-server/autoprovision`), onde é testável e onde estão os factos
 * que o navegador não conhece: se os ficheiros do PostgreSQL vieram no
 * instalador, quanto espaço há em disco, quantas tentativas já falharam.
 *
 * Daqui só sai o que só o frontend sabe: **quem** está a usar a aplicação e se
 * há trabalho em curso.
 *
 * Sem botão, por decisão do dono do produto. O utilizador não vê nada disto: ou
 * corre, ou fica adiado com o motivo escrito no registo do posto.
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
 * Diz ao posto que há uma sessão disponível. Best-effort e silencioso: uma
 * falha aqui nunca pode estorvar quem está a trabalhar.
 *
 * `busy` é a única heurística que só o frontend consegue dar — se houver um
 * turno de caixa aberto, a cópia (que são milhares de linhas) fica para depois
 * em vez de roubar a máquina a quem está a cobrar.
 */
export async function offerSessionToHost(input: {
  accessToken: string; companyCode: string; role: string; busy?: boolean; apiUrl?: string;
}): Promise<void> {
  const h = host();
  if (!h?.provisionLocal) return;
  // Com o SERVIDOR LOCAL em uso, o token desta sessão foi emitido pelo próprio
  // posto e não vale na nuvem — a sincronização ficaria a enviar para si mesma.
  // Nesse caso quem alimenta o posto é a sessão da nuvem (startCloudSession).
  const apiUrl = input.apiUrl ?? API_URL;
  if (apiUrl !== CLOUD_API_URL) return;
  try {
    await h.provisionLocal({
      accessToken: input.accessToken,
      companyCode: input.companyCode,
      apiUrl,
      role: input.role,
      busy: input.busy === true,
    });
  } catch {
    /* o posto regista o motivo; aqui não se estorva o utilizador */
  }
}

/** O posto está a trabalhar contra o servidor local (não contra a nuvem)? */
export function usingLocalServer(): boolean {
  return canHostLocalServer() && API_URL !== CLOUD_API_URL;
}

let cloudTimer: number | null = null;

/**
 * SESSÃO DA NUVEM para a sincronização, quando o posto trabalha no servidor local.
 *
 * O login foi feito contra o servidor local (token local). Em segundo plano, com
 * as mesmas credenciais, entra também na nuvem e entrega ESSE token ao processo
 * principal, renovando-o antes de expirar. Sem rede tenta de novo mais tarde; o
 * utilizador nunca espera por isto nem vê erros.
 */
export function startCloudSession(input: { email: string; password: string; companyCode?: string; role: string }): void {
  if (!usingLocalServer()) return;
  stopCloudSession();
  let refreshToken: string | null = null;
  const post = async <T,>(path: string, body: unknown): Promise<T> => {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 60_000);
    try {
      const res = await fetch(`${CLOUD_API_URL}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: ctrl.signal,
      });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      return (await res.json()) as T;
    } finally { window.clearTimeout(t); }
  };
  const tick = async () => {
    try {
      let pair: { accessToken: string; refreshToken: string; companyCode?: string } | null = null;
      if (refreshToken) {
        try { pair = await post('/auth/refresh', { refreshToken }); } catch { refreshToken = null; }
      }
      if (!pair) {
        pair = await post<{ accessToken: string; refreshToken: string; companyCode?: string }>('/auth/login', {
          email: input.email, password: input.password,
          ...(input.companyCode ? { companyCode: input.companyCode } : {}),
        });
      }
      const ok = pair as { accessToken: string; refreshToken: string; companyCode?: string };
      refreshToken = ok.refreshToken;
      const code = input.companyCode ?? ok.companyCode;
      if (code) {
        await offerSessionToHost({ accessToken: ok.accessToken, companyCode: code, role: input.role, apiUrl: CLOUD_API_URL });
      }
    } catch (e) {
      // Credenciais recusadas pela nuvem (ex.: senha mudada noutro aparelho): parar.
      const st = (e as { status?: number }).status;
      if (st === 401 || st === 403) { stopCloudSession(); return; }
      /* sem rede / nuvem a acordar → tenta no próximo ciclo */
    }
  };
  void tick();
  cloudTimer = window.setInterval(() => { void tick(); }, 10 * 60_000); // token de acesso dura 15 min
}

export function stopCloudSession(): void {
  if (cloudTimer) { window.clearInterval(cloudTimer); cloudTimer = null; }
}
