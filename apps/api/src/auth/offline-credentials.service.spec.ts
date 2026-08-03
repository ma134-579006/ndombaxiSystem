import { OfflineCredentialsService, OFFLINE_ITERATIONS } from './offline-credentials.service';
import type { TenantUserRepository } from '../tenancy/tenant-user.repository';

/**
 * O que estes testes protegem: o servidor deriva o verificador com o `crypto` do
 * Node e a app verifica-o com o `crypto.subtle` do navegador. São duas
 * implementações diferentes — se os parâmetros divergirem nem que seja num
 * detalhe, o login offline passa a recusar a senha CERTA, e só se descobre no
 * aparelho de um cliente, sem rede para corrigir. Por isso o primeiro teste
 * deriva pelos DOIS caminhos e compara.
 */

/** Réplica exata do `deriveVerifier` das apps (WebCrypto). */
async function deriveLikeTheApp(secret: string, saltB64: string, iterations: number): Promise<string> {
  const salt = Buffer.from(saltB64, 'base64');
  const km = await globalThis.crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, km, 256,
  );
  return Buffer.from(new Uint8Array(bits)).toString('base64');
}

function fakeRepo() {
  return {
    setOfflinePassword: jest.fn().mockResolvedValue(undefined),
    setOfflinePin: jest.fn().mockResolvedValue(undefined),
    listOfflineCredentials: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<TenantUserRepository> & {
    setOfflinePassword: jest.Mock; setOfflinePin: jest.Mock; listOfflineCredentials: jest.Mock;
  };
}

describe('OfflineCredentialsService', () => {
  jest.setTimeout(30_000); // 150k iterações várias vezes

  it('deriva o MESMO verificador que a app deriva no navegador', async () => {
    const repo = fakeRepo();
    const svc = new OfflineCredentialsService(repo);

    const cred = await svc.derive('senha-do-gestor');
    const fromBrowser = await deriveLikeTheApp('senha-do-gestor', cred.salt, cred.iterations);

    expect(cred.iterations).toBe(OFFLINE_ITERATIONS);
    expect(cred.verifier).toBe(fromBrowser);
  });

  it('a senha errada não produz o mesmo verificador', async () => {
    const svc = new OfflineCredentialsService(fakeRepo());
    const cred = await svc.derive('senha-certa');
    const outra = await svc.derive('senha-errada', Buffer.from(cred.salt, 'base64'));
    expect(outra.verifier).not.toBe(cred.verifier);
  });

  it('cada credencial leva o seu próprio sal (dois iguais não se parecem)', async () => {
    const svc = new OfflineCredentialsService(fakeRepo());
    const a = await svc.derive('mesma-senha');
    const b = await svc.derive('mesma-senha');
    expect(a.salt).not.toBe(b.salt);
    expect(a.verifier).not.toBe(b.verifier);
  });

  it('grava o verificador da senha e o do PIN nos sítios certos', async () => {
    const repo = fakeRepo();
    const svc = new OfflineCredentialsService(repo);
    await svc.remember('tenant_x', 'u1', 'PASSWORD', 'abc12345');
    await svc.remember('tenant_x', 'u1', 'PIN', '123456');
    expect(repo.setOfflinePassword).toHaveBeenCalledTimes(1);
    expect(repo.setOfflinePin).toHaveBeenCalledTimes(1);
  });

  it('NÃO reescreve quando o segredo é o mesmo (senão todos os aparelhos voltavam a descarregar)', async () => {
    const repo = fakeRepo();
    const svc = new OfflineCredentialsService(repo);
    const atual = await svc.derive('abc12345');
    await svc.remember('tenant_x', 'u1', 'PASSWORD', 'abc12345', atual);
    expect(repo.setOfflinePassword).not.toHaveBeenCalled();
  });

  it('reescreve quando o segredo MUDOU', async () => {
    const repo = fakeRepo();
    const svc = new OfflineCredentialsService(repo);
    const atual = await svc.derive('senha-velha');
    await svc.remember('tenant_x', 'u1', 'PASSWORD', 'senha-nova', atual);
    expect(repo.setOfflinePassword).toHaveBeenCalledTimes(1);
  });

  it('uma falha da base NUNCA rebenta (é chamado de dentro do login)', async () => {
    const repo = fakeRepo();
    repo.setOfflinePassword.mockRejectedValue(new Error('coluna inexistente'));
    const svc = new OfflineCredentialsService(repo);
    await expect(svc.remember('tenant_x', 'u1', 'PASSWORD', 'abc12345')).resolves.toBeUndefined();
  });

  it('o pacote leva o que o aparelho precisa — e nada do que não deve sair', async () => {
    const repo = fakeRepo();
    const quando = new Date('2026-08-02T10:00:00.000Z');
    repo.listOfflineCredentials.mockResolvedValue([
      {
        id: 'u1', email: 'gestor@empresa.ao', name: 'Gestor', role: 'COMPANY_ADMIN',
        store_id: 's1', store_name: 'Loja 1', photo_url: null,
        offline_pw_salt: 'c2FsdA==', offline_pw_verifier: 'dmVy', offline_pw_iters: 150000,
        offline_pin_salt: null, offline_pin_verifier: null, offline_pin_iters: null,
        offline_updated_at: quando,
      },
    ]);
    const svc = new OfflineCredentialsService(repo);
    const bundle = await svc.bundle('tenant_x', 'emp-1', 'Empresa Um');

    expect(bundle.companyCode).toBe('emp-1');
    expect(bundle.revision).toBe(quando.toISOString());
    expect(bundle.users).toHaveLength(1);
    expect(bundle.users[0].password).toEqual({ salt: 'c2FsdA==', verifier: 'dmVy', iterations: 150000 });
    expect(bundle.users[0].pin).toBeNull();
    // O hash de autenticação e o segredo de 2FA não podem viajar, nunca.
    expect(JSON.stringify(bundle)).not.toContain('password_hash');
    expect(JSON.stringify(bundle)).not.toContain('two_fa');
  });
});
