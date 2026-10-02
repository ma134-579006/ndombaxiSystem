/** Identidade do sistema e autoria (assinatura permanente). */
export const SYSTEM_NAME = 'LPS Vendas';
export const SYSTEM_SHORT = 'LPS Vendas';
export const SYSTEM_MODULE = 'Caixa · Ponto de Venda';
export const AUTHOR = 'Manuel Mbala Tomás Ndombaxi';
/** Simbolo (carrinho + LPS), transparente — para espacos quadrados pequenos. */
/** Base do build: `/` no site, `./` nas apps (módulo servido de subpasta). */
const BASE = import.meta.env.BASE_URL || '/';
export const LOGO_SRC = `${BASE}logo-mark.png`;
/** Logo completa (com "Vendas"), transparente — para cabecalhos e ecras onde cabe. */
export const LOGO_WIDE = `${BASE}logo-horizontal.png`;

export function copyrightLine(year: number = new Date().getFullYear()): string {
  return `© ${year} ${SYSTEM_NAME}`;
}
