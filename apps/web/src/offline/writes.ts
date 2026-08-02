/**
 * ESCRITA offline no painel de gestão — uma funcionalidade de cada vez.
 *
 * A tentação é óbvia: apanhar todos os POST/PATCH no cliente de API e enfileirar
 * automaticamente. Seria errado e perigoso. Uma fila genérica reenviaria também
 * emissões fiscais, anulações e movimentos de stock, e bastava uma resposta
 * perdida para nascer um documento em duplicado ou a numeração da AGT ganhar um
 * salto. Por isso a regra desta camada é: só entra aqui o que o servidor SABE
 * receber de forma idempotente, entidade a entidade, com o `/sync/push` a
 * decidir — que é quem conhece as regras de negócio.
 *
 * O servidor aceita hoje: `sale`, `customer`, `cashSession`, `cashMovement`.
 * Aqui usamos `customer`, que é a única não-fiscal e a mais segura para abrir o
 * caminho: um cliente criado sem rede não altera contas, stock nem impostos.
 */
import { getOfflineEngine } from './boot';

export interface OfflineWriteResult<T> {
  /** `true` quando ficou em fila (sem rede) em vez de gravado no servidor. */
  queued: boolean;
  /** Estado a mostrar já na interface (o registo tal como ficará). */
  data: T;
}

/** Sem rede? Não perguntamos ao `navigator` — ver a nota no cliente de API. */
export function isNetworkError(e: unknown): boolean {
  return typeof e === 'object' && e !== null
    && (e as { status?: number }).status === 0;
}

/**
 * Grava um cliente; se não houver rede, deixa-o em fila e devolve-o para a
 * interface continuar como se tivesse gravado. O registo sobe sozinho quando a
 * ligação voltar — sem botão "sincronizar", sem o utilizador ter de saber.
 *
 * @param localId  id do cliente a ATUALIZAR. Omisso = criação.
 * @returns `null` se não houver motor offline (então o erro original deve subir).
 */
export async function queueCustomer<T extends Record<string, unknown>>(
  payload: T,
  localId?: string,
): Promise<OfflineWriteResult<T & { id: string }> | null> {
  const engine = getOfflineEngine();
  if (!engine) return null;
  const id = await engine.enqueue({
    entity: 'customer',
    op: localId ? 'update' : 'create',
    payload,
    localId,
    optimistic: payload,
  });
  // Na criação, o id devolvido é LOCAL: o servidor emite o definitivo ao receber
  // a operação e o motor reescreve as referências (é para isso que ele mantém o
  // mapa de ids). A interface nunca inventa identidades do servidor.
  return { queued: true, data: { ...payload, id: localId ?? id } };
}
