import {
  defaultLabel,
  isPaymentMethodType,
  isValidAngolanIban,
  normalizeIban,
  validatePaymentMethod,
} from './payment-methods';

describe('IBAN angolano', () => {
  it('aceita AO + 23 dígitos (25 caracteres)', () => {
    expect(isValidAngolanIban('AO06000600000100037131174')).toBe(true);
  });

  it('normaliza espaços e minúsculas', () => {
    expect(normalizeIban('ao06 0006 0000 0100 0371 3117 4')).toBe('AO06000600000100037131174');
  });

  it('rejeita IBAN com tamanho/letras erradas', () => {
    expect(isValidAngolanIban('PT50000201231234567890154')).toBe(false);
    expect(isValidAngolanIban('AO0600')).toBe(false);
  });
});

describe('isPaymentMethodType', () => {
  it('valida os tipos suportados', () => {
    expect(isPaymentMethodType('BANK_TRANSFER')).toBe(true);
    expect(isPaymentMethodType('MULTICAIXA_EXPRESS')).toBe(true);
    expect(isPaymentMethodType('CRYPTO')).toBe(false);
  });
});

describe('validatePaymentMethod', () => {
  it('transferência: exige IBAN válido + titular', () => {
    const m = validatePaymentMethod({
      type: 'BANK_TRANSFER',
      iban: 'AO06 0006 0000 0100 0371 3117 4',
      accountHolder: 'Loja Kwanza, Lda',
    });
    expect(m.iban).toBe('AO06000600000100037131174');
    expect(m.label).toBe('Transferência Bancária');
  });

  it('transferência: falha sem IBAN', () => {
    expect(() => validatePaymentMethod({ type: 'BANK_TRANSFER', accountHolder: 'X' })).toThrow(/IBAN/);
  });

  it('transferência: falha com IBAN inválido', () => {
    expect(() =>
      validatePaymentMethod({ type: 'BANK_TRANSFER', iban: 'AO123', accountHolder: 'X' }),
    ).toThrow(/inválido/);
  });

  it('referência: exige entidade e referência', () => {
    expect(() => validatePaymentMethod({ type: 'REFERENCE', referenceEntity: '00123' })).toThrow(/Referência/);
    const m = validatePaymentMethod({
      type: 'REFERENCE',
      referenceEntity: '00123',
      referenceNumber: '987654321',
    });
    expect(m.label).toBe('Pagamento por Referência');
  });

  it('express: exige telemóvel', () => {
    expect(() => validatePaymentMethod({ type: 'MULTICAIXA_EXPRESS' })).toThrow(/telemóvel/);
    const m = validatePaymentMethod({ type: 'MULTICAIXA_EXPRESS', expressPhone: '923000000' });
    expect(m.label).toBe('Multicaixa Express');
  });

  it('numerário: não exige campos extra e usa rótulo por omissão', () => {
    const m = validatePaymentMethod({ type: 'CASH' });
    expect(m.label).toBe('Numerário');
  });

  it('rótulo personalizado prevalece', () => {
    const m = validatePaymentMethod({ type: 'CASH', label: 'Pagar na loja' });
    expect(m.label).toBe('Pagar na loja');
  });

  it('defaultLabel cobre todos os tipos', () => {
    expect(defaultLabel('BANK_TRANSFER')).toBeTruthy();
    expect(defaultLabel('REFERENCE')).toBeTruthy();
    expect(defaultLabel('MULTICAIXA_EXPRESS')).toBeTruthy();
    expect(defaultLabel('CASH')).toBeTruthy();
  });
});
