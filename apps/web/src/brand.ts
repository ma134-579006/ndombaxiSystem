export const SYSTEM_NAME = 'Ndombaxi System';
export const AUTHOR = 'Manuel Mbala Tomás Ndombaxi';
export const LOGO_SRC = '/logo.png';

export function copyrightLine(year: number = new Date().getFullYear()): string {
  return `© ${year} ${SYSTEM_NAME} — Desenvolvido por ${AUTHOR}`;
}
