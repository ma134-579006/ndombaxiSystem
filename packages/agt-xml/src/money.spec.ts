import { complement, money, mulRound2, round2, sum2 } from './money';

describe('round2 — half-up robusto em qualquer magnitude', () => {
  it('arredonda meio-acima em valores pequenos (caso clássico do float)', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(0.005)).toBe(0.01);
    expect(round2(0.015)).toBe(0.02);
    expect(round2(0.125)).toBe(0.13);
  });

  it('arredonda para baixo abaixo de meio', () => {
    expect(round2(0.004)).toBe(0);
    expect(round2(1.004)).toBe(1);
    expect(round2(123.454)).toBe(123.45);
  });

  /**
   * REGRESSÃO CRÍTICA: a implementação antiga (value + Number.EPSILON) falhava
   * em valores grandes porque o EPSILON é absorvido pela magnitude. Estes casos
   * — típicos de uma empresa de vendas grande (milhões de AOA) — DEVEM subir.
   */
  it('mantém half-up correcto em valores grandes (faturas de milhões)', () => {
    expect(round2(40000.005)).toBe(40000.01);
    expect(round2(100000.005)).toBe(100000.01);
    expect(round2(9999999.995)).toBe(10000000);
    expect(round2(999999999.995)).toBe(1000000000);
  });

  it('trata negativos simetricamente e nunca devolve -0', () => {
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(-0.005)).toBe(-0.01);
    expect(Object.is(round2(-0.004), 0)).toBe(true); // colapsa -0 → 0
    expect(Object.is(round2(-0), 0)).toBe(true);
  });

  it('rejeita valores não finitos', () => {
    expect(() => round2(NaN)).toThrow();
    expect(() => round2(Infinity)).toThrow();
  });
});

describe('money — string SAF-T com 2 casas e ponto', () => {
  it('formata sempre com 2 decimais', () => {
    expect(money(1000)).toBe('1000.00');
    expect(money(14.225)).toBe('14.23');
    expect(money(9999999.995)).toBe('10000000.00');
  });
});

describe('sum2 — soma e arredonda uma única vez', () => {
  it('soma valores já arredondados sem drift', () => {
    expect(sum2([0.1, 0.2])).toBe(0.3);
    expect(sum2([140, 140, 50])).toBe(330);
  });
  it('soma vazia é 0', () => {
    expect(sum2([])).toBe(0);
  });
});

describe('mulRound2 — produto decimal exato (regressão da auditoria 2026-11-12)', () => {
  it('12 × 11828.65 × 0.875 = 124200.825 → 124200.83 (o float dava .82)', () => {
    expect(round2(12 * 11828.65 * (1 - 0.125))).toBe(124200.82); // o defeito
    expect(mulRound2(12, 11828.65, complement(0.125))).toBe(124200.83);
  });
  it('meios exatos sobem sempre', () => {
    expect(mulRound2(3, 0.335)).toBe(1.01);
    expect(mulRound2(1.005, 1)).toBe(1.01);
    expect(mulRound2(2.5, 0.41, 0.5)).toBe(0.51); // 0.5125
    expect(mulRound2(124200.83, 14, 0.01)).toBe(17388.12); // IVA de 17388.1162
  });
  it('valores mínimos, zero, negativos e grandes', () => {
    expect(mulRound2(0.001, 0.01)).toBe(0);
    expect(mulRound2(1, 0.01)).toBe(0.01);
    expect(mulRound2(0, 99999999.99)).toBe(0);
    expect(mulRound2(-3, 0.335)).toBe(-1.01);
    expect(mulRound2(999, 1234567.89)).toBe(1233333322.11);
  });
  it('complement é exato', () => {
    expect(complement(0.125)).toBe(0.875);
    expect(complement(0.3333)).toBe(0.6667);
    expect(complement(0)).toBe(1);
    expect(complement(0.9999)).toBe(0.0001);
  });
});
