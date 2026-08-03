/**
 * Prova do motor da atualização obrigatória.
 *
 * Esta é a peça que pode trancar um lojista fora do próprio negócio. Os casos
 * abaixo são, quase todos, formas de o trancar por engano — é isso que aqui se
 * impede.
 */
const path = require('node:path');
const { decideUpdate, readyToBlock, compareVersions } =
  require(path.join(__dirname, '..', 'dist', 'index.js'));

const r = [];
const check = (nome, cond) => r.push([cond ? 'OK  ' : 'FALHA', nome]);

const WIN = { platform: 'windows' };
const base = {
  platform: 'windows',
  version: '1.3.0',
  minSupported: null,
  downloadPageUrl: 'https://ndombaxisystem.com/baixar',
  notes: ['Correções de segurança'],
  fixes: [],
  mandatory: false,
  releasedAt: '2026-08-03T00:00:00.000Z',
};

// ── Comparação de versões ───────────────────────────────────────────
check('1.2.9 < 1.2.10 (não é comparação de texto)', compareVersions('1.2.9', '1.2.10') < 0);
check('1.3 == 1.3.0', compareVersions('1.3', '1.3.0') === 0);
check('1.10.0 > 1.9.9', compareVersions('1.10.0', '1.9.9') > 0);

// ── O caminho normal ────────────────────────────────────────────────
check('mesma versão → nada a fazer', decideUpdate('1.3.0', base, WIN).state === 'none');
check('versão mais recente, não obrigatória → aviso',
  decideUpdate('1.2.4', base, WIN).state === 'optional');
check('versão mais recente e obrigatória → TRANCA',
  decideUpdate('1.2.4', { ...base, mandatory: true }, WIN).state === 'mandatory');
check('abaixo do mínimo suportado → TRANCA',
  decideUpdate('1.2.4', { ...base, minSupported: '1.3.0' }, WIN).state === 'mandatory');
check('  e diz porquê (vai para o registo do posto)',
  /mínimo/.test(decideUpdate('1.2.4', { ...base, minSupported: '1.3.0' }, WIN).reason));

// ── Não trancar quem não deve ser trancado ──────────────────────────

// OFFLINE. O caso mais importante de todos: sem resposta do servidor a loja
// vende. Bloquear aqui seria transformar uma falha da operadora numa paragem.
check('sem resposta do servidor (offline) → NUNCA tranca',
  decideUpdate('1.0.0', null, WIN).state === 'none');

// Um erro do servidor a devolver a versão do Android (3.0.0) a um posto Windows
// trancava todas as caixas Windows de uma vez.
check('versão de OUTRA plataforma → ignorada',
  decideUpdate('1.2.4', { ...base, platform: 'android', version: '3.0.0', mandatory: true }, WIN).state === 'none');

// Uma versão de teste publicada por engano não pode trancar a produção.
check('canal diferente (teste) → ignorado',
  decideUpdate('1.2.4', { ...base, channel: 'teste', mandatory: true }, WIN).state === 'none');
check('canal ausente conta como produção',
  decideUpdate('1.2.4', { ...base, mandatory: true }, WIN).state === 'mandatory');

// Trancar sem dar a saída é o pior desfecho possível.
check('obrigatória SEM página de downloads → desce a aviso',
  decideUpdate('1.2.4', { ...base, mandatory: true, downloadPageUrl: null }, WIN).state === 'optional');
check('página não-https (http/file) → não serve para trancar',
  decideUpdate('1.2.4', { ...base, mandatory: true, downloadPageUrl: 'file:///C:/x.exe' }, WIN).state === 'optional');

// Lixo e enganos.
check('resposta sem versão → ignorada', decideUpdate('1.2.4', { platform: 'windows' }, WIN).state === 'none');
check('resposta que não é objeto → ignorada', decideUpdate('1.2.4', 'nova versao!', WIN).state === 'none');
check('versão instalada desconhecida → nunca tranca',
  decideUpdate('', { ...base, mandatory: true }, WIN).state === 'none');
check('servidor mais ATRASADO que o posto → nada a fazer',
  decideUpdate('2.0.0', { ...base, mandatory: true }, WIN).state === 'none');
check('mínimo incoerente (acima do que existe) não tranca sozinho',
  decideUpdate('1.3.0', { ...base, minSupported: '9.9.9' }, WIN).state === 'none');

// A decisão leva o que a janela precisa de mostrar.
const d = decideUpdate('1.2.4', { ...base, mandatory: true }, WIN);
check('a decisão leva a versão instalada', d.current === '1.2.4');
check('a decisão leva a versão nova', d.release.version === '1.3.0');
check('a decisão leva as melhorias', d.release.notes[0] === 'Correções de segurança');
check('a decisão leva a página oficial', d.release.downloadPageUrl === 'https://ndombaxisystem.com/baixar');

// ── Não perder trabalho: sincronizar ANTES de trancar ───────────────
check('fila vazia → pode trancar', readyToBlock({ pending: 0, online: true, syncing: false }).canBlock === true);

const comPendentes = readyToBlock({ pending: 37, online: true, syncing: false });
check('37 por enviar, com rede → NÃO tranca ainda', comPendentes.canBlock === false);
check('  e manda sincronizar primeiro', comPendentes.syncFirst === true);
check('  e diz quantas faltam', /37/.test(comPendentes.reason));

const jaSincroniza = readyToBlock({ pending: 37, online: true, syncing: true });
check('já a sincronizar → não pede outra sincronização', jaSincroniza.syncFirst === false);

// Cinco dias de trabalho por enviar e ainda sem rede: trancar aqui deixava o
// lojista sem sistema E sem forma de salvar o que fez.
const semRede = readyToBlock({ pending: 412, online: false, syncing: false });
check('pendentes e SEM rede → não tranca (a loja continua a trabalhar)', semRede.canBlock === false);
check('  e não tenta sincronizar sem rede', semRede.syncFirst === false);

for (const [e, n] of r) console.log(e, n);
const falhas = r.filter(([e]) => e !== 'OK  ').length;
console.log(`\n${r.length - falhas}/${r.length}`);
process.exit(falhas ? 1 : 0);
