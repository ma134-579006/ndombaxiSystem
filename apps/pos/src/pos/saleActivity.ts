/**
 * Há uma VENDA EM CURSO neste posto?
 *
 * Escrito pelo ecrã de vendas (carrinho com artigos ou fatura a ser emitida) e
 * lido pela auto-atualização, que nunca pode recarregar a app a meio de uma
 * venda — perder-se-ia o que o operador já lançou, com o cliente ao balcão.
 *
 * É uma variável de módulo, e não estado do React, pelo mesmo motivo que a
 * bandeira de ocupação em `offline/localServer.ts`: quem lê (a auto-atualização,
 * fora da árvore do React) não tem relação de pai-e-filho com quem escreve, e um
 * contexto novo obrigaria a re-renderizar a grelha de produtos a cada mudança do
 * carrinho — o "engasgo" que já foi corrigido uma vez neste ecrã.
 *
 * NÃO inferir isto do DOM (ex.: contar `.cart-line`): é uma classe de ESTILO,
 * reutilizável em qualquer lista — a lista de clientes usa-a — e bastava isso
 * para a app se julgar a meio de uma venda com o carrinho vazio.
 */
let saleInProgress = false;

/** Chamado pelo ecrã de vendas sempre que o estado da venda muda. */
export function setSaleInProgress(value: boolean): void {
  saleInProgress = value;
}

export function isSaleInProgress(): boolean {
  return saleInProgress;
}
