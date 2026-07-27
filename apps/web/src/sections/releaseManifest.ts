import type { AppPlatform } from '../api/types';

/**
 * MANIFESTO DE VERSÕES — fonte única dos dados que o Assistente de Publicação
 * usa para AUTO-PREENCHER o formulário de "Gestão de Downloads" no Super Admin.
 *
 * O único campo que NÃO vive aqui é o LINK do ficheiro (`fileUrl`): esse é o que
 * o administrador cola de cada vez (Drive/Mega/R2/GitHub), porque muda a cada
 * upload. Tudo o resto — versão, requisitos, novidades, correções, hash — é
 * preenchido a partir deste ficheiro.
 *
 * ➜ COMO ATUALIZAR a cada lançamento: edite a plataforma respetiva abaixo
 *   (suba a `version`, atualize `notes`/`fixes`, e — se souber — cole o `sha256`
 *   do instalador). É a ÚNICA coisa a mexer no código para uma nova versão.
 */
export interface ReleaseManifestEntry {
  /** Versão a publicar (ex.: "1.0.4"). */
  version: string;
  /** Versão mínima ainda suportada (deixe vazio para não obrigar a atualizar). */
  minSupported?: string;
  /** Requisitos mínimos mostrados ao cliente. */
  requirements: string;
  /** Impressão digital SHA-256 do instalador (opcional; cole quando a tiver). */
  sha256?: string;
  /** Página oficial de downloads para onde a app encaminha o cliente. */
  downloadPageUrl?: string;
  /** Novidades desta versão (uma por linha). */
  notes: string[];
  /** Correções desta versão (uma por linha). */
  fixes: string[];
  /** Sugerir "atualização obrigatória" (bloqueia a app antiga). */
  mandatory?: boolean;
}

export const RELEASE_MANIFEST: Record<AppPlatform, ReleaseManifestEntry> = {
  windows: {
    version: '1.0.4',
    minSupported: '1.0.0',
    requirements: 'Windows 10 ou 11 · 64-bit',
    notes: [
      'Faturas A4 com desenho profissional (cabeçalho, adquirente e resumo de impostos)',
      'Recibo térmico mais legível e sempre dentro da largura do papel',
      'Sincronização mais estável ao voltar de segundo plano',
    ],
    fixes: [
      'Corrigido o recibo cujos dados saíam para fora da estrutura',
      'Correções de desempenho no arranque',
    ],
  },
  android: {
    version: '1.0.4',
    minSupported: '1.0.0',
    requirements: 'Android 6 ou superior',
    notes: [
      'Ícone e nome do Ndombaxi no instalador e no ambiente do telemóvel',
      'Faturas A4 com desenho profissional',
      'Recibo térmico sempre dentro da largura do papel',
    ],
    fixes: [
      'Corrigido: tocar em Caixa ou Gestão no ecrã inicial não abria o módulo',
      'Corrigido o recibo cujos dados saíam para fora da estrutura',
    ],
  },
  ios: {
    version: '1.0.4',
    minSupported: '1.0.0',
    requirements: 'iOS 13 ou superior',
    notes: [
      'Faturas A4 com desenho profissional',
      'Recibo térmico sempre dentro da largura do papel',
    ],
    fixes: [
      'Corrigido o recibo cujos dados saíam para fora da estrutura',
    ],
  },
};

/* ── Ponte de PRÉ-PREENCHIMENTO ────────────────────────────────────────────
   O Assistente (uma página) e o formulário de Downloads são secções distintas.
   Para o Assistente "redirecionar e auto-preencher", deixamos o pacote de dados
   no sessionStorage; a secção Downloads lê-o ao montar, preenche o formulário e
   limpa a chave. Simples e desacoplado. */
const PREFILL_KEY = 'ndombaxi.downloads.prefill';

export interface DownloadPrefill {
  platform: AppPlatform;
  version: string;
  minSupported: string;
  requirements: string;
  sha256: string;
  downloadPageUrl: string;
  fileUrl: string;
  notes: string[];
  fixes: string[];
  mandatory: boolean;
}

/** Monta o pacote de pré-preenchimento a partir do manifesto + link colado. */
export function prefillFromManifest(platform: AppPlatform, fileUrl: string): DownloadPrefill {
  const m = RELEASE_MANIFEST[platform];
  const link = fileUrl.trim();
  return {
    platform,
    version: m.version,
    minSupported: m.minSupported ?? '',
    requirements: m.requirements,
    sha256: m.sha256 ?? '',
    // A "página de downloads" é para onde o botão público encaminha. Se o
    // manifesto não define uma, usamos o próprio link colado — assim UM link
    // basta para o download funcionar. A página /baixar do site é o hub que
    // lista as plataformas e abre estes destinos.
    downloadPageUrl: m.downloadPageUrl ?? link,
    fileUrl: link,
    notes: m.notes,
    fixes: m.fixes,
    mandatory: m.mandatory ?? false,
  };
}

export function stashPrefill(p: DownloadPrefill): void {
  try { sessionStorage.setItem(PREFILL_KEY, JSON.stringify(p)); } catch { /* modo privado */ }
}

/** Lê e CONSOME (apaga) o pré-preenchimento, se existir. */
export function consumePrefill(): DownloadPrefill | null {
  try {
    const raw = sessionStorage.getItem(PREFILL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PREFILL_KEY);
    return JSON.parse(raw) as DownloadPrefill;
  } catch { return null; }
}
