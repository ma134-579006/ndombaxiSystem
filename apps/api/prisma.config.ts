/**
 * Configuração do Prisma (obrigatória a partir do Prisma 7).
 *
 * O `url` deixou de poder viver no `schema.prisma`: as MIGRAÇÕES leem o
 * endereço daqui, e a APLICAÇÃO passa a receber a ligação por um *adapter* ao
 * construir o cliente (ver `prisma.service.ts`).
 *
 * Não é burocracia — é o que permite o mesmo código correr sobre o PostgreSQL
 * do servidor, sobre o PostgreSQL portátil de um posto Windows e, no futuro,
 * sobre o PGlite dentro de um telemóvel. Antes, o motor era escolhido no
 * ficheiro do esquema; agora é escolhido por quem arranca a aplicação.
 */
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
