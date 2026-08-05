/**
 * Verificação de atualizações — lado do processo principal.
 *
 * A decisão de trancar ou não **não está aqui**: está em `@nexus/update-core`,
 * partilhada com o Gestor, a Caixa e o Android. Se cada um decidisse à sua
 * maneira, mais cedo ou mais tarde um deles trancava alguém que os outros
 * deixavam trabalhar.
 *
 * Regras vindas do desenho do produto, e a razão de cada uma:
 *   • Corre em segundo plano ao arrancar e NUNCA atrasa a abertura da app. Quem
 *     abre a caixa às 8h tem clientes à espera — não pode ficar preso num ecrã
 *     "a verificar atualizações".
 *   • Falhar é normal e silencioso. Sem internet, a app abre e trabalha. Um erro
 *     de atualização jamais pode impedir alguém de vender.
 *   • O download NUNCA aponta diretamente para o Drive/Mega. Mandamos sempre o
 *     utilizador à página oficial de downloads: é lá que estão o hash e a
 *     assinatura para ele confirmar que o ficheiro não foi trocado no caminho.
 */
import { app, BrowserWindow, shell } from 'electron';
import { decideUpdate, isSafeDownloadPage, type UpdateDecision } from '@nexus/update-core';
import { readSettings } from './settings';

/**
 * Página oficial de downloads, usada só como ÚLTIMO recurso.
 *
 * O botão "Atualizar Agora" nunca pode ficar morto: se a rede caiu entre o
 * momento em que se decidiu trancar e o clique do utilizador, ele ficaria preso
 * num ecrã sem saída. É o nosso próprio site, e a mesma página para onde a
 * publicação normal aponta.
 */
const PAGINA_OFICIAL = 'https://ndombaxisystem.com/baixar';

/** Última decisão conhecida — para o clique não depender de haver rede. */
let ultimaDecisao: UpdateDecision | null = null;

export function lastDecision(): UpdateDecision | null {
  return ultimaDecisao;
}

/** Pergunta ao servidor oficial. Devolve sempre — nunca lança. */
export async function checkForUpdates(): Promise<UpdateDecision> {
  const current = app.getVersion();
  const { apiUrl } = readSettings();

  let raw: unknown = null;
  if (apiUrl) {
    try {
      const ctrl = new AbortController();
      // Curto de propósito: isto corre em segundo plano e não interessa a
      // ninguém esperar 30 s por uma verificação.
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      try {
        const res = await fetch(`${apiUrl}/downloads/latest?platform=windows`, {
          signal: ctrl.signal,
          headers: { Accept: 'application/json' },
        });
        if (res.ok) raw = await res.json();
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Sem rede, DNS em baixo, servidor a dormir: a app segue o seu caminho.
      raw = null;
    }
  }

  const decision = decideUpdate(current, raw, { platform: 'windows' });
  // Só se guarda uma decisão COM conteúdo: uma verificação falhada (offline) não
  // pode apagar o que já se sabia — senão o botão ficava sem destino.
  if (decision.release) ultimaDecisao = decision;
  return decision;
}

/**
 * Abre a página OFICIAL de downloads no navegador do sistema e diz se
 * conseguiu. Só `https` — sem isto, um servidor comprometido podia devolver um
 * `file://` e transformar a atualização num vetor de execução na máquina do
 * cliente.
 */
export async function openDownloadPage(url?: string | null): Promise<boolean> {
  const alvo = isSafeDownloadPage(url) ? url : PAGINA_OFICIAL;
  try {
    await shell.openExternal(alvo);
    return true;
  } catch {
    return false;
  }
}

/**
 * Encerra a aplicação em segurança depois de encaminhar para o download.
 *
 * O atraso não é decoração: dá tempo ao navegador para abrir antes de a janela
 * desaparecer. Fechar no mesmo instante deixava o utilizador a olhar para o
 * ambiente de trabalho sem perceber se alguma coisa aconteceu.
 */
export function quitAfterUpdatePrompt(): void {
  setTimeout(() => { app.quit(); }, 1500);
}

/** Verifica em segundo plano e avisa a janela quando houver novidade. */
export function scheduleUpdateCheck(win: BrowserWindow): void {
  const run = async () => {
    const decision = await checkForUpdates();
    if (decision.state !== 'none' && !win.isDestroyed()) {
      win.webContents.send('ndombaxi:update-available', decision);
    }
  };
  // 5 s depois de abrir — a app já está a ser usada, ninguém repara.
  setTimeout(() => { void run(); }, 5_000);
  // E de 6 em 6 horas, para postos que ficam ligados dias seguidos.
  setInterval(() => { void run(); }, 6 * 60 * 60 * 1000);
}
