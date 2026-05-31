import { PasswordService } from './password.service';

describe('PasswordService (Argon2id)', () => {
  const service = new PasswordService();

  it('hashes and verifies the correct password', async () => {
    const hash = await service.hash('S3nha!Forte');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await service.verify(hash, 'S3nha!Forte')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await service.hash('S3nha!Forte');
    expect(await service.verify(hash, 'errada')).toBe(false);
  });

  it('produces a unique salt per hash', async () => {
    const a = await service.hash('mesma');
    const b = await service.hash('mesma');
    expect(a).not.toEqual(b);
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    expect(await service.verify('not-a-hash', 'x')).toBe(false);
  });
});
