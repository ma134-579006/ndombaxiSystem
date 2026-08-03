/**
 * Prova da decisão AUTOMÁTICA de copiar a empresa para o posto.
 *
 * O pedido foi "automático e inteligente". Automático é fácil; o que estes
 * testes verificam é a parte inteligente — ou seja, todos os casos em que a
 * resposta certa é NÃO COPIAR AGORA.
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

function ambiente() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ndombaxi-auto-'));
  return { base, paths: { dataDir: path.join(base, 'pgdata') } };
}
/** Posto ideal: instalado, admin com sessão, sem trabalho em curso, disco livre. */
const ideal = {
  binariesPresent: true,
  isCompanyAdmin: true,
  companyCode: 'qa-burger-xl',
  freeDiskBytes: 50 * 1024 * 1024 * 1024,
  busy: false,
};

const casos = [];
function caso(nome, ctxPatch, esperado, prep) {
  casos.push({ nome, ctxPatch, esperado, prep });
}

// ── COPIA ────────────────────────────────────────────────────
caso('posto pronto e livre → COPIA', {}, true);

// ── NÃO copia (e o motivo importa) ───────────────────────────
caso('sem os binários no instalador → não copia', { binariesPresent: false }, false);
caso('operador de caixa (não admin) → não copia', { isCompanyAdmin: false }, false);
caso('sem empresa na sessão → não copia', { companyCode: null }, false);
caso('caixa a trabalhar → adia', { busy: true }, false);
caso('disco quase cheio → adia', { freeDiskBytes: 500 * 1024 * 1024 }, false);
caso('disco desconhecido não impede', { freeDiskBytes: null }, true);

// ── Já provisionado ──────────────────────────────────────────
caso('já provisionado → não repete', {}, false, (p) => {
  LS.markProvisioned(p, 'qa-burger-xl');
});
caso('já provisionado com OUTRA empresa → recusa copiar por cima', {}, false, (p) => {
  LS.markProvisioned(p, 'outra-empresa');
});

// ── Tentativas falhadas ──────────────────────────────────────
caso('logo a seguir a falhar → espera', {}, false, (p) => {
  LS.recordFailure(p, 'servidor em baixo');
});
caso('depois da espera cumprida → tenta outra vez', { now: new Date(Date.now() + 10 * 60_000) }, true, (p) => {
  LS.recordFailure(p, 'servidor em baixo');
});
caso('sucesso limpa o histórico de falhas', {}, true, (p) => {
  LS.recordFailure(p, 'x'); LS.recordFailure(p, 'x'); LS.recordSuccess(p);
});

for (const c of casos) {
  const e = ambiente();
  if (c.prep) c.prep(e.paths);
  const d = LS.shouldProvision(e.paths, { ...ideal, ...c.ctxPatch });
  const ok = d.provision === c.esperado;
  check(c.nome, ok, d.provision ? 'copia' : d.reason);
  fs.rmSync(e.base, { recursive: true, force: true });
}

// ── A espera cresce, mas tem teto ────────────────────────────
const b1 = LS.backoffMs(1), b2 = LS.backoffMs(2), b5 = LS.backoffMs(5), b99 = LS.backoffMs(99);
check('a espera entre tentativas CRESCE', b1 < b2 && b2 < b5, `${b1 / 1000}s → ${b2 / 1000}s → ${b5 / 1000}s`);
check('  mas tem teto (não desiste para sempre)', b99 === 6 * 60 * 60 * 1000, `${b99 / 3600000}h`);
check('  e sem falhas não há espera', LS.backoffMs(0) === 0);

// ── O motivo é sempre dito (vai para o log do posto) ─────────
{
  const e = ambiente();
  const d = LS.shouldProvision(e.paths, { ...ideal, isCompanyAdmin: false });
  check('diz sempre PORQUÊ (o motivo vai para o log)',
    typeof d.reason === 'string' && d.reason.length > 10, d.reason);
  fs.rmSync(e.base, { recursive: true, force: true });
}

console.log();
for (const [st, nome] of r) console.log(st, nome);
const falhas = r.filter(([s]) => s !== 'OK  ').length;
console.log(`\n${r.length - falhas}/${r.length} passaram`);
process.exit(falhas ? 1 : 0);
