#!/usr/bin/env node
/**
 * Migração do domínio público (etapa 2) — só para o dia em que o novo domínio
 * estiver REGISTADO, configurado e validado. Hoje: produção = ndombaxisystem.com.
 *
 *   node scripts/migrar-dominio.mjs                 → simulação (não escreve nada)
 *   node scripts/migrar-dominio.mjs --apply         → aplica ndombaxisystem.com → lpsvendas.com
 *   node scripts/migrar-dominio.mjs --to outro.com  → outro domínio de destino
 *
 * Só toca na lista explícita abaixo (auditada), preserva fins de linha e NUNCA
 * mexe em `apps/api/src/main.ts` (CORS é por variável de ambiente) nem em
 * identificadores técnicos (ndombaxi://, ndombaxi-api-…, com.ndombaxi.system).
 * Os domínios em runtime (web/API) NÃO precisam de código: definir
 * VITE_PUBLIC_DOMAIN (build do web) e PUBLIC_DOMAIN + CORS_EXTRA_HOSTS (Render).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const toIdx = args.indexOf('--to');
const TO = toIdx >= 0 ? args[toIdx + 1] : 'lpsvendas.com';
const FROM = 'ndombaxisystem.com';

if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(TO ?? '')) {
  console.error('Domínio de destino inválido:', TO);
  process.exit(1);
}

const FILES = [
  // Cabeçalhos CORS estáticos (Cloudflare Pages) e proxies de desenvolvimento
  'apps/web/public/_headers', 'apps/pos/public/_headers', 'apps/store/public/_headers',
  'apps/web/vite.config.ts', 'apps/pos/vite.config.ts', 'apps/store/vite.config.ts',
  // SEO / PWA do site
  'apps/web/index.html', 'apps/web/public/robots.txt', 'apps/web/public/sitemap.xml',
  // Texto que o utilizador vê (assistente, downloads) e página oficial do updater
  'apps/api/src/support/support.service.ts', 'apps/api/src/support/bot-knowledge.json',
  'ml/bot/corpus.py', 'apps/desktop/src/main/updater.ts', 'apps/web/src/sections/Downloads.tsx',
  // Automação e provas
  '.github/workflows/keep-warm.yml', 'apps/pos/scripts/prova-atualizacao-app.cjs',
  'packages/update-core/scripts/prova-atualizacao.cjs',
  // Documentação
  'PROJECT-CONTEXT.md',
];

let total = 0;
for (const rel of FILES) {
  const p = path.join(repo, rel);
  if (!fs.existsSync(p)) { console.log(`  (não existe) ${rel}`); continue; }
  const txt = fs.readFileSync(p, 'utf8');
  const n = txt.split(FROM).length - 1;
  if (!n) continue;
  total += n;
  console.log(`  ${String(n).padStart(2)} × ${rel}`);
  if (apply) fs.writeFileSync(p, txt.split(FROM).join(TO), 'utf8');
}
console.log(`\n${apply ? 'Substituídas' : 'A substituir (simulação)'}: ${total} ocorrência(s) de ${FROM} → ${TO}`);
if (!apply) console.log('Nada foi escrito. Use --apply para aplicar.');
console.log('\nLembrete (fora do código): variáveis VITE_PUBLIC_DOMAIN / PUBLIC_DOMAIN / CORS_EXTRA_HOSTS,');
console.log('Cloudflare Pages, OAuth, SMTP e só no fim o 301. Ver brand/MIGRACAO-DOMINIO.md.');
