/**
 * QA — PostgreSQL LOCAL e descartável (PGlite = Postgres 17 em WASM) servido
 * por socket, para correr a API inteira nesta máquina sem tocar em produção.
 * Uso: node qa/pg-local.mjs [pasta-dados] [porta]
 * Nunca usar com dados reais: é só para testes.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(path.resolve('apps/api/package.json'));
const { PGlite } = await import(pathToFileURL(require.resolve('@electric-sql/pglite')).href);
const { PGLiteSocketServer } = await import(pathToFileURL(require.resolve('@electric-sql/pglite-socket')).href);

const dir = process.argv[2] ?? 'memory://';
const port = Number(process.argv[3] ?? 55432);
const db = await PGlite.create(dir);
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 100 });
await server.start();
console.log(`PGLITE_READY postgresql://postgres@127.0.0.1:${port}/postgres (${dir})`);
const stop = async () => { await server.stop(); await db.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
