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
import { API_URL } from '../config';

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
  accessToken: string; companyCode: string; role: string; busy?: boolean;
}): Promise<void> {
  const h = host();
  if (!h?.provisionLocal) return;
  try {
    await h.provisionLocal({
      accessToken: input.accessToken,
      companyCode: input.companyCode,
      apiUrl: API_URL,
      role: input.role,
      busy: input.busy === true,
    });
  } catch {
    /* o posto regista o motivo; aqui não se estorva o utilizador */
  }
}
