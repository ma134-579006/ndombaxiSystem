/**
 * QA — login e registo estilo Vendus com Google (botão próprio → access token)
 * e Facebook (SDK → access token), mais a configuração "Login & Registo" do
 * Super Admin. Só localhost: simula o Google e a Graph API do Facebook num
 * servidor local; a API de QA tem de arrancar com
 *   GOOGLE_OAUTH_URL=http://127.0.0.1:3997/google  GOOGLE_USERINFO_URL=http://127.0.0.1:3997/google/userinfo
 *   FACEBOOK_GRAPH_URL=http://127.0.0.1:3997/fb
 * No fim desliga o Facebook Login e repõe a aparência (estado de origem).
 *
 * Uso: node qa/login-social.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { ok, call, db, Report } from './lib.mjs';

const require = createRequire(import.meta.url);
const R = new Report('login-social');
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '522636462932-m67fvuutei11ug355aion1sh00h1k2br.apps.googleusercontent.com';
const APP_ID = '1234567890', APP_SECRET = 'segredo-fb-qa';
const tag = String(Date.now()).slice(-7);
const tok = (r) => r.tokens?.accessToken ?? r.accessToken;

// Utilizadores simulados por token.
const G = { [`ya29.qa-${tag}`]: { email: `qa-g-${tag}@qa.test`, aud: CLIENT_ID }, [`ya29.outra-${tag}`]: { email: `qa-g2-${tag}@qa.test`, aud: 'outra-app' } };
const F = { [`fb-${tag}`]: { email: `qa-fb-${tag}@qa.test`, app: APP_ID }, [`fbx-${tag}`]: { email: `qa-fbx-${tag}@qa.test`, app: '999' }, [`fbne-${tag}`]: { email: null, app: APP_ID } };

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (u.pathname === '/google/tokeninfo') {
    const g = G[u.searchParams.get('access_token') ?? ''];
    return g ? send(200, { aud: g.aud, azp: g.aud, sub: `g-${g.email}`, email: g.email, email_verified: 'true' }) : send(400, { error: 'invalid_token' });
  }
  if (u.pathname === '/google/userinfo') {
    const g = G[(req.headers.authorization ?? '').replace('Bearer ', '')];
    return g ? send(200, { name: 'Cliente Google QA', email: g.email }) : send(401, {});
  }
  if (u.pathname === '/fb/oauth/access_token') {
    return u.searchParams.get('client_id') === APP_ID && u.searchParams.get('client_secret') === APP_SECRET
      ? send(200, { access_token: `${APP_ID}|app`, token_type: 'bearer' })
      : send(400, { error: { message: 'Error validating client secret.' } });
  }
  if (u.pathname === '/fb/debug_token') {
    if (u.searchParams.get('access_token') !== `${APP_ID}|${APP_SECRET}`) return send(400, { error: { message: 'bad app token' } });
    const f = F[u.searchParams.get('input_token') ?? ''];
    return send(200, { data: f ? { is_valid: true, app_id: f.app, user_id: `u-${tag}` } : { is_valid: false } });
  }
  if (u.pathname === '/fb/me') {
    const f = F[u.searchParams.get('access_token') ?? ''];
    return f ? send(200, { id: `u-${tag}`, name: 'Cliente Facebook QA', ...(f.email ? { email: f.email } : {}) }) : send(400, {});
  }
  send(404, {});
});
await new Promise((r) => srv.listen(3997, '127.0.0.1', r));

const pub = await db('nexus_public');
const argon2 = require('../apps/api/node_modules/argon2');
const saEmail = `qa-ls-${tag}@qa.test`, saPass = randomBytes(9).toString('base64url');
await pub.query(`INSERT INTO nexus_public.platform_users (id, email, "passwordHash", name, role, "isActive", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'QA Login Social', 'SUPER_ADMIN', true, now(), now())`, [saEmail, await argon2.hash(saPass, { type: argon2.argon2id })]);
const SA = tok(await ok('POST', '/auth/super-admin/login', { body: { email: saEmail, password: saPass } }));
const plan = (await ok('GET', '/public/landing')).plans?.[0]?.tier ?? 'STARTER';

// ── Facebook Login no Super Admin (Integrações) ───────────────────────────
await ok('PATCH', '/super-admin/integrations/FACEBOOK_LOGIN', { token: SA, body: { enabled: true, settings: { appId: APP_ID }, secret: 'errado' } });
let t = await ok('POST', '/super-admin/integrations/FACEBOOK_LOGIN/test', { token: SA });
R.check('LS-1', 'Testar com App Secret errado → recusado', !t.ok && /recusou/i.test(t.status), t.status);
await ok('PATCH', '/super-admin/integrations/FACEBOOK_LOGIN', { token: SA, body: { enabled: true, settings: { appId: APP_ID }, secret: APP_SECRET } });
t = await ok('POST', '/super-admin/integrations/FACEBOOK_LOGIN/test', { token: SA });
R.check('LS-2', 'Testar com App ID + App Secret certos → válidos', t.ok && /válidos/.test(t.status), t.status);
let land = await ok('GET', '/public/landing');
R.check('LS-3', 'a página pública recebe o App ID (e nunca o segredo)', land.facebookAppId === APP_ID && !JSON.stringify(land).includes(APP_SECRET), String(land.facebookAppId));

// ── Registo e login com Facebook ───────────────────────────────────────────
let r = await call('POST', '/onboarding/register-simple', { body: { facebookAccessToken: `fb-${tag}`, planTier: plan, businessType: 'RETAIL', nif: '5417281931', marketingOptIn: true } });
R.check('LS-4', 'registo com Facebook cria a empresa e entra', r.status === 201 || r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
const fbAccess = r.body?.tokens?.accessToken;
const st = fbAccess ? await ok('GET', '/onboarding/setup-status', { token: fbAccess }) : null;
R.check('LS-5', 'o NIF do registo chega ao "Ativar a sua empresa"', st?.nif === '5417281931', JSON.stringify(st));
r = await call('POST', '/auth/login/facebook', { body: { accessToken: `fb-${tag}` } });
R.check('LS-6', 'login com Facebook devolve sessão', (r.status === 200) && !!tok(r.body), `${r.status}`);
r = await call('POST', '/auth/login/facebook', { body: { accessToken: `fbx-${tag}` } });
R.check('LS-7', 'token do Facebook de OUTRA app → 401', r.status === 401 && /não autorizada/.test(r.body?.message ?? ''), `${r.status} ${r.body?.message}`);
r = await call('POST', '/auth/login/facebook', { body: { accessToken: `fbne-${tag}` } });
R.check('LS-8', 'conta Facebook sem e-mail → 401 com explicação', r.status === 401 && /e-mail/.test(r.body?.message ?? ''), `${r.status} ${r.body?.message}`);
r = await call('POST', '/auth/login/facebook', { body: { accessToken: 'lixo' } });
R.check('LS-9', 'token do Facebook inválido → 401', r.status === 401, `${r.status}`);

// ── Google com o botão próprio (access token) ──────────────────────────────
r = await call('POST', '/onboarding/register-simple', { body: { googleIdToken: `ya29.qa-${tag}`, planTier: plan, businessType: 'RESTAURANT' } });
R.check('LS-10', 'registo com Google (access token do botão próprio) cria a empresa', r.status === 201 || r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
r = await call('POST', '/auth/login/google', { body: { idToken: `ya29.qa-${tag}` } });
R.check('LS-11', 'login com Google (access token) devolve sessão', r.status === 200 && !!tok(r.body), `${r.status}`);
r = await call('POST', '/auth/login/google', { body: { idToken: `ya29.outra-${tag}` } });
R.check('LS-12', 'access token do Google de OUTRA app → 401', r.status === 401, `${r.status} ${r.body?.message}`);

// ── Validação do registo ───────────────────────────────────────────────────
r = await call('POST', '/onboarding/register-simple', { body: { email: `qa-nif-${tag}@qa.test`, password: 'QaTeste#2026x', planTier: plan, nif: '12' } });
R.check('LS-13', 'NIF inválido no registo → 400', r.status === 400, `${r.status}`);

// ── Aparência (Super Admin → Login & Registo) ──────────────────────────────
const big = Array.from({ length: 12 }, (_, i) => ({ text: `T${i}`, name: `N${i}`, photoUrl: i === 0 ? 'javascript:alert(1)' : 'https://img.test/a.jpg' }));
await ok('PATCH', '/super-admin/landing', { token: SA, body: { authConfig: { primary: '#123456', pageBg: 'red', google: { label: 'Continuar com Google', bg: '#ffffff', enabled: true, x: 1 }, testimonials: big, hack: '<script>' } } });
land = await ok('GET', '/public/landing');
const a = land.config.authConfig ?? {};
R.check('LS-14', 'só guarda campos e cores válidos (cor inválida e campos estranhos caem)', a.primary === '#123456' && a.pageBg === undefined && a.hack === undefined && a.google?.x === undefined && a.google?.label === 'Continuar com Google', JSON.stringify(a).slice(0, 160));
R.check('LS-15', 'testemunhos limitados a 8 e foto só https/imagem', a.testimonials?.length === 8 && a.testimonials[0].photoUrl === undefined && a.testimonials[1].photoUrl === 'https://img.test/a.jpg', `${a.testimonials?.length}`);
const anon = await call('PATCH', '/super-admin/landing', { body: { authConfig: {} } });
R.check('LS-16', 'alterar a aparência sem sessão de Super Admin → 401', anon.status === 401, `${anon.status}`);

// ── Estado de origem ───────────────────────────────────────────────────────
await ok('PATCH', '/super-admin/landing', { token: SA, body: { authConfig: {} } });
await ok('PATCH', '/super-admin/integrations/FACEBOOK_LOGIN', { token: SA, body: { enabled: false } });
land = await ok('GET', '/public/landing');
R.check('LS-17', 'Facebook desligado → a página pública deixa de receber o App ID', land.facebookAppId === null, String(land.facebookAppId));
await pub.query('DELETE FROM nexus_public.platform_users WHERE email = $1', [saEmail]).catch(() => undefined);
await pub.end(); srv.close();
fs.mkdirSync('qa/out', { recursive: true });
const s = R.summary();
fs.writeFileSync('qa/out/login-social.json', JSON.stringify(s, null, 1));
console.log(`\n${s.passed}/${s.total} passaram; ${s.failed} falharam`);
