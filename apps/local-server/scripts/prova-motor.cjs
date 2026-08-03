/**
 * Prova do MOTOR de replicação — o ciclo que leva o trabalho do posto à nuvem.
 *
 * As duas garantias que aqui se protegem, por ordem de gravidade:
 *  1. **Nada é dado por subido sem a nuvem confirmar.** Marcar antes da
 *     resposta seria dar por enviado o que se perdeu no caminho — e esse dado
 *     nunca mais seria tentado.
 *  2. **Uma linha recusada não trava a fila.** Sem isso, um único registo
 *     estranho parava a sincronização da loja inteira.
 *
 * Não precisa de PostgreSQL: a base e a nuvem são injetadas.
 */
const path = require('node:path');
const LS = require(path.join(__dirname, '..', 'dist', 'index.js'));

const r = [];
const check = (nome, cond, extra = '') => {
  r.push([cond ? 'OK  ' : 'FALHA', nome + (extra ? ` — ${extra}` : '')]);
  return cond;
};

const SCHEMA = 'tenant_ab12cd34';

/** Base local de mentira, com um diário e linhas reais. */
function baseFalsa(pendentes, linhas) {
  const marcadas = [];
  const query = async (sql, params) => {
    if (sql.includes('sync_journal')) {
      const porSubir = pendentes.filter(
        (p) => !marcadas.some((m) => m.table === p.table_name && m.id === p.row_id));
      // Respeita o LIMIT do SQL, como uma base a sério faria — senão o teste
      // dos lotes não estaria a testar nada.
      const lim = /LIMIT (\d+)/.exec(sql);
      return lim ? porSubir.slice(0, Number(lim[1])) : porSubir;
    }
    // Leitura do estado atual de uma linha.
    const m = /FROM "[^"]+"\."([a-z_]+)"/.exec(sql);
    const tabela = m ? m[1] : '';
    const id = params && params[0];
    const linha = linhas[`${tabela}|${id}`];
    return linha ? [linha] : [];
  };
  const run = async (sql, params) => {
    if (sql.includes('UPDATE') && sql.includes('sync_journal')) {
      marcadas.push({ table: params[0], id: params[1], seq: params[2] });
    }
  };
  return { query, run, marcadas };
}

function nuvem({ falhar = false, http = 200, decidir = () => ({ applied: true, reason: 'inserido', conflict: false }) } = {}) {
  const lotes = [];
  const fetchImpl = async (url, init) => {
    if (falhar) throw new Error('sem rede');
    const body = JSON.parse(init.body);
    lotes.push(body.rows);
    if (http !== 200) return { ok: false, status: http, json: async () => ({}) };
    return {
      ok: true,
      json: async () => body.rows.map((x) => ({ table: x.table, id: x.id, ...decidir(x) })),
    };
  };
  return { fetchImpl, lotes: () => lotes };
}

const base = { apiUrl: 'https://api.exemplo', accessToken: 'tok', companyCode: 'emp', schema: SCHEMA, deviceId: 'posto-1' };

(async () => {
  // ── 1. Caminho feliz ──────────────────────────────────────
  {
    const db = baseFalsa(
      [{ seq: '5', table_name: 'products', row_id: 'p1', op: 'U', device_id: 'posto-1' }],
      { 'products|p1': { id: 'p1', name: 'Pão', version: 3 } },
    );
    const n = nuvem();
    const res = await LS.pushPending({ ...base, query: db.query, run: db.run, fetchImpl: n.fetchImpl });
    check('sobe o que está pendente', res.sent === 1 && res.applied === 1);
    check('  envia o estado ATUAL da linha, não um retrato antigo',
      n.lotes()[0][0].data.name === 'Pão');
    check('  e marca como sincronizado', db.marcadas.length === 1);
  }

  // ── 2. SEM REDE: nada pode ser dado por subido ────────────
  {
    const db = baseFalsa(
      [{ seq: '5', table_name: 'products', row_id: 'p1', op: 'U', device_id: 'posto-1' }],
      { 'products|p1': { id: 'p1', name: 'Pão' } },
    );
    const res = await LS.pushPending({ ...base, query: db.query, run: db.run, fetchImpl: nuvem({ falhar: true }).fetchImpl });
    check('SEM REDE: nada é marcado como sincronizado', db.marcadas.length === 0);
    check('  e diz que ficou trabalho por fazer', res.remaining === true);
    check('  sem rebentar (ninguém fica à espera)', res.applied === 0);
  }

  // ── 3. Nuvem responde com ERRO ────────────────────────────
  {
    const db = baseFalsa(
      [{ seq: '5', table_name: 'products', row_id: 'p1', op: 'U', device_id: 'posto-1' }],
      { 'products|p1': { id: 'p1', name: 'Pão' } },
    );
    const res = await LS.pushPending({ ...base, query: db.query, run: db.run, fetchImpl: nuvem({ http: 503 }).fetchImpl });
    check('nuvem em baixo: nada é marcado', db.marcadas.length === 0);
    check('  e fica para a próxima', res.remaining === true);
  }

  // ── 4. Linha RECUSADA não trava a fila ────────────────────
  {
    const db = baseFalsa(
      [
        { seq: '5', table_name: 'users', row_id: 'u1', op: 'U', device_id: 'posto-1' },
        { seq: '6', table_name: 'products', row_id: 'p1', op: 'U', device_id: 'posto-1' },
      ],
      { 'users|u1': { id: 'u1' }, 'products|p1': { id: 'p1', name: 'Pão' } },
    );
    const n = nuvem({
      decidir: (x) => x.table === 'users'
        ? { applied: false, reason: 'tabela cloud não sobe', conflict: false }
        : { applied: true, reason: 'inserido', conflict: false },
    });
    const res = await LS.pushPending({ ...base, query: db.query, run: db.run, fetchImpl: n.fetchImpl });
    check('uma linha recusada não trava a fila', res.applied === 1 && res.rejected === 1);
    check('  e a recusada também é marcada (senão a fila parava para sempre)',
      db.marcadas.length === 2);
  }

  // ── 5. Conflitos são contados ─────────────────────────────
  {
    const db = baseFalsa(
      [{ seq: '5', table_name: 'products', row_id: 'p1', op: 'U', device_id: 'posto-1' }],
      { 'products|p1': { id: 'p1', name: 'Pão' } },
    );
    const n = nuvem({ decidir: () => ({ applied: false, reason: 'a nuvem tinha versão mais alta', conflict: true }) });
    const res = await LS.pushPending({ ...base, query: db.query, run: db.run, fetchImpl: n.fetchImpl });
    check('os conflitos são contados', res.conflicts === 1);
  }

  // ── 6. Linha apagada ──────────────────────────────────────
  {
    const db = baseFalsa(
      [{ seq: '7', table_name: 'products', row_id: 'p9', op: 'D', device_id: 'posto-1' }], {},
    );
    const n = nuvem();
    await LS.pushPending({ ...base, query: db.query, run: db.run, fetchImpl: n.fetchImpl });
    check('uma linha APAGADA sobe marcada como apagada', n.lotes()[0][0].deleted === true);
  }

  // ── 7. Linha que desapareceu entretanto ───────────────────
  {
    const db = baseFalsa(
      [{ seq: '8', table_name: 'products', row_id: 'sumiu', op: 'U', device_id: 'posto-1' }], {},
    );
    const n = nuvem();
    const res = await LS.pushPending({ ...base, query: db.query, run: db.run, fetchImpl: n.fetchImpl });
    check('linha que já não existe é marcada e não trava nada',
      res.sent === 0 && db.marcadas.length === 1);
  }

  // ── 8. Muitas alterações: em lotes, e termina sempre ──────
  {
    const pend = Array.from({ length: 5 }, (_, i) => (
      { seq: String(i + 1), table_name: 'products', row_id: `p${i}`, op: 'U', device_id: 'posto-1' }));
    const linhas = {};
    for (let i = 0; i < 5; i++) linhas[`products|p${i}`] = { id: `p${i}`, name: `P${i}` };
    const db = baseFalsa(pend, linhas);
    const n = nuvem();
    const res = await LS.pushPending({ ...base, query: db.query, run: db.run, fetchImpl: n.fetchImpl, batchSize: 2 });
    check('parte em lotes e sobe tudo', res.applied === 5, `${n.lotes().length} lotes`);
    check('  respeitando o tamanho do lote', n.lotes().every((l) => l.length <= 2));
  }

  // ── 9. O ciclo termina sempre ─────────────────────────────
  {
    // Diário que nunca esvazia (linha marcada volta a aparecer) — o motor tem
    // de desistir por si, senão ficava a girar para sempre num posto real.
    const query = async (sql) => sql.includes('sync_journal')
      ? [{ seq: '1', table_name: 'products', row_id: 'p1', op: 'U', device_id: 'posto-1' }]
      : [{ id: 'p1', name: 'X' }];
    const res = await LS.pushPending({
      ...base, query, run: async () => {}, fetchImpl: nuvem().fetchImpl,
      batchSize: 1, maxBatches: 3,
    });
    check('o ciclo TERMINA mesmo com trabalho infinito', res.remaining === true && res.sent === 3);
  }

  console.log();
  for (const [st, nome] of r) console.log(st, nome);
  const falhas = r.filter(([s]) => s !== 'OK  ').length;
  console.log(`\n${r.length - falhas}/${r.length} passaram`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('rebentou:', e.message); process.exit(1); });
