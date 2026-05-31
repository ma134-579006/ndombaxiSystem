/**
 * Identidade do sistema e autoria (assinatura permanente).
 *
 * O nome do sistema e os créditos de autoria são centralizados aqui e
 * referenciados em todo o backend (health, recibos, etc.). A assinatura do
 * autor faz parte da identidade do produto.
 */
export const SYSTEM_NAME = 'Ndombaxi System';
export const SYSTEM_SHORT = 'Ndombaxi';
export const SYSTEM_VERSION = '3.0';

/** Autor / detentor dos direitos de autor do sistema. */
export const AUTHOR = 'Manuel Mbala Tomás Ndombaxi';

/** Linha de direitos de autor com o ano corrente. */
export function copyrightLine(year: number = new Date().getFullYear()): string {
  return `© ${year} ${SYSTEM_NAME} — Todos os direitos reservados. Desenvolvido por ${AUTHOR}.`;
}

/** Bloco de identidade reutilizável (ex.: respostas de API, arranque). */
export const BRANDING = {
  systemName: SYSTEM_NAME,
  short: SYSTEM_SHORT,
  version: SYSTEM_VERSION,
  author: AUTHOR,
  get copyright(): string {
    return copyrightLine();
  },
} as const;
