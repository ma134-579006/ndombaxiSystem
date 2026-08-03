/**
 * Política de replicação — PARTILHADA entre o posto e a nuvem.
 *
 * Vive num pacote próprio de propósito. Se cada lado tivesse a sua cópia, a
 * primeira alteração feita só num deles criaria uma discordância silenciosa
 * sobre o que é seguro escrever — e o resultado seria dados sobrepostos ou
 * perdidos, descobertos meses depois. Ao ser o MESMO ficheiro, é impossível o
 * posto e a nuvem discordarem sobre as regras.
 *
 * Zero dependências, funções puras: corre no servidor Node da API e dentro do
 * Electron do posto sem alterações.
 */
export {
  classify, isReplicated, unknownTables, resolve,
  type DataClass, type Version, type Winner, type Resolution,
} from './policy';
