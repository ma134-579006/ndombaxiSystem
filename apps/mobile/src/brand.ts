/** Identidade do sistema e autoria (assinatura permanente). */
export const SYSTEM_NAME = 'LPS Vendas';
export const SYSTEM_SHORT = 'LPS Vendas';
export const SYSTEM_MODULE = 'Gestão · Back-office';
export const AUTHOR = 'Manuel Mbala Tomás Ndombaxi';

export function copyrightLine(year: number = new Date().getFullYear()): string {
  return `© ${year} ${SYSTEM_NAME} — Desenvolvido por ${AUTHOR}`;
}
