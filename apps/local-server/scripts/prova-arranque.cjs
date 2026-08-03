/**
 * Prova que o SERVIDOR LOCAL arranca a sério.
 *
 * Até aqui todo o `apps/local-server` era código que compilava mas nunca tinha
 * corrido — o que é o mesmo que não saber se funciona. Isto cria o cluster do
 * zero, arranca-o, liga-se, confirma que é mesmo PostgreSQL e desliga.
 */
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

// Corre a partir do `dist` deste pacote (compilar antes: pnpm --filter @nexus/local-server build).
const LS = require(path.join(__dirname, '..', 'dist', 'index.js'));
// Onde ficam o cluster de teste e os binários. Por omissão ao lado do pacote;
// NDOMBAXI_PG_ROOT aponta para a pasta que contém `pgsql/bin` (os binários NÃO
// estão no repositório — descarregar de get.enterprisedb.com, ver README).
const HERE = process.env.NDOMBAXI_PG_TEST_DIR || path.join(__dirname, '..', '.prova');

const paths = LS.layout({
  userDataDir: path.join(HERE, 'localdata'),
  resourcesDir: process.env.NDOMBAXI_PG_ROOT || path.join(HERE, 'pgroot'),
});

const r = [];
const check = (nome, cond, extra = '') => {
  r.push([cond ? 'OK  ' : 'FALHA', nome + (extra ? ` — ${extra}` : '')]);
  return cond;
};

(async () => {
  // Estado de fábrica: nenhum cluster, como um posto acabado de instalar.
  // Encerrar ANTES de apagar — com o servidor de pé os ficheiros estão
  // bloqueados pelo Windows e o `rm` rebenta.
  try {
    const { stop } = require(path.join(__dirname, '..', 'dist', 'postgres.js'));
    if (LS.readConfig(paths)) stop(paths);
  } catch { /* nada a encerrar */ }
  fs.rmSync(path.join(HERE, 'localdata'), { recursive: true, force: true });

  check('binários encontrados', LS.binariesPresent(paths));

  const t0 = Date.now();
  let url;
  try {
    url = await LS.ensureLocalDatabase(paths);
  } catch (e) {
    check('cluster criado e arrancado', false, e.message);
    imprimir();
    process.exit(1);
  }
  const segundos = ((Date.now() - t0) / 1000).toFixed(1);
  check('cluster criado e arrancado do ZERO', !!url, `${segundos}s`);

  const cfg = LS.readConfig(paths);
  check('configuração gravada', !!cfg && !!cfg.port && !!cfg.password);
  check('senha GERADA (nunca postgres/postgres)',
    cfg.password.length >= 24 && cfg.password !== 'postgres');
  check('porta fora da habitual (não colide com um PG instalado)', cfg.port >= 55432);

  // Liga-se mesmo e pergunta à base quem ela é.
  const psql = path.join(paths.binDir, 'psql.exe');
  const q = (sql) => spawnSync(psql, [
    '-h', '127.0.0.1', '-p', String(cfg.port), '-U', cfg.user, '-d', cfg.database,
    '-t', '-A', '-c', sql,
  ], { encoding: 'utf8', env: { ...process.env, PGPASSWORD: cfg.password } });

  const versao = q('SHOW server_version');
  check('responde a SQL', versao.status === 0, (versao.stdout || '').trim());

  // As garantias de que a camada fiscal depende:
  // No PostgreSQL 16 lc_collate/lc_ctype deixaram de ser parâmetros do servidor
  // e vivem por BASE, em pg_database — perguntar ao pg_settings devolve vazio.
  const locale = q("SELECT datcollate FROM pg_database WHERE datname = current_database()");
  check('ordenação estável entre postos (locale C)',
    (locale.stdout || '').trim().toUpperCase().startsWith('C'), (locale.stdout || '').trim());

  const listen = q("SELECT setting FROM pg_settings WHERE name = 'listen_addresses'");
  check('base NÃO exposta à rede (só 127.0.0.1)',
    (listen.stdout || '').trim() === '127.0.0.1', (listen.stdout || '').trim());

  // O que torna impossível duplicar uma fatura: índice único PARCIAL.
  q('CREATE TABLE t (id int, op uuid)');
  q('CREATE UNIQUE INDEX t_op ON t(op) WHERE op IS NOT NULL');
  q("INSERT INTO t VALUES (1, '11111111-1111-4111-8111-111111111111')");
  const dup = q("INSERT INTO t VALUES (2, '11111111-1111-4111-8111-111111111111')");
  check('índice único PARCIAL recusa o duplicado', dup.status !== 0);
  const nulos = q('INSERT INTO t VALUES (3, NULL); INSERT INTO t VALUES (4, NULL)');
  check('  e deixa passar vários NULL (vendas online)', nulos.status === 0);

  // Arrancar outra vez não recria nada nem perde dados.
  const url2 = await LS.ensureLocalDatabase(paths);
  check('2.º arranque reutiliza o cluster (não recria)', url2 === url);
  // 3 linhas: a 1.ª, mais as duas com NULL. A 2.ª foi (bem) recusada pelo índice.
  const aindaLa = q('SELECT count(*) FROM t');
  check('  e os dados continuam lá', (aindaLa.stdout || '').trim() === '3',
    `${(aindaLa.stdout || '').trim()} linhas`);

  // Cópia de segurança.
  const dest = path.join(HERE, 'localdata', 'backup-teste.dump');
  try {
    LS.backup(paths, cfg, dest);
    check('cópia de segurança gerada', fs.existsSync(dest) && fs.statSync(dest).size > 0,
      `${(fs.statSync(dest).size / 1024).toFixed(0)} KB`);
  } catch (e) {
    check('cópia de segurança gerada', false, e.message);
  }

  imprimir();
  // Desliga sempre — não deixar um PostgreSQL a correr na máquina do utilizador.
  try {
    const { stop } = require(path.join(__dirname, '..', 'dist', 'postgres.js'));
    stop(paths);
    console.log('\n(cluster de teste encerrado)');
  } catch (e) { console.log('\n(aviso: falha ao encerrar:', e.message, ')'); }

  process.exit(r.some(([s]) => s !== 'OK  ') ? 1 : 0);
})();

function imprimir() {
  console.log();
  for (const [st, nome] of r) console.log(st, nome);
  const falhas = r.filter(([s]) => s !== 'OK  ').length;
  console.log(`\n${r.length - falhas}/${r.length} passaram`);
}
