/**
 * QA — câmaras públicas (só localhost). Simula a Windy Webcams e o OpenStreetMap (Overpass)
 * num servidor local; a API de QA tem de arrancar com:
 *   WINDY_WEBCAMS_URL=http://127.0.0.1:3998/windy  OVERPASS_URL=http://127.0.0.1:3998/overpass
 *
 * Casos: botão "Testar" (chave válida / inválida), câmaras perto (Windy + OSM), nada até 250 km
 * → procura numa área maior e devolve as mais próximas, OSM sobrecarregado não esconde a Windy,
 * sem chave + OSM em baixo → "indisponível", sem chave + OSM sem câmaras → lista vazia (não erro),
 * User-Agent do OSM com nome e endereço. No fim desliga a integração (estado de origem).
 *
 * Uso: node qa/camaras-publicas.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { ok, call, db, Report } from './lib.mjs';

const require = createRequire(import.meta.url);
const S = JSON.parse(fs.readFileSync(process.env.QA_CINCO ?? 'qa/.cinco.json', 'utf8'));
const R = new Report('camaras-publicas');
const GOOD = 'chave-boa-qa';
const tok = (r) => r.tokens?.accessToken ?? r.accessToken;

// ── servidor simulado ──────────────────────────────────────────────────────
const mode = { osm: 'ok', windyNear: true };
const seen = { ua: '', windyQs: [] };
const cam = (id, lat, lng, title) => ({ webcamId: id, title, status: 'active', location: { latitude: lat, longitude: lng, city: title }, images: { current: { preview: `https://img.test/${id}.jpg` } }, player: { day: `https://player.test/${id}` }, urls: { detail: `https://windy.test/${id}` }, lastUpdatedOn: new Date().toISOString() });
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/overpass')) {
      seen.ua = req.headers['user-agent'] ?? '';
      if (mode.osm === 'busy') { res.writeHead(502); res.end('at capacity'); return; }
      const els = mode.osm === 'empty' ? [] : [{ type: 'node', id: 1, lat: -8.84, lon: 13.24, tags: { name: 'Marginal (OSM)', 'contact:webcam': 'https://cam.test/marginal.jpg' } }];
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ elements: els })); return;
    }
    if (u.pathname.startsWith('/windy')) {
      seen.windyQs.push(u.search);
      if (req.headers['x-windy-api-key'] !== GOOD) { res.writeHead(401); res.end('{}'); return; }
      let webcams = [];
      if (u.searchParams.get('nearby')) webcams = mode.windyNear ? [cam(10, -8.81, 13.23, 'Luanda Baía'), cam(11, -12.58, 13.4, 'Benguela')] : [];
      else if (u.searchParams.get('bbox')) webcams = [cam(20, -15.2, 12.1, 'Namibe'), cam(21, -25.9, 32.6, 'Maputo')];
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ total: webcams.length, webcams })); return;
    }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => srv.listen(3998, '127.0.0.1', r));

const pub = await db('nexus_public');
const argon2 = require('../apps/api/node_modules/argon2');
const tag = String(Date.now()).slice(-6);
const saEmail = `qa-cam-${tag}@qa.test`, saPass = randomBytes(9).toString('base64url');
await pub.query(`INSERT INTO nexus_public.platform_users (id, email, "passwordHash", name, role, "isActive", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'QA Câmaras', 'SUPER_ADMIN', true, now(), now())`, [saEmail, await argon2.hash(saPass, { type: argon2.argon2id })]);
const SA = tok(await ok('POST', '/auth/super-admin/login', { body: { email: saEmail, password: saPass } }));
const adm = tok(await ok('POST', '/auth/login', { body: { email: S.E.email, password: S.pass } }));
// Cada caso com coordenadas diferentes (a API guarda 5 min em cache por ~1 km).
let n = 0; const off = (Number(tag) % 500) * 0.02; const pt = () => { n += 1; return { lat: -8.8383 + n * 0.05, lng: 13.2344 + off }; };
const search = async (p) => (await ok('GET', `/cameras/public/nearby?lat=${p.lat}&lng=${p.lng}&auto=1`, { token: adm }));

// ── botão Testar ───────────────────────────────────────────────────────────
await ok('PATCH', '/super-admin/integrations/PUBLIC_WEBCAMS', { token: SA, body: { enabled: true, secret: 'chave-errada' } });
let t = await ok('POST', '/super-admin/integrations/PUBLIC_WEBCAMS/test', { token: SA });
R.check('CAM-1', 'Testar com chave errada → "Chave da Windy inválida"', !t.ok && /inválida/.test(t.status), t.status);
await ok('PATCH', '/super-admin/integrations/PUBLIC_WEBCAMS', { token: SA, body: { enabled: true, secret: GOOD } });
t = await ok('POST', '/super-admin/integrations/PUBLIC_WEBCAMS/test', { token: SA });
R.check('CAM-2', 'Testar com chave boa → "Chave válida · N câmaras"', t.ok && /válida/.test(t.status), t.status);

// ── pesquisas ──────────────────────────────────────────────────────────────
let r = await search(pt());
R.check('CAM-3', 'com chave: junta Windy + OSM, a mais perto primeiro', !r.error && r.items.length === 3 && (r.sources ?? []).sort().join() === 'osm,windy', JSON.stringify({ n: r.items?.length, src: r.sources, first: r.items?.[0]?.title }));
R.check('CAM-4', 'o pedido ao OSM leva User-Agent com nome e endereço', /LPS-Vendas\/.+https:\/\//.test(seen.ua), seen.ua);
mode.osm = 'busy';
r = await search(pt());
R.check('CAM-5', 'OSM sobrecarregado (502) não esconde a Windy', !r.error && r.items.some((i) => i.source === 'windy'), JSON.stringify({ n: r.items?.length, err: r.error }));
mode.windyNear = false; mode.osm = 'empty';
r = await search(pt());
R.check('CAM-6', 'nada até 250 km → procura numa área maior e devolve as mais próximas (Namibe antes de Maputo)', !r.error && r.expanded && r.items[0]?.title === 'Namibe', JSON.stringify({ n: r.items?.length, exp: r.expanded, first: r.items?.[0]?.title, qs: seen.windyQs.at(-1) }));
await ok('PATCH', '/super-admin/integrations/PUBLIC_WEBCAMS', { token: SA, body: { enabled: false } });
mode.osm = 'busy';
r = await search(pt());
R.check('CAM-7', 'sem chave + OSM em baixo → "indisponível"', /indispon/.test(r.error ?? ''), r.error);
mode.osm = 'empty';
r = await search(pt());
R.check('CAM-8', 'sem chave + OSM sem câmaras → lista vazia, sem erro', !r.error && r.items.length === 0, JSON.stringify(r).slice(0, 120));
mode.osm = 'ok';
r = await search(pt());
R.check('CAM-9', 'sem chave + OSM com câmaras → mostra as do OSM', !r.error && r.items.length >= 1 && r.items[0].source === 'osm', JSON.stringify({ n: r.items?.length }));
const anon = await call('GET', '/cameras/public/nearby?lat=1&lng=1&auto=1');
R.check('CAM-10', 'sem sessão → 401', anon.status === 401, `${anon.status}`);

await pub.query('DELETE FROM nexus_public.platform_users WHERE email = $1', [saEmail]).catch(() => undefined);
await pub.end(); srv.close();
fs.mkdirSync('qa/out', { recursive: true });
const s = R.summary();
fs.writeFileSync('qa/out/camaras-publicas.json', JSON.stringify(s, null, 1));
console.log(`\n${s.passed}/${s.total} passaram; ${s.failed} falharam`);
