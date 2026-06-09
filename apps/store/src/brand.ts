/** Assinatura permanente do sistema (autoria) — presente em toda a montra. */
export const SYSTEM_NAME = 'Ndombaxi System';
export const AUTHOR = 'Manuel Mbala Tomás Ndombaxi';

export function copyrightLine(year: number = new Date().getFullYear()): string {
  return `© ${year} ${SYSTEM_NAME}`;
}
