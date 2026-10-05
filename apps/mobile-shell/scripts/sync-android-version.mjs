/**
 * Escreve a versão do produto no projeto Android (`versionName` + `versionCode`).
 *
 * A versão é UMA só para Windows e Android e sai de `apps/desktop/package.json`
 * (a atualização obrigatória compara versões; duas fontes acabavam por divergir).
 *
 * PORQUÊ um script à parte: o projeto Android (`android/`) só existe DEPOIS de
 * `cap add android`, e o `prepare-web.mjs` corre ANTES. Na build do CI isso fazia
 * o passo saltar em silêncio e o APK saía sempre "versão 1.0" (versionCode 1),
 * por muito que a app subisse de versão. Corre-se por isso depois do `cap add`
 * (e também no fim do `prepare-web`, para quem já tem o projeto gerado).
 *
 * `versionCode` (o Android exige que cresça a cada publicação) deriva da própria
 * versão: 1.4.0 → 10400 (maior*10000 + menor*100 + correção). Assim é sempre
 * crescente e igual para o mesmo número de versão, sem depender de contadores.
 *
 *   node scripts/sync-android-version.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shell = path.resolve(here, '..');
const repo = path.resolve(shell, '..', '..');

export function appVersion() {
  return JSON.parse(fs.readFileSync(path.join(repo, 'apps', 'desktop', 'package.json'), 'utf-8')).version;
}

/** 1.4.0 → 10400. Devolve null se a versão não for X.Y.Z (aí mantém-se o +1 antigo). */
export function versionCodeFor(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : null;
}

export function syncAndroidVersion(log = (m) => process.stdout.write(`  ${m}\n`)) {
  const version = appVersion();
  const gradle = path.join(shell, 'android', 'app', 'build.gradle');
  if (!fs.existsSync(gradle)) {
    log('Android: projeto ainda não gerado — versão por escrever (corra depois do cap add android).');
    return false;
  }
  let g = fs.readFileSync(gradle, 'utf-8');
  const nameAtual = /versionName\s+"([^"]+)"/.exec(g)?.[1];
  const codeAtual = Number(/versionCode\s+(\d+)/.exec(g)?.[1] ?? 1);
  const code = versionCodeFor(version) ?? codeAtual + 1;
  if (nameAtual === version && codeAtual === code) return true;
  g = g.replace(/versionName\s+"[^"]+"/, `versionName "${version}"`).replace(/versionCode\s+\d+/, `versionCode ${code}`);
  fs.writeFileSync(gradle, g);
  log(`Android: versão ${nameAtual} → ${version} (versionCode ${codeAtual} → ${code})`);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  if (!syncAndroidVersion()) process.exit(1);
}
