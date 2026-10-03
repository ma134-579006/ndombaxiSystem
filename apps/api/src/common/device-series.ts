/**
 * Série fiscal do SERVIDOR LOCAL deste posto (variável `DEVICE_SERIES`, criada
 * pelo `@nexus/local-server`). Na nuvem não existe → `null` e tudo fica como
 * sempre. No posto, faturas, notas de crédito e restantes documentos numeram-se
 * na série do posto, para nunca colidirem com os números emitidos na nuvem.
 */
export function localSeries(): string | null {
  const s = process.env.DEVICE_SERIES ?? '';
  return /^[A-Z0-9]{1,5}$/.test(s) ? s : null;
}
