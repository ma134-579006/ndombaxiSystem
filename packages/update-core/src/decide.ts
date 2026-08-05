/**
 * QUANDO uma versão instalada deixa de poder ser usada.
 *
 * Toda a decisão vive aqui, longe da interface e do Electron, porque é a peça
 * que pode **trancar um lojista fora do seu próprio negócio**. Uma regra errada
 * espalhada por `if`s em três aplicações não se consegue verificar; aqui
 * verifica-se.
 *
 * Três princípios, e a razão de cada um:
 *
 * 1. **A versão oficial vem SEMPRE do servidor.** Nada do que o cliente guardou
 *    conta. Não há "já sabia que era obrigatória" gravado no disco: se não se
 *    conseguir falar com o servidor oficial, não se bloqueia (ver 2).
 *
 * 2. **Sem resposta do servidor, não se bloqueia.** Uma loja em Malanje sem
 *    internet durante cinco dias tem de continuar a vender. Bloquear por falta
 *    de rede seria transformar uma falha da operadora numa paragem do negócio.
 *
 * 3. **Nunca se tranca alguém sem lhe dar a saída.** Se a versão está marcada
 *    como obrigatória mas não veio uma página de downloads utilizável (https),
 *    a decisão desce a AVISO. Bloquear sem caminho para atualizar é o pior de
 *    todos os desfechos: o utilizador fica parado e sem nada que possa fazer.
 */

/** O que o servidor oficial publica sobre uma versão. */
export interface OfficialRelease {
  platform: string;
  version: string;
  minSupported: string | null;
  downloadPageUrl: string | null;
  notes: string[];
  fixes: string[];
  mandatory: boolean;
  releasedAt: string | null;
  /** Ausente = produção. Uma versão de teste nunca tranca quem está em produção. */
  channel: string;
}

export type UpdateState = 'none' | 'optional' | 'mandatory';

export interface UpdateDecision {
  state: UpdateState;
  /** Versão instalada, como foi lida da aplicação. */
  current: string;
  release: OfficialRelease | null;
  /** Sempre preenchido — vai para o registo de diagnóstico do posto. */
  reason: string;
}

const NONE = (current: string, reason: string): UpdateDecision =>
  ({ state: 'none', current, release: null, reason });

/**
 * Compara versões (1.2.10 > 1.2.9). Partes não numéricas contam como 0, para um
 * `1.3.0-beta` nunca se comportar de forma imprevisível.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Uma versão utilizável tem pelo menos um número. `''`, `null`, lixo → não. */
export function isUsableVersion(v: unknown): v is string {
  return typeof v === 'string' && /^\d+(\.\d+)*/.test(v.trim());
}

/** Só `https`. Um servidor comprometido não vai mandar o lojista a um `file://`. */
export function isSafeDownloadPage(url: unknown): url is string {
  return typeof url === 'string' && /^https:\/\/[^\s]+$/i.test(url.trim());
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Lê a resposta do servidor com desconfiança.
 *
 * `expectedPlatform` não é zelo a mais: se um erro do servidor devolvesse a
 * versão do **Android** a um posto **Windows**, a comparação `1.1.6 < 3.0.0`
 * trancava todas as caixas Windows do país de uma vez.
 */
export function parseRelease(raw: unknown, expectedPlatform: string): OfficialRelease | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isUsableVersion(r.version)) return null;
  if (typeof r.platform !== 'string' || r.platform !== expectedPlatform) return null;
  return {
    platform: r.platform,
    version: (r.version as string).trim(),
    minSupported: isUsableVersion(r.minSupported) ? r.minSupported.trim() : null,
    downloadPageUrl: isSafeDownloadPage(r.downloadPageUrl) ? r.downloadPageUrl.trim() : null,
    notes: asStringArray(r.notes),
    fixes: asStringArray(r.fixes),
    mandatory: r.mandatory === true,
    releasedAt: typeof r.releasedAt === 'string' ? r.releasedAt : null,
    channel: typeof r.channel === 'string' && r.channel.trim() ? r.channel.trim() : 'production',
  };
}

export interface DecideOptions {
  /** Plataforma desta aplicação: `windows`, `android`, `ios`. */
  platform: string;
  /** Canal desta instalação. Por omissão, produção. */
  channel?: string;
}

/**
 * A decisão. `raw` é o corpo tal como veio do servidor oficial (ou `null` se
 * não houve resposta — sem rede, servidor a dormir, tempo esgotado).
 */
export function decideUpdate(
  currentRaw: unknown,
  raw: unknown,
  opts: DecideOptions,
): UpdateDecision {
  const current = typeof currentRaw === 'string' ? currentRaw.trim() : '';

  // Não sabemos que versão está instalada: nunca bloquear às cegas.
  if (!isUsableVersion(current)) return NONE(current, 'versão instalada desconhecida');

  // Sem resposta do servidor = offline. A app trabalha, e verifica-se depois.
  if (raw == null) return NONE(current, 'sem resposta do servidor oficial');

  const release = parseRelease(raw, opts.platform);
  if (!release) return NONE(current, 'resposta do servidor inválida ou de outra plataforma');

  // Canal: uma versão de teste publicada por engano não pode trancar as lojas.
  const channel = opts.channel?.trim() || 'production';
  if (release.channel !== channel) {
    return NONE(current, `versão do canal "${release.channel}" ignorada (este posto é "${channel}")`);
  }

  const isNewer = compareVersions(current, release.version) < 0;
  const belowMinimum = release.minSupported != null
    && compareVersions(current, release.minSupported) < 0;

  // Abaixo do mínimo suportado sem haver versão mais recente é uma publicação
  // incoerente (mínimo acima do que existe). Não se tranca por um erro de quem
  // publicou.
  if (!isNewer) return NONE(current, 'já está na versão publicada mais recente');

  const obrigatoria = release.mandatory || belowMinimum;
  if (!obrigatoria) {
    return { state: 'optional', current, release, reason: 'há uma versão mais recente' };
  }

  // Obrigatória, mas sem caminho para atualizar → só avisa. Trancar aqui deixava
  // o utilizador parado e sem nada que pudesse fazer.
  if (!release.downloadPageUrl) {
    return {
      state: 'optional',
      current,
      release,
      reason: 'obrigatória, mas sem página oficial de downloads válida — não se tranca sem saída',
    };
  }

  return {
    state: 'mandatory',
    current,
    release,
    reason: belowMinimum
      ? `versão instalada abaixo do mínimo suportado (${release.minSupported})`
      : 'versão publicada como obrigatória',
  };
}
