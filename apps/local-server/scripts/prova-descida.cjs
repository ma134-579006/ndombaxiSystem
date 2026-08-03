/**
 * Prova da DESCIDA aplicada no posto — a última peça do ciclo.
 *
 * As regras que aqui se protegem, por ordem de gravidade:
 *  1. **Nada é apagado com base no que a nuvem OMITE.** Uma linha que ela não
 *     tenha pode ser trabalho deste posto que ainda não subiu.
 *  2. **O que desce não volta a subir.** Sem isso, os dois lados ficavam a
 *     mandar a mesma linha um ao outro para sempre.
 *  3. **Documentos fiscais que já cá estão não são reescritos por ninguém.**
 */
const path = require('node:path');
const LS = require(path.join(__dirname, '..', 'dist', 'index.js'));

const r = [];
const check = (nome, cond, extra = '') => {
  r.push([cond ? 'OK  ' : 'FALHA', nome + (extra ? ` — ${extra}` : '')]);
  return cond;
};
const SCHEMA = 'tenant_ab12cd34';

function posto(linhas = {}) {
  const escrito = [];
  const query = async (sql, params) => {
    if (sql.includes('sync_cursors')) return [];
    const m = /FROM "[^"]+"\."([a-z_]+)"/.exec(sql);
    const linha = linhas[`${m ? m[1] : ''}|${params && params[0]}`];
    return linha ? [linha] : [];
  };
  const run = async (sql, params) => { escrito.push({ sql, params }); };
  return { query, run, escrito };
}

function nuvem(porTabela) {
  return async (url) => {
    const u = new URL(String(url), 'http://x');
    const t = u.searchParams.get('table');
    const p = porTabela[t];
    if (!p) return { ok: true, json: async () => ({ rows: [], cursor: null, hasMore: false, incremental: true }) };
    return { ok: true, json: async () => p };
  };
}

const base = { apiUrl: 'https://api.exemplo', accessToken: 'tok', companyCode: 'emp', schema: SCHEMA, deviceId: 'posto-1' };
const pagina = (rows, extra = {}) => ({ rows, cursor: 'c1', hasMore: false, incremental: true, ...extra });

(async () => {
  // 1. Produto novo da nuvem entra.
  {
    const p = posto();
    const res = await LS.pullAndApply({
      ...base, query: p.query, run: p.run, tables: ['products'],
      fetchImpl: nuvem({ products: pagina([{ id: 'p1', name: 'Novo', version: 2 }]) }),
    });
    check('um produto novo da nuvem é aplicado', res.applied === 1);
    check('  e o cursor fica guardado',
      p.escrito.some((e) => e.sql.includes('sync_cursors') && e.params[1] === 'c1'));
  }

  // 2. O que desce NÃO volta a subir.
  {
    const p = posto();
    await LS.pullAndApply({
      ...base, query: p.query, run: p.run, tables: ['products'],
      fetchImpl: nuvem({ products: pagina([{ id: 'p1', name: 'X' }]) }),
    });
    const desliga = p.escrito.findIndex((e) => /session_replication_role = .replica./.test(e.sql));
    const escreve = p.escrito.findIndex((e) => e.sql.includes('INSERT INTO') && e.sql.includes('products'));
    const religa = p.escrito.findIndex((e) => /session_replication_role = .origin./.test(e.sql));
    check('o diário é DESLIGADO antes de aplicar (senão voltava a subir)',
      desliga >= 0 && desliga < escreve);
    check('  e RELIGADO a seguir', religa > escreve);
  }

  // 3. Fiscal que já cá está não é reescrito.
  {
    const p = posto({ 'invoices|f1': { id: 'f1', number: 'FT A1/1' } });
    await LS.pullAndApply({
      ...base, query: p.query, run: p.run, tables: ['invoices'],
      fetchImpl: nuvem({ invoices: pagina([{ id: 'f1', number: 'FT A1/1', gross_total: 999 }]) }),
    });
    const ins = p.escrito.find((e) => e.sql.includes('INSERT INTO') && e.sql.includes('invoices'));
    check('faturas descem por INSERÇÃO e nunca reescrevem o que cá está',
      !!ins && ins.sql.includes('ON CONFLICT DO NOTHING') && !/DO UPDATE/i.test(ins.sql));
  }

  // 4. Os utilizadores DESCEM (senão o posto não autentica ninguém).
  {
    const p = posto();
    const res = await LS.pullAndApply({
      ...base, query: p.query, run: p.run, tables: ['users'],
      fetchImpl: nuvem({ users: pagina([{ id: 'u1', email: 'a@b.ao' }]) }),
    });
    check('os UTILIZADORES descem (senão ninguém entrava no posto)', res.applied === 1);
    const ins = p.escrito.find((e) => e.sql.includes('INSERT INTO') && e.sql.includes('users'));
    check('  e a nuvem manda neles (pode atualizar)', /DO UPDATE/i.test(ins.sql));
  }

  // 5. Séries fiscais e saldos NÃO descem.
  {
    const p = posto();
    const res = await LS.pullAndApply({
      ...base, query: p.query, run: p.run, tables: ['fiscal_series', 'stock_items', 'tabela_nova'],
      fetchImpl: nuvem({}),
    });
    check('séries do posto, saldos derivados e tabelas desconhecidas NÃO descem',
      res.tables === 0);
  }

  // 6. O posto GANHA: a versão da nuvem não é aplicada.
  {
    const p = posto({ 'products|p1': { id: 'p1', name: 'Local', version: 9 } });
    const res = await LS.pullAndApply({
      ...base, query: p.query, run: p.run, tables: ['products'],
      fetchImpl: nuvem({ products: pagina([{ id: 'p1', name: 'Nuvem', version: 2 }]) }),
    });
    check('o posto GANHA quando tem versão mais alta — nada é sobreposto',
      res.applied === 0 && res.skipped === 1);
    check('  e o conflito fica REGISTADO no posto',
      p.escrito.some((e) => e.sql.includes('sync_conflicts') && e.sql.includes('INSERT INTO')));
  }

  // 7. Tabela sem coluna de tempo não é lida como "está tudo em dia".
  {
    const p = posto();
    const res = await LS.pullAndApply({
      ...base, query: p.query, run: p.run, tables: ['products'],
      fetchImpl: nuvem({ products: pagina([], { incremental: false, cursor: null }) }),
    });
    check('tabela sem coluna de tempo é reportada, não dada por sincronizada',
      res.received === 0 && res.applied === 0);
    check('  e o cursor NÃO avança (senão dava-se por em dia)',
      !p.escrito.some((e) => e.sql.includes('sync_cursors') && e.sql.includes('INSERT INTO')));
  }

  // 8. Sem rede: não estraga nada.
  {
    const p = posto();
    const res = await LS.pullAndApply({
      ...base, query: p.query, run: p.run, tables: ['products'],
      fetchImpl: async () => { throw new Error('sem rede'); },
    });
    check('sem rede: não rebenta e diz que ficou por fazer', res.remaining === true);
    check('  e nada foi aplicado', res.applied === 0);
  }

  // 9. Nada é apagado por omissão da nuvem.
  {
    const p = posto({ 'products|so-local': { id: 'so-local', name: 'Só aqui' } });
    await LS.pullAndApply({
      ...base, query: p.query, run: p.run, tables: ['products'],
      fetchImpl: nuvem({ products: pagina([]) }),
    });
    check('NADA é apagado por a nuvem não o ter (podia ser trabalho por subir)',
      !p.escrito.some((e) => /DELETE/i.test(e.sql)));
  }

  console.log();
  for (const [st, nome] of r) console.log(st, nome);
  const falhas = r.filter(([s]) => s !== 'OK  ').length;
  console.log(`\n${r.length - falhas}/${r.length} passaram`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('rebentou:', e.message); process.exit(1); });
