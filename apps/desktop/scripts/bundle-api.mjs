/**
 * Junta a API num ÚNICO ficheiro e deixa em `node_modules` só o que não pode
 * ser empacotado — para o instalador Windows instalar depressa.
 *
 * Porquê: o `pnpm deploy` deixava a API com ~15 000 ficheiros pequenos (rxjs,
 * lodash, class-validator, …) mais ~850 em `dist/`. O NSIS cria-os um a um e o
 * antivírus do Windows analisa cada um — a instalação arrastava-se por
 * minutos. Empacotada, a API passa a ser um `dist/main.js` e ~1 700 ficheiros
 * (Prisma com os motores, argon2, pdfkit e as suas dependências).
 *
 * Fica FORA do pacote (e em `node_modules`) apenas:
 *   • Prisma (`@prisma/client`, o cliente gerado `.prisma/client` com o motor
 *     nativo, e a CLI `prisma`, que o supervisor usa para `db push`);
 *   • `argon2` (módulo nativo `.node`);
 *   • `pdfkit` (lê as fontes .afm do disco por caminho relativo).
 * (O Swagger só existe fora de produção — o servidor local corre em produção.)
 * …e as dependências de cada um destes.
 *
 * O código só se executa no build; não muda nada no comportamento da API.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** Pacotes que ficam fora do ficheiro único (e as suas dependências ficam no disco). */
const EXTERNOS_NO_DISCO = ['@prisma/client', 'prisma', 'argon2', 'pdfkit'];

/**
 * Imports OPCIONAIS do Nest que não estão instalados: o próprio Nest carrega-os
 * dentro de try/catch e segue sem eles. Ficam como `require` normal (falha
 * silenciosa, igual a hoje) em vez de partirem o empacotamento.
 */
const OPCIONAIS_AUSENTES = [
  '@nestjs/microservices',
  '@nestjs/microservices/microservices-module',
  'class-transformer/storage',
];

function contarFicheiros(dir) {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else n += 1;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return n;
}

/** Pasta real de um pacote, resolvido a partir de `deDir` (segue os atalhos do pnpm). */
function pastaDoPacote(nome, deDir) {
  try {
    return fs.realpathSync(path.dirname(require.resolve(`${nome}/package.json`, { paths: [deDir] })));
  } catch {
    // Pacotes sem `package.json` exportado: procura a pasta à mão pela cadeia de node_modules.
    let d = deDir;
    for (;;) {
      const cand = path.join(d, 'node_modules', nome);
      if (fs.existsSync(path.join(cand, 'package.json'))) return fs.realpathSync(cand);
      const pai = path.dirname(d);
      if (pai === d) return null;
      d = pai;
    }
  }
}

/** Todas as pastas reais necessárias para os pacotes externos (fecho das dependências). */
function fechoDeDependencias(apiDir) {
  const visto = new Set();
  const fila = EXTERNOS_NO_DISCO.map((n) => [n, apiDir, true]);
  while (fila.length) {
    const [nome, deDir, obrigatorio] = fila.shift();
    const dir = pastaDoPacote(nome, deDir);
    if (!dir) {
      if (obrigatorio) throw new Error(`Dependência em falta para o servidor local: ${nome}`);
      continue; // opcional/de plataforma que não veio — igual ao que o Node faria
    }
    if (visto.has(dir)) continue;
    visto.add(dir);
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    for (const d of Object.keys(pj.dependencies ?? {})) fila.push([d, dir, true]);
    for (const d of Object.keys(pj.optionalDependencies ?? {})) fila.push([d, dir, false]);
    // Pares (peers): ficam se o pnpm os instalou; se não, não são precisos aqui.
    for (const d of Object.keys(pj.peerDependencies ?? {})) fila.push([d, dir, false]);
  }
  return visto;
}

/** Remove atalhos (symlinks) cujo destino deixou de existir. */
function limparAtalhosPartidos(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) {
      if (!fs.existsSync(p)) fs.rmSync(p, { force: true });
    } else if (e.isDirectory()) {
      limparAtalhosPartidos(p);
    }
  }
}

export async function empacotarApi(apiDir, log = (m) => process.stdout.write(`  ${m}\n`)) {
  const antes = contarFicheiros(apiDir);
  const entrada = path.join(apiDir, 'dist', 'main.js');
  if (!fs.existsSync(entrada)) throw new Error('Falta dist/main.js para empacotar.');

  // Primeiro o que tem de ficar no disco: se faltar algo, falha ANTES de mexer em dist/.
  const manter = fechoDeDependencias(apiDir);

  // 1. Um só ficheiro com a API e as dependências puras-JS.
  const { build } = await import('esbuild');
  const saidaTmp = path.join(apiDir, 'dist-bundle', 'main.js');
  fs.rmSync(path.dirname(saidaTmp), { recursive: true, force: true });
  await build({
    entryPoints: [entrada],
    outfile: saidaTmp,
    bundle: true,
    platform: 'node',
    target: 'node20',
    // O Nest usa os nomes das classes (injeção de dependências, logs) — não
    // podem ser trocados pela minificação nem pelo renomear do esbuild.
    keepNames: true,
    minify: false,
    external: [...EXTERNOS_NO_DISCO, '.prisma/client', ...OPCIONAIS_AUSENTES],
    logLevel: 'warning',
  });
  fs.rmSync(path.join(apiDir, 'dist'), { recursive: true, force: true });
  fs.renameSync(path.dirname(saidaTmp), path.join(apiDir, 'dist'));

  // 2. node_modules só com o fecho dos pacotes externos.
  const nm = path.join(apiDir, 'node_modules');
  const dentroDe = (p) => [...manter].some((m) => m === p || m.startsWith(p + path.sep) || p.startsWith(m + path.sep));

  // 2a. Armazém do pnpm: apaga as entradas `.pnpm/<pacote@versão>` sem nada a manter.
  const loja = path.join(nm, '.pnpm');
  if (fs.existsSync(loja)) {
    for (const e of fs.readdirSync(loja)) {
      if (e === 'node_modules') continue; // atalhos içados — tratados no fim
      const p = fs.realpathSync(path.join(loja, e));
      if (!dentroDe(p)) fs.rmSync(p, { recursive: true, force: true });
    }
  }
  // 2b. Pacotes de topo (cópias reais ou atalhos) que já não são precisos.
  //     `.prisma` é o cliente gerado — tem de ficar.
  for (const e of fs.readdirSync(nm)) {
    if (e === '.pnpm' || e === '.prisma') continue;
    const p = path.join(nm, e);
    if (e === '.bin' || e === '.modules.yaml') { fs.rmSync(p, { recursive: true, force: true }); continue; }
    const nomes = e.startsWith('@') ? fs.readdirSync(p).map((s) => path.join(e, s)) : [e];
    for (const n of nomes) {
      const q = path.join(nm, n);
      let real = null;
      try { real = fs.realpathSync(q); } catch { /* atalho partido */ }
      if (!real || !dentroDe(real)) fs.rmSync(q, { recursive: true, force: true });
    }
    if (e.startsWith('@') && fs.existsSync(p) && fs.readdirSync(p).length === 0) fs.rmSync(p, { recursive: true });
  }
  limparAtalhosPartidos(nm);

  // 3. Garantias: o que fica fora do pacote tem de se encontrar a partir de dist/.
  const deDist = path.join(apiDir, 'dist');
  for (const n of EXTERNOS_NO_DISCO) {
    if (!pastaDoPacote(n, deDist)) throw new Error(`Depois de empacotar, "${n}" já não se encontra a partir de dist/.`);
  }
  if (!fs.existsSync(path.join(nm, '.prisma', 'client', 'index.js'))) {
    throw new Error('Depois de empacotar, o cliente Prisma gerado (.prisma/client) desapareceu.');
  }

  log(`API empacotada: ${antes} → ${contarFicheiros(apiDir)} ficheiros`);
}

// Execução direta (testes): node scripts/bundle-api.mjs <pasta-da-api>
// Corre só quando chamado diretamente (comparação sem maiúsculas: letra da unidade no Windows).
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const alvo = process.argv[2];
  if (!alvo) { console.error('Uso: node scripts/bundle-api.mjs <pasta-da-api>'); process.exit(1); }
  await empacotarApi(path.resolve(alvo));
}
