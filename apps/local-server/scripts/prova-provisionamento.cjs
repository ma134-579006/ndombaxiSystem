/**
 * Prova do PROVISIONAMENTO — a cópia da empresa da nuvem para o posto.
 *
 * O que aqui se protege, por ordem de gravidade:
 *  1. Uma cópia FALHADA não se pode marcar como pronta. Se o fizesse, a
 *     aplicação passava a servir uma empresa incompleta e ninguém dava por isso
 *     até faltar uma fatura.
 *  2. Uma cópia interrompida tem de RETOMAR. Numa ligação fraca, recomeçar do
 *     princípio de cada vez significa nunca terminar.
 *  3. Repetir a cópia não pode estragar o que já lá está.
 *
 * Não precisa de PostgreSQL: a execução de SQL é injetada.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const LS = require(path.join(__dirname, '..', 'dist', 'index.js'));

const r = [];
const check = (nome, cond, extra = '') => {
  r.push([cond ? 'OK  ' : 'FALHA', nome + (extra ? ` — ${extra}` : '')]);
  return cond;
};

/** Nuvem de mentira: 3 tabelas, com dependências e várias páginas. */
function nuvemFalsa({ falharEm = null, paginas = 1 } = {}) {
  const tabelas = [
    { table: 'customers', rows: 2, dependsOn: [] },
    { table: 'invoices', rows: 2 * paginas, dependsOn: ['customers'] },
    { table: 'invoice_items', rows: 1, dependsOn: ['invoices'] },
  ];
  let pedidos = 0;
  const fetchImpl = async (url) => {
    pedidos += 1;
    if (String(url).includes('/snapshot/tables')) {
      return { ok: true, json: async () => tabelas };
    }
    const u = new URL(String(url), 'http://x');
    const table = u.searchParams.get('table');
    const offset = Number(u.searchParams.get('offset'));
    if (falharEm && table === falharEm.table && offset >= falharEm.offset) {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    const pagina = Math.floor(offset / 2);
    const ultima = pagina >= (table === 'invoices' ? paginas - 1 : 0);
    const linhas = ultima && table !== 'invoices'
      ? [{ id: `${table}-1` }]
      : [{ id: `${table}-${pagina}-a` }, { id: `${table}-${pagina}-b` }];
    return { ok: true, json: async () => ({ rows: linhas, done: ultima }) };
  };
  return { fetchImpl, pedidos: () => pedidos };
}

function ambiente() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ndombaxi-prov-'));
  const paths = { dataDir: path.join(base, 'pgdata') };
  const sql = [];
  const run = async (s, p) => { sql.push({ s, p }); };
  return { base, paths, sql, run };
}

const cloud = { apiUrl: 'https://api.exemplo', accessToken: 'tok', companyCode: 'qa-burger-xl' };

(async () => {
  // ── 1. Cópia completa ─────────────────────────────────────
  {
    const e = ambiente();
    const n = nuvemFalsa();
    const res = await LS.provisionFromCloud({
      paths: e.paths, cloud, run: e.run, schema: 'tenant_ab12cd34', fetchImpl: n.fetchImpl,
    });
    check('cópia completa corre até ao fim', res.tables === 3 && res.rows > 0, `${res.rows} linhas`);
    check('  marcou como provisionado', LS.readReadiness(e.paths).provisioned === true);
    check('  a barreira passa a deixar servir',
      LS.blockedReason(e.paths, { enabled: true }) === null);
    check('  guardou a empresa certa', LS.isProvisionedFor(e.paths, 'qa-burger-xl'));
    check('  e recusa outra empresa', !LS.isProvisionedFor(e.paths, 'outra'));
    const primeira = e.sql[0]?.s ?? '';
    check('  insere primeiro a tabela de que as outras dependem',
      primeira.includes('customers'));
    check('  insere com ON CONFLICT DO NOTHING (repetir não estraga)',
      e.sql.every((x) => x.s.includes('ON CONFLICT DO NOTHING')));
    fs.rmSync(e.base, { recursive: true, force: true });
  }

  // ── 2. Cópia FALHADA a meio ───────────────────────────────
  {
    const e = ambiente();
    const n = nuvemFalsa({ falharEm: { table: 'invoices', offset: 0 } });
    let rebentou = false;
    try {
      await LS.provisionFromCloud({
        paths: e.paths, cloud, run: e.run, schema: 'tenant_ab12cd34', fetchImpl: n.fetchImpl,
      });
    } catch { rebentou = true; }
    check('cópia interrompida falha em vez de fingir', rebentou);
    check('  NÃO se marcou como provisionado', LS.readReadiness(e.paths).provisioned !== true);
    check('  a barreira CONTINUA a mandar usar a nuvem',
      LS.blockedReason(e.paths, { enabled: true }) !== null);
    fs.rmSync(e.base, { recursive: true, force: true });
  }

  // ── 3. RETOMA depois de falhar ────────────────────────────
  {
    const e = ambiente();
    // Primeira tentativa: cai ao chegar às faturas.
    try {
      await LS.provisionFromCloud({
        paths: e.paths, cloud, run: e.run, schema: 'tenant_ab12cd34',
        fetchImpl: nuvemFalsa({ falharEm: { table: 'invoices', offset: 0 } }).fetchImpl,
      });
    } catch { /* esperado */ }
    const inseridasAntes = e.sql.length;

    // Segunda tentativa, agora sem falha.
    const res = await LS.provisionFromCloud({
      paths: e.paths, cloud, run: e.run, schema: 'tenant_ab12cd34',
      fetchImpl: nuvemFalsa().fetchImpl,
    });
    check('a 2.ª tentativa retoma em vez de recomeçar', res.resumed === true);
    check('  não volta a copiar a tabela já concluída',
      !e.sql.slice(inseridasAntes).some((x) => x.s.includes('"customers"')));
    check('  e termina', LS.readReadiness(e.paths).provisioned === true);
    fs.rmSync(e.base, { recursive: true, force: true });
  }

  // ── 4. Nuvem sem tabelas ──────────────────────────────────
  {
    const e = ambiente();
    let rebentou = false;
    try {
      await LS.provisionFromCloud({
        paths: e.paths, cloud, run: e.run, schema: 'tenant_ab12cd34',
        fetchImpl: async () => ({ ok: true, json: async () => [] }),
      });
    } catch { rebentou = true; }
    check('uma resposta vazia não passa por cópia boa', rebentou);
    check('  e não marca nada', LS.readReadiness(e.paths).provisioned !== true);
    fs.rmSync(e.base, { recursive: true, force: true });
  }

  // ── 5. Várias páginas ─────────────────────────────────────
  {
    const e = ambiente();
    const res = await LS.provisionFromCloud({
      paths: e.paths, cloud, run: e.run, schema: 'tenant_ab12cd34', pageSize: 2,
      fetchImpl: nuvemFalsa({ paginas: 4 }).fetchImpl,
    });
    const faturas = e.sql.filter((x) => x.s.includes('"invoices"')).length;
    check('percorre TODAS as páginas de uma tabela grande', faturas === 8, `${faturas} linhas`);
    // + 2: `customers` e `invoice_items` têm 1 linha cada nesta nuvem de mentira.
    check('  e conclui', res.rows === faturas + 2, `${res.rows} no total`);
    fs.rmSync(e.base, { recursive: true, force: true });
  }

  console.log();
  for (const [st, nome] of r) console.log(st, nome);
  const falhas = r.filter(([s]) => s !== 'OK  ').length;
  console.log(`\n${r.length - falhas}/${r.length} passaram`);
  process.exit(falhas ? 1 : 0);
})();
