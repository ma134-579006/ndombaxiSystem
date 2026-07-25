/**
 * Resolução automática de conflitos.
 *
 * A melhor estratégia de conflitos é não os ter. Por isso o modelo de dados do
 * Ndombaxi foi pensado em três famílias, e só UMA delas pode realmente conflituar:
 *
 *   1. APPEND-ONLY (vendas, notas de crédito, movimentos de caixa, auditoria)
 *      Cada documento é novo e traz o seu `opId`. Duas caixas offline a vender o
 *      mesmo produto não colidem — geram dois documentos. Conflito: impossível.
 *
 *   2. CONTADORES (stock, saldos, pontos de fidelização)
 *      Nunca enviamos "o stock passa a 7". Enviamos "-3". Somas comutam: a ordem
 *      de chegada deixa de importar e o resultado é o mesmo. Conflito: impossível.
 *      É por isto que `stockMove` existe como entidade em vez de um campo `stock`.
 *
 *   3. REGISTOS EDITÁVEIS (ficha de cliente, preço de produto, dados da empresa)
 *      Aqui sim há conflito real: dois utilizadores editaram a mesma ficha. É
 *      esta a única família que precisa de política.
 *
 * Regra transversal e inegociável: nada com efeito fiscal ou monetário é
 * resolvido em silêncio. Vai para BLOCKED e espera por um humano.
 */
import type { CachedEntity, OutboxOp, PullChange } from './types';

export type ConflictPolicy =
  /** O servidor manda. Certo para dados de referência que o gestor controla. */
  | 'server-wins'
  /** O cliente manda. Só para preferências puramente locais. */
  | 'client-wins'
  /** Une campo a campo: o cliente só sobrepõe os campos que realmente tocou. */
  | 'merge-fields'
  /** Pára e pede decisão humana. Obrigatório em dinheiro e fiscal. */
  | 'manual';

export interface EntityPolicy {
  policy: ConflictPolicy;
  /**
   * Campos que o cliente pode alterar. Em `merge-fields`, tudo o que estiver
   * fora desta lista é sempre do servidor — impede que um posto desatualizado
   * reponha, por exemplo, um preço antigo ao gravar um simples telefone.
   */
  clientOwnedFields?: string[];
}

/**
 * Políticas por entidade. O que não estiver aqui cai no `server-wins`, que é a
 * escolha conservadora: perante a dúvida, a verdade está no servidor.
 */
export const ENTITY_POLICIES: Record<string, EntityPolicy> = {
  // Fiscal e dinheiro — nunca automático.
  sale: { policy: 'manual' },
  creditNote: { policy: 'manual' },
  cashMovement: { policy: 'manual' },
  cashSession: { policy: 'manual' },
  invoice: { policy: 'manual' },

  // Editáveis pelo balcão: o posto pode corrigir contactos, o resto é do gestor.
  customer: {
    policy: 'merge-fields',
    clientOwnedFields: ['name', 'phone', 'email', 'address', 'taxId', 'notes'],
  },
  supplier: {
    policy: 'merge-fields',
    clientOwnedFields: ['name', 'phone', 'email', 'address', 'notes'],
  },

  // Referência — o gestor define no painel, o posto apenas consome.
  product: { policy: 'server-wins' },
  category: { policy: 'server-wins' },
  promotion: { policy: 'server-wins' },
  taxRate: { policy: 'server-wins' },
  employee: { policy: 'server-wins' },
  store: { policy: 'server-wins' },

  // Puramente local.
  uiPreference: { policy: 'client-wins' },
};

export function policyFor(entity: string): EntityPolicy {
  return ENTITY_POLICIES[entity] ?? { policy: 'server-wins' };
}

export type Resolution =
  /** Ficar com a versão do servidor e descartar a mutação local. */
  | { action: 'accept-server'; entity: PullChange }
  /** Reenviar a mutação, agora baseada na versão nova do servidor. */
  | { action: 'retry-rebased'; payload: Record<string, unknown>; baseVersion: number }
  /** Bloquear para decisão humana. */
  | { action: 'block'; reason: string };

/**
 * Decide o que fazer quando o servidor responde `conflict` a uma operação.
 *
 * @param op        a mutação local que colidiu
 * @param server    o estado canónico que o servidor devolveu
 */
export function resolveConflict(op: OutboxOp, server: PullChange): Resolution {
  const { policy, clientOwnedFields } = policyFor(op.entity);

  // Um registo apagado no servidor não se ressuscita automaticamente: pode ter
  // sido apagado por uma razão de negócio que o posto offline desconhece.
  if (server.deleted) {
    return { action: 'block', reason: 'O registo foi eliminado no servidor enquanto trabalhava sem ligação.' };
  }

  switch (policy) {
    case 'manual':
      return {
        action: 'block',
        reason: 'Conflito num documento fiscal ou de caixa — exige confirmação humana.',
      };

    case 'server-wins':
      return { action: 'accept-server', entity: server };

    case 'client-wins':
      return {
        action: 'retry-rebased',
        payload: op.payload as Record<string, unknown>,
        baseVersion: server.version,
      };

    case 'merge-fields': {
      const local = op.payload as Record<string, unknown>;
      const remote = (server.data ?? {}) as Record<string, unknown>;
      const allowed = clientOwnedFields ?? Object.keys(local);
      // Partimos do estado do servidor e voltamos a aplicar só o que o posto
      // podia mesmo mudar. Nada do que o cliente não escreveu é reposto.
      const merged: Record<string, unknown> = { ...remote };
      for (const field of allowed) {
        if (Object.prototype.hasOwnProperty.call(local, field)) merged[field] = local[field];
      }
      return { action: 'retry-rebased', payload: merged, baseVersion: server.version };
    }
  }
}

/**
 * Decide se uma mudança que desce do servidor pode sobrepor o que está em cache.
 * Um registo `dirty` (com edição local ainda por subir) não é esmagado — senão o
 * utilizador via o seu trabalho desaparecer do ecrã antes de ter subido.
 */
export function canOverwriteCache(cached: CachedEntity | null, incoming: PullChange): boolean {
  if (!cached) return true;
  if (cached.dirty) return false;
  return incoming.version >= cached.version;
}
