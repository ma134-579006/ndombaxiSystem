/**
 * Prova da POLÍTICA DE REPLICAÇÃO.
 *
 * É o ficheiro mais perigoso do sistema: um erro aqui não rebenta — escreve a
 * versão errada de um registo e só se descobre meses depois, num relatório que
 * não bate certo. Estes testes existem para que isso não aconteça.
 */
const path = require('node:path');
const P = require(path.join(__dirname, '..', 'dist', 'index.js'));

const r = [];
const check = (nome, cond, extra = '') => {
  r.push([cond ? 'OK  ' : 'FALHA', nome + (extra ? ` — ${extra}` : '')]);
  return cond;
};

// ── Classificação ────────────────────────────────────────────
check('faturas são FISCAIS', P.classify('invoices') === 'fiscal');
check('movimentos de stock são ADITIVOS', P.classify('stock_movements') === 'additive');
check('SALDO de stock é DERIVADO (nunca replicado)', P.classify('stock_items') === 'derived');
check('  e por isso não é replicado', P.isReplicated('stock_items') === false);
check('séries fiscais ficam NO POSTO', P.classify('fiscal_series') === 'device');
check('  e por isso não são replicadas', P.isReplicated('fiscal_series') === false);
check('utilizadores decidem-se na NUVEM', P.classify('users') === 'cloud');
check('  e por isso o posto não os empurra', P.isReplicated('users') === false);
check('produtos são CATÁLOGO', P.classify('products') === 'catalog');
check('uma tabela nova é DESCONHECIDA (não se adivinha)',
  P.classify('tabela_inventada_amanha') === 'unknown');
check('  e desconhecida NÃO é replicada', P.isReplicated('tabela_inventada_amanha') === false);
check('tabelas desconhecidas são DENUNCIADAS',
  P.unknownTables(['products', 'nova_tabela']).join() === 'nova_tabela');

// ── Fiscal: união, nunca escolha ─────────────────────────────
{
  const a = { id: 'f1', version: 1, updatedAt: '2026-08-01T10:00:00Z' };
  const d = P.resolve('invoices', a, { ...a });
  check('duas cópias iguais de uma fatura → ficam as duas, sem conflito',
    d.winner === 'both' && d.conflict === false);
}
{
  // Isto NÃO devia poder acontecer (série por posto). Se acontecer, é sintoma
  // de avaria grave — e tem de ser gritado, não remendado em silêncio.
  const local = { id: 'f1', version: 1, updatedAt: '2026-08-01T10:00:00Z' };
  const remote = { id: 'f1', version: 2, updatedAt: '2026-08-01T11:00:00Z' };
  const d = P.resolve('invoices', local, remote);
  check('MESMA fatura com duas versões → conflito GRITADO, nada é escolhido',
    d.winner === 'both' && d.conflict === true && /série por posto foi violada/.test(d.reason));
}
{
  const d = P.resolve('stock_movements',
    { id: 'm1', version: 1 }, { id: 'm1', version: 1 });
  check('movimentos de stock somam-se (ficam os dois)', d.winner === 'both');
}

// ── Catálogo: última escrita ganha ───────────────────────────
{
  const d = P.resolve('products',
    { id: 'p1', version: 5, updatedAt: '2026-08-01T09:00:00Z' },
    { id: 'p1', version: 3, updatedAt: '2026-08-01T23:00:00Z' });
  check('a VERSÃO manda sobre a data (relógios mentem)',
    d.winner === 'local' && /versão mais alta/.test(d.reason));
}
{
  const d = P.resolve('products',
    { id: 'p1', updatedAt: '2026-08-01T09:00:00Z' },
    { id: 'p1', updatedAt: '2026-08-01T23:00:00Z' });
  check('sem versão, ganha a alteração mais recente', d.winner === 'remote');
}
{
  const d = P.resolve('products',
    { id: 'p1', version: 2, updatedAt: '2026-08-01T09:00:00Z' },
    { id: 'p1', version: 3, updatedAt: '2026-08-01T09:00:00Z' });
  check('  e o que PERDEU fica registado como conflito', d.conflict === true);
}
{
  // O critério não interessa; interessa que os DOIS lados cheguem ao mesmo.
  const local = { id: 'p1', version: 2, updatedAt: '2026-08-01T09:00:00Z', deviceId: 'posto-B' };
  const remote = { id: 'p1', version: 2, updatedAt: '2026-08-01T09:00:00Z', deviceId: 'posto-A' };
  const doPosto = P.resolve('products', local, remote);
  // Do outro lado, os papéis trocam: o que era "local" passa a "remoto".
  const daNuvem = P.resolve('products', remote, local);
  const mesmoVencedor =
    (doPosto.winner === 'local' && daNuvem.winner === 'remote')
    || (doPosto.winner === 'remote' && daNuvem.winner === 'local');
  check('empate → os dois lados escolhem O MESMO vencedor (não trocam para sempre)',
    mesmoVencedor, `${doPosto.winner} / ${daNuvem.winner}`);
}
{
  const d = P.resolve('products',
    { id: 'p1', version: 2, updatedAt: '2026-08-01T09:00:00Z', deviceId: 'A' },
    { id: 'p1', version: 2, updatedAt: '2026-08-01T09:00:00Z', deviceId: 'A' });
  check('versões mesmo equivalentes não contam como conflito', d.conflict === false);
}

// ── Existência ───────────────────────────────────────────────
check('só na nuvem → desce',
  P.resolve('products', null, { id: 'p1' }).winner === 'remote');
check('só no posto → sobe',
  P.resolve('products', { id: 'p1' }, null).winner === 'local');
check('em lado nenhum → nada a fazer',
  P.resolve('products', null, null).winner === 'neither');

// ── Apagados (lápides) ───────────────────────────────────────
{
  const d = P.resolve('products',
    { id: 'p1', version: 3, deleted: true },
    { id: 'p1', version: 2, deleted: false });
  check('apagar é uma alteração como outra qualquer (versão mais alta ganha)',
    d.winner === 'local' && d.conflict === true);
}

// ── Classes que não negoceiam ────────────────────────────────
check('nuvem manda em utilizadores, mesmo que o posto tenha versão mais alta',
  P.resolve('users', { id: 'u1', version: 99 }, { id: 'u1', version: 1 }).winner === 'remote');
check('série fiscal fica no posto, mesmo que a nuvem tenha versão mais alta',
  P.resolve('fiscal_series', { id: 's1', version: 1 }, { id: 's1', version: 99 }).winner === 'local');
check('saldo de stock não é escolhido — é recalculado',
  P.resolve('stock_items', { id: 'x', version: 1 }, { id: 'x', version: 2 }).winner === 'neither');
check('tabela desconhecida não é tocada',
  P.resolve('tabela_nova', { id: 'x' }, { id: 'x' }).winner === 'neither');

// ── Cobertura: as tabelas reais do sistema estão classificadas ──
const REAIS = 'stores users product_categories products customers fiscal_series document_counters invoices fiscal_signing_keys invoice_items suppliers warehouses stock_items stock_movements purchase_orders purchase_order_items web_orders web_order_items employees employee_consumptions salary_advances payroll_runs payroll_items site_settings site_pages payment_methods payment_proofs order_messages cash_sessions cash_movements expenses receivables receivable_payments payables payable_payments bank_transactions leave_requests cameras tenant_audit_log stock_counts stock_count_items promotions loyalty_cards loyalty_movements product_batches staff_messages staff_chat_reads ai_messages customer_messages restaurant_tables restaurant_orders restaurant_order_items product_recipes service_orders service_equipments service_order_items hotel_rooms hotel_housekeeping hotel_maintenance hotel_reservations hotel_folio_items clinic_patients clinic_appointments clinic_consultations backups clinic_professionals clinic_prescriptions clinic_prescription_items clinic_vitals clinic_beds clinic_admissions clinic_triage clinic_exams clinic_insurers clinic_insurer_claims'.split(' ');
const porClassificar = P.unknownTables(REAIS);
check('TODAS as tabelas reais estão classificadas', porClassificar.length === 0,
  porClassificar.length ? `faltam: ${porClassificar.join(', ')}` : `${REAIS.length} tabelas`);

console.log();
for (const [st, nome] of r) console.log(st, nome);
const falhas = r.filter(([s]) => s !== 'OK  ').length;
console.log(`\n${r.length - falhas}/${r.length} passaram`);
process.exit(falhas ? 1 : 0);
