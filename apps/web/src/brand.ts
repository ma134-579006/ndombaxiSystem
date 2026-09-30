export const SYSTEM_NAME = 'LPS Vendas';
export const AUTHOR = 'Manuel Mbala Tomás Ndombaxi';
/** Simbolo (carrinho + LPS), transparente — para espacos quadrados pequenos. */
export const LOGO_SRC = '/logo-mark.svg';
/** Logo completa (com "Vendas"), transparente — para cabecalhos e ecras onde cabe. */
export const LOGO_WIDE = '/logo-horizontal.svg';

export function copyrightLine(year: number = new Date().getFullYear()): string {
  return `© ${year} ${SYSTEM_NAME}`;
}
