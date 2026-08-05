/**
 * Prova do TURNO DE CAIXA sem rede.
 *
 * Sem isto, uma loja sem internet não conseguia sequer começar o dia — e as
 * vendas subiam depois sem turno aberto, entrando na faturação mas não na
 * gaveta. O lojista ficava com o dinheiro na mão e um relatório a dizer que não
 * tinha vendido nada.
 *
 * Corre o módulo REAL que vai no instalador.
 */
const path = require('node:path');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');

const esbuild = require(require.resolve('esbuild', {
  paths: [path.dirname(require.resolve('vite', { paths: [path.join(__dirname, '..')] }))],
}));

const r = [];
const check = (nome, cond) => r.push([cond ? 'OK  ' : 'FALHA', nome]);

const tmp = mkdtempSync(path.join(tmpdir(), 'ndombaxi-turno-'));
const saida = path.join(tmp, 'shifts.cjs');

// `./store` fala com o SQLite do aparelho. Aqui trocamo-lo por uma memória
// simples: o que se prova é a REGRA do turno, não a cave onde ela assenta
// (essa já tem prova própria em `prova-memoria-interna.cjs`).
const stubStore = {
  name: 'stub-store',
  setup(build) {
    build.onResolve({ filter: /^\.\/store$/ }, () => ({ path: 'store', namespace: 's' }));
    build.onLoad({ filter: /.*/, namespace: 's' }, () => ({
      contents: `
        export async function kvGet(k) { return globalThis.__kv[k] ?? null; }
        export async function kvSet(k, v) { globalThis.__kv[k] = v; }
      `,
      loader: 'js',
    }));
  },
};

(async () => {
  await esbuild.build({
    entryPoints: [path.join(__dirname, '..', 'src', 'offline', 'shifts.ts')],
    bundle: true, format: 'cjs', platform: 'node', outfile: saida, plugins: [stubStore],
  });

  globalThis.__kv = {};
  global.window = {};
  const m = require(saida);

  // ── Abrir o dia sem rede ─────────────────────────────────────────
  check('sem turno → nada aberto', (await m.turnoAbertoLocal()) === null);

  const t = await m.abrirTurnoOffline({ openingFloat: 5000, operatorName: 'Ana' });
  check('abre o turno sem rede', t.status === 'open');
  check('  guarda o fundo de maneio', t.openingFloat === 5000);
  check('  e passa a haver turno aberto neste posto', (await m.turnoAbertoLocal()) !== null);

  // Dois turnos abertos no mesmo posto seria dinheiro sem dono.
  const t2 = await m.abrirTurnoOffline({ openingFloat: 9999 });
  check('abrir outra vez NÃO cria um segundo turno', t2.opId === t.opId);
  check('  e não altera o fundo de maneio', t2.openingFloat === 5000);

  let ops = await m.opsDeTurnoPendentes();
  check('ficou 1 operação por subir', ops.length === 1);
  check('  é a ABERTURA', ops[0].op === 'create' && ops[0].entity === 'cashSession');
  check('  leva o fundo de maneio para o servidor', ops[0].payload.openingFloat === 5000);
  check('  e leva uma chave de idempotência', /^[0-9a-f-]{36}$/.test(ops[0].opId));

  // ── Fechar o dia sem rede ────────────────────────────────────────
  const f = await m.fecharTurnoOffline({ countedCash: 73250, notes: 'sem rede o dia todo' });
  check('fecha o turno sem rede', f.status === 'closed');
  check('  declara o que foi CONTADO na gaveta', f.countedCash === 73250);
  check('  e já não há turno aberto', (await m.turnoAbertoLocal()) === null);

  ops = await m.opsDeTurnoPendentes();
  check('ficaram 2 operações por subir', ops.length === 2);

  // A ORDEM é o que faz o dinheiro bater certo.
  check('a ABERTURA vem antes do FECHO', ops[0].op === 'create' && ops[1].op === 'update');
  check('  e a sequência cresce', ops[1].seq > ops[0].seq);

  // Se a chave fosse a mesma, o servidor tomava o fecho por repetição da
  // abertura e descartava-o em silêncio — o turno ficaria aberto para sempre.
  check('o FECHO tem chave PRÓPRIA', ops[1].opId !== ops[0].opId);
  check('  e aponta para o turno certo', ops[1].localId === t.opId);
  check('  levando o contado', ops[1].payload.countedCash === 73250);

  check('contagem do que falta subir', (await m.contarOpsDeTurno()) === 2);

  // ── A rede voltou ────────────────────────────────────────────────
  await m.opDeTurnoEnviada(ops[0].opId);
  check('abertura enviada → sai da fila', (await m.contarOpsDeTurno()) === 1);

  // Enquanto o fecho não subiu, o turno local NÃO pode ser apagado.
  await m.limparTurnoLocalSeVazio();
  check('com o fecho por subir, o turno local FICA', (await m.turnoLocal()) !== null);

  await m.opDeTurnoEnviada(ops[1].opId);
  await m.limparTurnoLocalSeVazio();
  check('tudo enviado → o turno local é dispensado', (await m.turnoLocal()) === null);

  // ── A app foi morta a meio do dia ────────────────────────────────
  // A sequência tem de continuar de onde ia: se recomeçasse do zero, o fecho de
  // um turno novo podia entrar antes da abertura dele.
  const seqAntes = globalThis.__kv['turno.seq'];
  const novo = await m.abrirTurnoOffline({ openingFloat: 1000 });
  const opsNovas = await m.opsDeTurnoPendentes();
  check('a sequência não recomeça do zero', opsNovas[0].seq > seqAntes - 1);
  check('  e o turno novo é mesmo novo', novo.opId !== t.opId);

  rmSync(tmp, { recursive: true, force: true });
  for (const [e, n] of r) console.log(e, n);
  const falhas = r.filter(([e]) => e !== 'OK  ').length;
  console.log(`\n${r.length - falhas}/${r.length}`);
  process.exit(falhas ? 1 : 0);
})();
