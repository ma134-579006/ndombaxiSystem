// Prova da BARREIRA do servidor local: sem ela, incluir os binários do
// PostgreSQL no instalador punha cada posto a falar com uma base VAZIA.
const path = require('node:path');
const { blockedReason, markProvisioned, readReadiness, isProvisionedFor } = require(path.join(__dirname, '..', 'dist', 'index.js'));
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const base = mkdtempSync(path.join(tmpdir(), 'ndombaxi-readiness-'));
const paths = { dataDir: path.join(base, 'pgdata') };
const r = [];
const check = (nome, cond) => r.push([cond ? 'OK  ' : 'FALHA', nome]);

// 1. Estado de fábrica: desligado → bloqueado.
check('desligado nas definições → bloqueado',
  blockedReason(paths, { enabled: false }) !== null);

// 2. LIGADO mas base por provisionar → CONTINUA bloqueado.
//    É este o caso que evita o desastre: alguém liga a opção antes de os dados
//    cá estarem, ou uma atualização traz os binários.
const porProvisionar = blockedReason(paths, { enabled: true });
check('ligado mas sem dados → bloqueado', porProvisionar !== null);
check('  motivo diz que faltam os dados', /sincronizar|dados da empresa/.test(porProvisionar ?? ''));

// 3. Sem ficheiro nenhum, ler o estado não rebenta.
check('estado ausente lê-se como não-provisionado', readReadiness(paths).provisioned === false);

// 4. Depois de provisionado E ligado → passa.
markProvisioned(paths, 'qa-burger-xl');
check('provisionado + ligado → passa', blockedReason(paths, { enabled: true }) === null);

// 5. Provisionado mas DESLIGADO → continua bloqueado (nunca por omissão).
check('provisionado mas desligado → bloqueado',
  blockedReason(paths, { enabled: false }) !== null);

// 6. Não serve os dados de OUTRA empresa.
check('reconhece a empresa provisionada', isProvisionedFor(paths, 'qa-burger-xl') === true);
check('recusa outra empresa', isProvisionedFor(paths, 'outra-empresa') === false);

// 7. O estado guarda quando foi.
const s = readReadiness(paths);
check('regista provisionedAt e syncedAt', !!s.provisionedAt && !!s.syncedAt);

rmSync(base, { recursive: true, force: true });
for (const [st, nome] of r) console.log(st, nome);
const falhas = r.filter(([st]) => st !== 'OK  ').length;
console.log(`\n${r.length - falhas}/${r.length} passaram`);
process.exit(falhas ? 1 : 0);
