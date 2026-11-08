import { couponDiscount, normCode, publicName } from './marketing.service';

describe('marketing (cupões e avaliações)', () => {
  it('desconto em % sobre o total', () => {
    expect(couponDiscount({ type: 'PERCENT', value: '10' }, 5000)).toBe(500);
  });
  it('desconto em Kz nunca passa do total', () => {
    expect(couponDiscount({ type: 'AMOUNT', value: '8000' }, 5000)).toBe(5000);
    expect(couponDiscount({ type: 'AMOUNT', value: '750' }, 5000)).toBe(750);
  });
  it('percentagem limitada a 100', () => {
    expect(couponDiscount({ type: 'PERCENT', value: '150' }, 1000)).toBe(1000);
  });
  it('código normalizado em maiúsculas sem espaços', () => {
    expect(normCode(' bem vindo10 ')).toBe('BEMVINDO10');
  });
  it('nome público: primeiro nome + inicial do apelido', () => {
    expect(publicName('Ana Maria Santos')).toBe('Ana S.');
    expect(publicName('Pedro')).toBe('Pedro');
    expect(publicName('')).toBe('Cliente');
  });
});
