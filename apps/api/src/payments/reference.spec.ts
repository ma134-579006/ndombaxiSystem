import { formatReference, generateReference, isValidEntity } from './reference';

describe('isValidEntity', () => {
  it('aceita 5 dígitos', () => {
    expect(isValidEntity('00123')).toBe(true);
    expect(isValidEntity('99999')).toBe(true);
  });
  it('rejeita formatos errados', () => {
    expect(isValidEntity('1234')).toBe(false);
    expect(isValidEntity('123456')).toBe(false);
    expect(isValidEntity('12a45')).toBe(false);
  });
});

describe('generateReference', () => {
  const contract = { entity: '01234', environment: 'TEST' as const, defaultValidityDays: 3 };

  it('gera referência de 9 dígitos com valor e validade', () => {
    const r = generateReference(contract, { seq: 1, amount: 45000 });
    expect(r.entity).toBe('01234');
    expect(r.reference).toMatch(/^\d{9}$/);
    expect(r.amount).toBe(45000);
    expect(r.environment).toBe('TEST');
    expect(new Date(r.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('é determinística para o mesmo seq', () => {
    const a = generateReference(contract, { seq: 42, amount: 1000 });
    const b = generateReference(contract, { seq: 42, amount: 1000 });
    expect(a.reference).toBe(b.reference);
  });

  it('gera referências distintas para seq distintos', () => {
    const a = generateReference(contract, { seq: 1, amount: 1000 });
    const b = generateReference(contract, { seq: 2, amount: 1000 });
    expect(a.reference).not.toBe(b.reference);
  });

  it('arredonda o valor ao Kwanza', () => {
    const r = generateReference(contract, { seq: 7, amount: 1499.6 });
    expect(r.amount).toBe(1500);
  });

  it('rejeita entidade inválida e valor não positivo', () => {
    expect(() => generateReference({ entity: '12' }, { seq: 1, amount: 100 })).toThrow(/[Ee]ntidade/);
    expect(() => generateReference(contract, { seq: 1, amount: 0 })).toThrow(/[Vv]alor/);
  });
});

describe('formatReference', () => {
  it('agrupa em três', () => {
    expect(formatReference('123456789')).toBe('123 456 789');
  });
});
