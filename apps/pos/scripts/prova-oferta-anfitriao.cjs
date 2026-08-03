/**
 * Prova da OFERTA DE SESSÃO da Caixa ao anfitrião.
 *
 * Até aqui só o Gestor oferecia a sessão ao posto. Numa loja onde o computador
 * do balcão nunca abre o Gestor — que é a loja típica — isso significava que o
 * posto que mais precisa de trabalhar sem internet era o único a nunca receber
 * a cópia da empresa, e nada na interface o explicava.
 *
 * Aqui prova-se o lado da Caixa (o que ela oferece, e com que sinal de
 * ocupação) e o lado de quem decide (`shouldProvision`), incluindo o que mais
 * importa: a sessão de um OPERADOR nunca traz a empresa para o aparelho.
 *
 * Corre o módulo REAL que vai no instalador — `src/offline/localServer.ts`,
 * compilado aqui com o mesmo esbuild do build da Caixa. Uma cópia do código
 * dentro do teste provaria a cópia, não o produto.
 */
const path = require('node:path');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');

const raiz = path.join(__dirname, '..', '..', '..');
// O esbuild vem por baixo do vite (pnpm); resolvê-lo a partir dele evita
// depender de uma dependência declarada só para o teste.
const esbuild = require(require.resolve('esbuild', {
  paths: [path.dirname(require.resolve('vite', { paths: [path.join(__dirname, '..')] }))],
}));

const r = [];
const check = (nome, cond) => r.push([cond ? 'OK  ' : 'FALHA', nome]);

// ---------------------------------------------------------------------------
// 1. A CAIXA — o que ela oferece
// ---------------------------------------------------------------------------

const tmp = mkdtempSync(path.join(tmpdir(), 'ndombaxi-oferta-'));
const saida = path.join(tmp, 'localServer.cjs');

// `../config` lê `import.meta.env` do Vite, que não existe em Node. Trocamo-lo
// por um módulo fixo: o que está a ser provado é a oferta, não a configuração.
const stubConfig = {
  name: 'stub-config',
  setup(build) {
    build.onResolve({ filter: /^\.\.\/config$/ }, () => ({ path: 'config-stub', namespace: 'stub' }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: "export const API_URL = 'https://api.exemplo/papi';",
      loader: 'js',
    }));
  },
};

(async () => {
  await esbuild.build({
    entryPoints: [path.join(__dirname, '..', 'src', 'offline', 'localServer.ts')],
    bundle: true, format: 'cjs', platform: 'node', outfile: saida, plugins: [stubConfig],
  });

  // Sem anfitrião (navegador normal): a oferta não pode rebentar nem fazer nada.
  global.window = {};
  let mod = require(saida);
  check('sem anfitrião → não se apresenta como posto', mod.canHostLocalServer() === false);
  let rebentou = false;
  try {
    mod.offerSessionToHost({ accessToken: 't', companyCode: 'emp-1', role: 'CASHIER' });
  } catch { rebentou = true; }
  check('sem anfitrião → oferecer não rebenta', rebentou === false);

  // Com anfitrião: regista o que lhe chega.
  const recebidas = [];
  global.window = {
    ndombaxi: {
      provisionLocal: (s) => { recebidas.push(s); return Promise.resolve({ done: false, reason: 'stub' }); },
    },
  };
  delete require.cache[saida];
  mod = require(saida);

  check('com anfitrião → apresenta-se como posto', mod.canHostLocalServer() === true);

  await mod.offerSessionToHost({ accessToken: 'tok-123', companyCode: 'emp-9c88', role: 'CASHIER' });
  const a = recebidas[0] ?? {};
  check('a oferta leva o token', a.accessToken === 'tok-123');
  check('a oferta leva a empresa', a.companyCode === 'emp-9c88');
  check('a oferta leva o papel de quem entrou', a.role === 'CASHIER');
  check('a oferta leva o endereço da nuvem', a.apiUrl === 'https://api.exemplo/papi');

  // OCUPAÇÃO: é o único sinal que só a Caixa tem. Sem ele, a cópia (dezenas de
  // milhares de linhas) arrancaria com um cliente à espera no balcão.
  check('em repouso → não ocupada', a.busy === false);

  mod.setPosBusy(true);
  await mod.offerSessionToHost({ accessToken: 'tok-123', companyCode: 'emp-9c88', role: 'CASHIER' });
  check('turno aberto/carrinho → oferta diz OCUPADA', recebidas[1].busy === true);

  mod.setPosBusy(false);
  await mod.offerSessionToHost({ accessToken: 'tok-123', companyCode: 'emp-9c88', role: 'CASHIER' });
  check('caixa livre outra vez → deixa de estar ocupada', recebidas[2].busy === false);

  // Um anfitrião que falhe não pode estorvar quem está a cobrar.
  global.window = { ndombaxi: { provisionLocal: () => Promise.reject(new Error('disco cheio')) } };
  delete require.cache[saida];
  const mod2 = require(saida);
  let estorvou = false;
  try { await mod2.offerSessionToHost({ accessToken: 't', companyCode: 'e', role: 'CASHIER' }); }
  catch { estorvou = true; }
  check('anfitrião a falhar → não estorva a venda', estorvou === false);

  // -------------------------------------------------------------------------
  // 2. QUEM DECIDE — a decisão real do posto, com a sessão que a Caixa manda
  // -------------------------------------------------------------------------
  const ls = require(path.join(raiz, 'apps', 'local-server', 'dist', 'index.js'));
  const paths = { dataDir: path.join(tmp, 'pgdata') };
  const base = {
    binariesPresent: true, companyCode: 'emp-9c88', freeDiskBytes: 50 * 1024 ** 3, busy: false,
  };

  // O QUE MAIS IMPORTA: a Caixa passou a oferecer, mas um OPERADOR continua a
  // não poder deixar as vendas, os clientes e os salários da empresa num posto
  // emprestado. Quem abre a porta é o papel, não a janela que ofereceu.
  const operador = ls.shouldProvision(paths, { ...base, isCompanyAdmin: false });
  check('sessão de OPERADOR → não copia a empresa', operador.provision === false);
  check('  e diz que espera por um administrador', /administrador/.test(operador.reason ?? ''));

  // Administrador na Caixa, com a caixa ocupada: fica para depois, não recusa.
  const ocupada = ls.shouldProvision(paths, { ...base, isCompanyAdmin: true, busy: true });
  check('administrador mas caixa OCUPADA → adia', ocupada.provision === false);
  check('  e volta a tentar mais tarde', (ocupada.retryInMs ?? 0) > 0);

  // Administrador na Caixa, caixa livre: é altura de copiar. Sem isto, a loja
  // que só abre a Caixa ficaria presa à nuvem para sempre.
  const livre = ls.shouldProvision(paths, { ...base, isCompanyAdmin: true });
  check('administrador e caixa livre → COPIA (pela Caixa)', livre.provision === true);

  rmSync(tmp, { recursive: true, force: true });

  for (const [e, n] of r) console.log(e, n);
  const falhas = r.filter(([e]) => e !== 'OK  ').length;
  console.log(`\n${r.length - falhas}/${r.length}`);
  process.exit(falhas ? 1 : 0);
})();
