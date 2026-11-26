import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncAuth, jwtExpMs, type SyncIdentity, type TokenPairLike } from '../syncAuth';

const jwt = (expSec: number) => `h.${Buffer.from(JSON.stringify({ exp: expSec })).toString('base64url')}.s`;
const NOW = 1_800_000_000_000;

function setup(initial: SyncIdentity | null, refresh: (rt: string) => Promise<TokenPairLike>) {
  let stored = initial;
  const rotated: [string, TokenPairLike][] = [];
  const calls: string[] = [];
  const auth = createSyncAuth({
    load: async () => stored,
    save: async (v) => { stored = v; },
    refresh: async (rt) => { calls.push(rt); return refresh(rt); },
    onRotated: (o, p) => rotated.push([o, p]),
    now: () => NOW,
  });
  return { auth, get stored() { return stored; }, rotated, calls };
}
const id = (exp: number, rt = 'R1'): SyncIdentity => ({ companyCode: 'LDM', accessToken: jwt(exp), refreshToken: rt, savedAt: '' });

test('jwtExpMs lê o exp', () => {
  assert.equal(jwtExpMs(jwt(100)), 100_000);
  assert.equal(jwtExpMs('lixo'), null);
});

test('sem identidade: credential é null e renew devolve none', async () => {
  const s = setup(null, async () => ({ accessToken: 'x', refreshToken: 'y' }));
  assert.equal(await s.auth.credential(), null);
  assert.equal(await s.auth.renew(), 'none');
});

test('token válido é usado sem renovar', async () => {
  const s = setup(id(NOW / 1000 + 600), async () => { throw new Error('não devia'); });
  const c = await s.auth.credential();
  assert.equal(c?.companyCode, 'LDM');
  assert.equal(s.calls.length, 0);
});

test('token expirado renova, guarda o par novo e avisa o cofre', async () => {
  const novo = { accessToken: jwt(NOW / 1000 + 900), refreshToken: 'R2' };
  const s = setup(id(NOW / 1000 - 10), async () => novo);
  const c = await s.auth.credential();
  assert.equal(c?.accessToken, novo.accessToken);
  assert.equal(s.stored?.refreshToken, 'R2');
  assert.deepEqual(s.rotated, [['R1', novo]]);
});

test('renovações em paralelo usam UM só refresh (sem revogar o próprio token)', async () => {
  const s = setup(id(NOW / 1000 - 10), async () => ({ accessToken: jwt(NOW / 1000 + 900), refreshToken: 'R2' }));
  const r = await Promise.all([s.auth.renew(), s.auth.renew(), s.auth.credential()]);
  assert.equal(s.calls.length, 1);
  assert.equal(r[0], 'ok');
});

test('401 do servidor apaga a identidade; sem rede mantém-na', async () => {
  const off = setup(id(NOW / 1000 - 10), async () => { throw Object.assign(new Error('x'), { status: 0 }); });
  assert.equal(await off.auth.renew(), 'offline');
  assert.equal(off.stored?.refreshToken, 'R1');
  const rej = setup(id(NOW / 1000 - 10), async () => { throw Object.assign(new Error('x'), { status: 401 }); });
  assert.equal(await rej.auth.renew(), 'rejected');
  assert.equal(rej.stored, null);
  assert.equal(await rej.auth.credential(), null);
});

test('remember substitui a identidade (login novo)', async () => {
  const s = setup(id(1), async () => ({ accessToken: 'a', refreshToken: 'b' }));
  await s.auth.remember('OUTRA', { accessToken: jwt(NOW / 1000 + 900), refreshToken: 'R9' });
  assert.equal(s.stored?.companyCode, 'OUTRA');
  await s.auth.remember(null, { accessToken: 'z', refreshToken: 'z' });
  assert.equal(s.stored?.refreshToken, 'R9');
});

test('waitSettled resolve quando a sessão viva decide', async () => {
  const s = setup(null, async () => ({ accessToken: 'a', refreshToken: 'b' }));
  let done = false;
  const p = s.auth.waitSettled(5_000).then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(done, false);
  s.auth.setLive('guest');
  await p;
  assert.equal(done, true);
});
