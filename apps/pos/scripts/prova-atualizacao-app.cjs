/**
 * Prova da ligação entre a app e o motor da atualização obrigatória.
 *
 * O motor já está provado à parte (`packages/update-core`). O que se prova aqui
 * é a COLA: descobrir em que plataforma a app corre, que versão está instalada,
 * e — o que mais importa — que o Android é reconhecido pela versão GRAVADA no
 * empacotamento, sem depender de nenhum plugin responder a tempo.
 *
 * Corre o módulo REAL que vai no instalador, compilado com o mesmo esbuild do
 * build da Caixa.
 */
const path = require('node:path');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');

const raiz = path.join(__dirname, '..', '..', '..');
const esbuild = require(require.resolve('esbuild', {
  paths: [path.dirname(require.resolve('vite', { paths: [path.join(__dirname, '..')] }))],
}));

const r = [];
const check = (nome, cond) => r.push([cond ? 'OK  ' : 'FALHA', nome]);

const tmp = mkdtempSync(path.join(tmpdir(), 'ndombaxi-atualizacao-'));
const saida = path.join(tmp, 'mandatoryUpdate.cjs');

// `../config` lê `import.meta.env` (Vite) e `../offline/*` toca em IndexedDB —
// nada disso existe em Node, e nada disso é o que está a ser provado.
const stubs = {
  name: 'stubs',
  setup(build) {
    build.onResolve({ filter: /^\.\.\/config$/ }, () => ({ path: 'config', namespace: 's' }));
    build.onResolve({ filter: /^\.\.\/offline\/sync$/ }, () => ({ path: 'sync', namespace: 's' }));
    build.onResolve({ filter: /^\.\.\/offline\/db$/ }, () => ({ path: 'db', namespace: 's' }));
    build.onLoad({ filter: /.*/, namespace: 's' }, (a) => ({
      contents: {
        config: "export const API_URL = 'https://api.exemplo';",
        sync: `export const syncController = {
          getState: () => globalThis.__estadoSync,
          flush: () => { globalThis.__flushes++; return Promise.resolve(); },
        };`,
        db: 'export const listPendingSales = () => Promise.resolve(globalThis.__fila);',
      }[a.path],
      loader: 'js',
    }));
  },
};

const espera = (ms) => new Promise((res) => setTimeout(res, ms));

(async () => {
  await esbuild.build({
    entryPoints: [path.join(__dirname, '..', 'src', 'update', 'mandatoryUpdate.ts')],
    bundle: true, format: 'cjs', platform: 'node', outfile: saida, plugins: [stubs],
  });

  // ── Que plataforma é esta? ────────────────────────────────────────
  const carregar = () => { delete require.cache[saida]; return require(saida); };

  global.window = {};
  check('navegador → a atualização obrigatória não se aplica',
    carregar().platformOfThisApp() === null);

  global.window = { ndombaxi: { platform: 'windows', version: () => Promise.resolve('1.2.0') } };
  check('app Electron → windows', carregar().platformOfThisApp() === 'windows');

  // O caso que interessa no Android: a versão vem GRAVADA no empacotamento, e
  // por isso é conhecida mesmo que nenhum plugin responda.
  global.window = { __NDOMBAXI_APP_VERSION__: '1.2.0' };
  check('Android com versão gravada → android (sem plugin nenhum)',
    carregar().platformOfThisApp() === 'android');

  global.window = { Capacitor: { Plugins: { App: { getInfo: () => Promise.resolve({ version: '1.2.0' }) } } } };
  check('Android só com o plugin → android (reserva)',
    carregar().platformOfThisApp() === 'android');

  // ── O ciclo completo, num Android com vendas por enviar ───────────
  const releaseObrigatoria = {
    platform: 'android', version: '1.3.0', minSupported: null,
    downloadPageUrl: 'https://ndombaxisystem.com/baixar',
    notes: ['Correções de segurança'], fixes: [], mandatory: true,
    releasedAt: '2026-08-03T00:00:00.000Z',
  };

  let perguntas = 0;
  const montar = (opts) => {
    globalThis.__fila = opts.fila;
    globalThis.__estadoSync = { online: opts.online, syncing: false, pending: opts.fila.length };
    globalThis.__flushes = 0;
    perguntas = 0;
    global.window = {
      __NDOMBAXI_APP_VERSION__: '1.1.6',
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (t) => clearTimeout(t),
      setInterval: (fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; },
      clearInterval: (t) => clearInterval(t),
      addEventListener: () => {},
    };
    global.fetch = async (url) => {
      if (String(url).includes('/downloads/latest')) {
        perguntas++;
        if (opts.offline) throw new TypeError('Failed to fetch');
        return { ok: true, json: async () => releaseObrigatoria };
      }
      throw new Error('pedido inesperado');
    };
    global.AbortController = class { constructor() { this.signal = {}; } abort() {} };
    return carregar().mandatoryUpdate;
  };

  const porEnviar = [
    { status: 'PENDING' }, { status: 'PENDING' },
    { status: 'ERROR' }, // recusada pelo servidor: espera por uma pessoa
  ];

  // 1. Obrigatória + vendas por enviar + COM rede → não tranca, sincroniza.
  let mu = montar({ fila: porEnviar, online: true });
  mu.start();
  await espera(5_200);
  let s = mu.getState();
  check('perguntou ao servidor oficial', perguntas === 1);
  check('versão obrigatória detetada', s.decision?.state === 'mandatory');
  check('com vendas por enviar → NÃO tranca', s.blocking === false);
  check('  conta só as que estão por enviar (ignora as recusadas)', s.pending === 2);
  check('  e manda-as para o servidor primeiro', globalThis.__flushes > 0);

  // 2. A fila esvazia → agora sim, tranca.
  globalThis.__fila = [{ status: 'ERROR' }];
  globalThis.__estadoSync = { online: true, syncing: false, pending: 0 };
  await espera(5_500);
  s = mu.getState();
  check('fila esvaziada → TRANCA', s.blocking === true);
  check('  e a janela sabe que versão pedir', s.decision?.release?.version === '1.3.0');

  // 3. Cinco dias sem rede, com trabalho acumulado: a loja continua a trabalhar.
  mu = montar({ fila: porEnviar, online: false });
  mu.start();
  await espera(5_200);
  s = mu.getState();
  check('pendentes e SEM rede → nunca tranca', s.blocking === false);
  check('  e não gasta dados a tentar enviar', globalThis.__flushes === 0);

  // 4. Empresa completamente offline: nem sequer há veredicto que tranque.
  mu = montar({ fila: [], online: false, offline: true });
  mu.start();
  await espera(5_200);
  s = mu.getState();
  check('servidor oficial inalcançável → a app trabalha na mesma', s.blocking === false);
  check('  e regista porquê', s.decision?.reason === 'sem resposta do servidor oficial');

  rmSync(tmp, { recursive: true, force: true });
  for (const [e, n] of r) console.log(e, n);
  const falhas = r.filter(([e]) => e !== 'OK  ').length;
  console.log(`\n${r.length - falhas}/${r.length}`);
  process.exit(falhas ? 1 : 0);
})();
