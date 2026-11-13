/**
 * QA — utilitários do simulador empresarial (só para ambientes de TESTE).
 * Recusa-se a correr contra algo que não seja localhost ou, com QA_STAGING=1, um
 * anfitrião com "staging" no nome: os cenários criam empresas, vendas e notas de
 * crédito FICTÍCIAS. Produção nunca.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const require = createRequire(path.resolve('apps/local-server/package.json'));
export const pg = require('pg');

export const API = process.env.QA_API ?? 'http://127.0.0.1:3901';
export const DB = process.env.QA_DB ?? 'postgresql://postgres@127.0.0.1:55433/nexus_qa';
// Staging explícito (QA_STAGING=1): só aceita anfitriões cujo nome diga "staging"
// (ex.: ndombaxi-api-staging.onrender.com e o serviço Aiven ndombaxi-staging-…).
// Produção nunca passa nesta verificação: os nomes dela não têm "staging".
export const STAGING = process.env.QA_STAGING === '1';
for (const u of [API, DB]) {
  const host = new URL(u).hostname;
  const local = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const staging = STAGING && /(^|[.-])staging([.-]|$)/.test(host);
  if (!local && !staging) {
    throw new Error(`QA recusa-se a correr fora de localhost${STAGING ? ' ou de um anfitrião "staging"' : ''} (${host}).`);
  }
}

export const uuid = randomUUID;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pedido HTTP à API local. Devolve { status, body, ms }. */
export async function call(method, url, { token, body, headers } = {}) {
  const t0 = performance.now();
  const res = await fetch(API + url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* texto */ }
  return { status: res.status, body: parsed, ms: performance.now() - t0 };
}

/** Igual a `call`, mas falha se o estado não for 2xx. */
export async function ok(method, url, opts) {
  const r = await call(method, url, opts);
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`${method} ${url} → ${r.status}: ${JSON.stringify(r.body).slice(0, 400)}`);
  }
  return r.body;
}

export function jwtPayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}

/** Ligação directa ao Postgres de teste, com search_path no schema da empresa. */
export async function db(schema) {
  // Aiven (staging): TLS obrigatório; com QA_DB_CA verifica o certificado da CA do projeto.
  const remote = !['127.0.0.1', 'localhost', '::1'].includes(new URL(DB).hostname);
  const ssl = remote ? (process.env.QA_DB_CA ? { ca: (await import('node:fs')).readFileSync(process.env.QA_DB_CA, 'utf8') } : { rejectUnauthorized: false }) : undefined;
  const c = new pg.Client({ connectionString: remote ? DB.replace(/[?&]sslmode=[^&]*/, '') : DB, ssl });
  await c.connect();
  if (schema) await c.query(`SET search_path TO "${schema}"`);
  return c;
}

/** Registo de resultados: cada verificação vira uma linha do relatório. */
export class Report {
  constructor(name) { this.name = name; this.rows = []; }
  check(id, desc, pass, evidence = '') {
    this.rows.push({ id, desc, pass: !!pass, evidence: String(evidence).slice(0, 300) });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${evidence ? ` — ${String(evidence).slice(0, 200)}` : ''}`);
  }
  summary() {
    const p = this.rows.filter((r) => r.pass).length;
    return { name: this.name, total: this.rows.length, passed: p, failed: this.rows.length - p, rows: this.rows };
  }
}

/** Percentil de uma lista de números. */
export function pct(list, p) {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
