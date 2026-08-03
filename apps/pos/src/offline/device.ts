/**
 * IDENTIDADE DESTE POSTO — e, por consequência, a sua série fiscal.
 *
 * Porque é que um posto precisa de identidade: cada documento fiscal leva o
 * hash do documento anterior da MESMA série. Isso torna cada série
 * estritamente sequencial e com um só escritor. Se duas caixas emitirem na
 * mesma série sem rede, ficam duas cadeias divergentes com a mesma numeração —
 * e isso não se corrige depois, porque os documentos já foram entregues aos
 * clientes. A defesa é dar a cada posto a SUA série, e para isso o servidor
 * precisa de saber, sem hesitação, qual posto está a falar com ele.
 *
 * Daí a exigência mais importante deste ficheiro: a chave tem de ser **estável**.
 * Se mudar a cada arranque, cada arranque cria uma série nova, e um único
 * computador acaba com dezenas de cadeias fiscais — um SAF-T impossível de ler.
 * Por isso é gravada em dois sítios (localStorage + IndexedDB espelhado): se um
 * falhar — e o IndexedDB falha em silêncio — a identidade sobrevive no outro.
 */
import { durableGet, durableSet } from '../sharedCache';

const KEY = 'device:key';
/** Mesmo nome nos dois armazenamentos, para se reencontrarem. */
const MIRROR = 'ndombaxi.device.key';

/** UUID v4 com o gerador do sistema (não `Math.random`). */
function newKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * A chave deste posto, criando-a na primeira vez.
 *
 * O `localStorage` é lido primeiro por ser síncrono e por ser o que sobrevive
 * melhor: é dele que depende a identidade não mudar entre arranques.
 */
export async function deviceKey(): Promise<string> {
  try {
    const local = localStorage.getItem(MIRROR);
    if (local && local.length >= 8) {
      // Garante o espelho do outro lado, caso tenha sido perdido.
      void durableSet(KEY, local);
      return local;
    }
  } catch { /* sem localStorage — tenta o durável */ }

  try {
    const stored = await durableGet<string>(KEY);
    if (stored && stored.length >= 8) {
      try { localStorage.setItem(MIRROR, stored); } catch { /* ignora */ }
      return stored;
    }
  } catch { /* nada guardado */ }

  const fresh = newKey();
  try { localStorage.setItem(MIRROR, fresh); } catch { /* ignora */ }
  await durableSet(KEY, fresh);
  return fresh;
}

/** Nome legível por omissão, para o gestor reconhecer o posto na lista. */
function defaultName(): string {
  const w = window as unknown as { ndombaxi?: unknown; __NDOMBAXI_NATIVE__?: boolean };
  if (window.location.protocol === 'ndombaxi:' || typeof w.ndombaxi !== 'undefined') {
    return 'Caixa (Windows)';
  }
  if (w.__NDOMBAXI_NATIVE__ === true) return 'Caixa (Android)';
  return 'Caixa (navegador)';
}

function platform(): string {
  const w = window as unknown as { ndombaxi?: unknown; __NDOMBAXI_NATIVE__?: boolean };
  if (window.location.protocol === 'ndombaxi:' || typeof w.ndombaxi !== 'undefined') return 'windows';
  if (w.__NDOMBAXI_NATIVE__ === true) return 'android';
  return 'web';
}

/**
 * Apresenta o posto ao servidor e guarda a série que ele atribuir.
 *
 * Idempotente dos dois lados: o servidor devolve sempre a mesma série para a
 * mesma chave. Falha em silêncio — sem rede não há nada a fazer, e a série
 * antiga (ou a ausência dela) continua a servir.
 */
export async function registerDevice(): Promise<string | null> {
  try {
    const key = await deviceKey();
    const { api } = await import('../api/client');
    const d = await api.registerDevice({ deviceKey: key, name: defaultName(), platform: platform() });
    await durableSet('device:series', d.series);
    return d.series;
  } catch {
    return null;
  }
}

/** A série atribuída a este posto (null enquanto nunca se registou). */
export async function deviceSeries(): Promise<string | null> {
  try { return await durableGet<string>('device:series'); } catch { return null; }
}
