/**
 * `@nexus/prisma-adapter-pglite` — o Prisma 7 a falar com o PGlite dentro do
 * MESMO processo, sem socket e sem servidor.
 *
 * É a peça que faltava para o Android independente: a MESMA API, o MESMO
 * schema e as MESMAS regras fiscais a correr no telemóvel, com a base de dados
 * na memória interna do aparelho.
 *
 * Uso:
 *   import { PGlite } from '@electric-sql/pglite';
 *   import { PrismaPGlite } from '@nexus/prisma-adapter-pglite';
 *
 *   const pglite = await PGlite.create({ dataDir: caminhoNoAparelho });
 *   const prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) });
 */
export {
  PrismaPGlite,
  PrismaPGliteAdapter,
  type PGliteLike,
  type PGliteTransactionLike,
  type PGliteQueryOptions,
  type PGliteResults,
  type PrismaPGliteOptions,
} from './adapter';
export { fieldToColumnType, mapArg, parsers, parseArrayText } from './conversion';
export { convertDriverError } from './errors';
