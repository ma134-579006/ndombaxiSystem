/**
 * Verificação de atualizações.
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
import { readSettings } from './settings';

export interface UpdateInfo {
  version: string;
  /** Abaixo desta versão, a app fica bloqueada até atualizar. */
  minSupportedVersion?: string;
  releasedAt?: string;
  notes?: string[];
  fixes?: string[];
  /** Página OFICIAL de downloads — nunca o link direto do armazenamento. */
  downloadPageUrl: string;
  mandatory?: boolean;
}

export interface UpdateVerdict {
  available: boolean;
  mandatory: boolean;
  current: string;
  info?: UpdateInfo;
}

/** Compara versões semânticas. `-1` se a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Pergunta ao servidor se há versão nova. Devolve sempre — nunca lança.
 */
export async function checkForUpdates(): Promise<UpdateVerdict> {
  const current = app.getVersion();
  const verdict: UpdateVerdict = { available: false, mandatory: false, current };

  const { apiUrl } = readSettings();
  if (!apiUrl) return verdict;

  try {
    const ctrl = new AbortController();
    // Curto de propósito: isto corre em segundo plano e não interessa a ninguém
    // esperar 30 s por uma verificação opcional.
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(`${apiUrl}/downloads/latest?platform=windows`, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return verdict;

    const info = (await res.json()) as UpdateInfo;
    if (!info?.version) return verdict;

    verdict.info = info;
    verdict.available = compareVersions(current, info.version) < 0;
    // Obrigatória por indicação explícita OU por a versão instalada ter caído
    // abaixo do mínimo suportado (ex.: mudança fiscal que torna a antiga ilegal).
    verdict.mandatory = Boolean(
      info.mandatory ||
      (info.minSupportedVersion && compareVersions(current, info.minSupportedVersion) < 0),
    );
    return verdict;
  } catch {
    // Sem rede, DNS em baixo, servidor a dormir: a app segue o seu caminho.
    return verdict;
  }
}

/** Abre a página oficial de downloads no navegador do sistema. */
export async function openDownloadPage(info: UpdateInfo): Promise<void> {
  const url = info.downloadPageUrl;
  // Só abrimos http(s). Sem isto, um servidor comprometido podia devolver um
  // `file://` ou um esquema de aplicação e transformar a atualização num vetor
  // de execução na máquina do cliente.
  if (!/^https?:\/\//i.test(url)) return;
  await shell.openExternal(url);
}

/** Verifica em segundo plano e avisa a janela quando houver novidade. */
export function scheduleUpdateCheck(win: BrowserWindow): void {
  const run = async () => {
    const verdict = await checkForUpdates();
    if (verdict.available && !win.isDestroyed()) {
      win.webContents.send('ndombaxi:update-available', verdict);
    }
  };
  // 5 s depois de abrir — a app já está a ser usada, ninguém repara.
  setTimeout(() => { void run(); }, 5_000);
  // E de 6 em 6 horas, para postos que ficam ligados dias seguidos.
  setInterval(() => { void run(); }, 6 * 60 * 60 * 1000);
}
