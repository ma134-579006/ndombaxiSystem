/**
 * Ligação ao SERVIDOR DA LOJA — partilhada pelo Gestor e pela Caixa.
 *
 * A mesma decisão nos dois: qual endereço se aceita, quando se usa a loja e
 * quando se volta à nuvem. Se cada app decidisse à sua maneira, um telemóvel
 * ficaria preso a um computador desligado enquanto o outro já tinha desistido.
 */
export {
  ESTADO_INICIAL,
  DESCANSO_MS,
  FALHAS_ATE_DESISTIR,
  anotarFalha,
  anotarSucesso,
  escolherBase,
  esquecerLoja,
  normalizarEndereco,
  type EnderecoInvalido,
  type EnderecoValido,
  type ShopServerState,
} from './shopServer';
