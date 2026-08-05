/**
 * SE já se pode trancar a aplicação — a regra que evita perder dias de trabalho.
 *
 * O caso real que esta peça existe para impedir: uma empresa trabalha cinco dias
 * sem internet, com tudo gravado localmente. A internet volta. Se a aplicação
 * trancasse nesse instante para exigir a atualização, o lojista ficava sem poder
 * usar o sistema **e** com cinco dias de vendas ainda por enviar — o pior dos
 * dois mundos, e num sistema de faturação isso é dinheiro e obrigação fiscal.
 *
 * Por isso a ordem é sempre: **primeiro esvaziar a fila, só depois trancar.**
 */

export interface PendingWork {
  /** Operações por enviar: vendas, faturas, recibos, stock, escritas offline. */
  pending: number;
  /** Há ligação utilizável AGORA (decidida pelo resultado dos pedidos). */
  online: boolean;
  /** A sincronização já está a decorrer. */
  syncing: boolean;
}

export type BlockReadiness =
  /** Pode trancar: não há nada por enviar. */
  | { canBlock: true; reason: string }
  /** Ainda não. `syncFirst` diz se vale a pena tentar sincronizar agora. */
  | { canBlock: false; syncFirst: boolean; reason: string };

/**
 * Decide se a aplicação já pode ser trancada para atualização obrigatória.
 *
 * Note-se o caso `pendente + offline`: **não se tranca**. Sem rede não há como
 * salvar o trabalho acumulado, e trancar deixaria o lojista sem sistema e sem
 * forma de recuperar. Fica a trabalhar; quando a rede voltar, sincroniza e só
 * então se tranca. É também o que a regra do modo offline manda — sem internet
 * a aplicação abre e funciona sempre.
 */
export function readyToBlock(work: PendingWork): BlockReadiness {
  if (work.pending <= 0) {
    return { canBlock: true, reason: 'não há operações por enviar' };
  }
  if (!work.online) {
    return {
      canBlock: false,
      syncFirst: false,
      reason: `${work.pending} operação(ões) por enviar e sem ligação — a aplicação continua a trabalhar`,
    };
  }
  return {
    canBlock: false,
    syncFirst: !work.syncing,
    reason: `${work.pending} operação(ões) por enviar — a sincronizar antes de atualizar`,
  };
}
