import { decryptSecret, encryptSecret, isEncrypted, maskSecret } from './secret-box';

const KEY = 'unit-test-encryption-key-1234567890-abc';

describe('secret-box (AES-256-GCM)', () => {
  it('encripta e desencripta de volta ao original', () => {
    const plain = 'sk-openmanus-super-secret-key-001';
    const enc = encryptSecret(plain, KEY);
    expect(enc).not.toContain(plain);
    expect(isEncrypted(enc)).toBe(true);
    expect(decryptSecret(enc, KEY)).toBe(plain);
  });

  it('produz cifras diferentes para o mesmo texto (IV aleatório)', () => {
    const a = encryptSecret('mesmo-valor', KEY);
    const b = encryptSecret('mesmo-valor', KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe('mesmo-valor');
    expect(decryptSecret(b, KEY)).toBe('mesmo-valor');
  });

  it('falha a desencriptar com chave errada (autenticação GCM)', () => {
    const enc = encryptSecret('valor', KEY);
    expect(() => decryptSecret(enc, 'chave-errada-completamente-diferente!!')).toThrow();
  });

  it('rejeita payloads sem prefixo de versão', () => {
    expect(isEncrypted('texto-em-claro')).toBe(false);
    expect(() => decryptSecret('texto-em-claro', KEY)).toThrow();
  });

  it('mascara mantendo apenas os últimos 4 caracteres', () => {
    expect(maskSecret('sk-abcd1234')).toBe('••••••••1234');
    expect(maskSecret('')).toBe('');
  });
});
