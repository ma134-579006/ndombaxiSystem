/**
 * O SERVIDOR DA LOJA visto de dentro do Gestor.
 *
 * Guarda o endereço que o responsável configurou e decide, a cada pedido, se se
 * fala com o computador da loja ou com a nuvem. As REGRAS não estão aqui —
 * estão em `@nexus/shop-link`, provadas à parte. Aqui trata-se só de onde isso
 * fica guardado neste aparelho.
 *
 * O que isto muda na prática: com o servidor da loja configurado, o telemóvel
 * deixa de precisar de internet para o sistema INTEIRO — compras, stock, RH,
 * relatórios. Quem responde é a mesma API, a correr no balcão.
 */
import {
  ESTADO_INICIAL, anotarFalha, anotarSucesso, escolherBase, esquecerLoja, normalizarEndereco,
  type ShopServerState,
} from '@nexus/shop-link';

const CHAVE = 'ndombaxi.shopServer';

function ler(): ShopServerState {
  try {
    const cru = localStorage.getItem(CHAVE);
    if (!cru) return ESTADO_INICIAL;
    const s = JSON.parse(cru) as ShopServerState;
    return typeof s?.url === 'string' || s?.url === null ? { ...ESTADO_INICIAL, ...s } : ESTADO_INICIAL;
  } catch {
    return ESTADO_INICIAL;
  }
}

function gravar(s: ShopServerState): void {
  try { localStorage.setItem(CHAVE, JSON.stringify(s)); } catch { /* armazenamento cheio */ }
}

/** Endereço configurado (independentemente de estar a responder agora). */
export function servidorDaLoja(): string | null {
  return ler().url;
}

/**
 * Liga este aparelho ao servidor da loja. Devolve o erro em português quando o
 * endereço não serve — quem está ao balcão tem de perceber o que correu mal.
 */
export function ligarAoServidorDaLoja(bruto: string): { ok: true; url: string } | { ok: false; motivo: string } {
  const r = normalizarEndereco(bruto);
  if (!r.ok) return r;
  gravar({ ...ESTADO_INICIAL, url: r.url });
  return { ok: true, url: r.url };
}

/** Deixar de usar o servidor da loja e voltar à nuvem. */
export function desligarDoServidorDaLoja(): void {
  gravar(esquecerLoja());
}

/**
 * A base a usar NESTE pedido. Recebe a da nuvem porque é ela que fica quando o
 * servidor da loja não responde — um aparelho que saiu da loja continua a
 * trabalhar em vez de bater num computador que já não alcança.
 */
export function baseParaPedido(nuvem: string): string {
  return escolherBase(ler(), nuvem).base;
}

/** Este pedido saiu para o servidor da loja? (para saber a quem atribuir a falha) */
export function usouServidorDaLoja(nuvem: string): boolean {
  return escolherBase(ler(), nuvem).usandoLoja;
}

/** O servidor da loja não respondeu (silêncio, não uma recusa dele). */
export function anotarFalhaDaLoja(): void {
  const s = ler();
  if (!s.url) return;
  gravar(anotarFalha(s));
}

/** O servidor da loja respondeu — esquece o histórico de falhas. */
export function anotarSucessoDaLoja(): void {
  const s = ler();
  if (!s.url) return;
  const novo = anotarSucesso(s);
  if (novo !== s) gravar(novo);
}
