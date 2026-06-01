import { round2 } from '@nexus/agt-xml';

/**
 * Testa a MATEMÁTICA do fecho de caixa (a regra quebra/sobra), isolada da BD.
 * Replica exactamente o cálculo do CashboxService.close:
 *   esperado = fundo + vendas_em_numerário + reforços − sangrias
 *   diferença = contado − esperado   (>0 sobra, <0 quebra, =0 OK)
 */
function closeMath(input: {
  openingFloat: number; cashSales: number; cashIn: number; cashOut: number; counted: number;
}) {
  const expected = round2(input.openingFloat + input.cashSales + input.cashIn - input.cashOut);
  const counted = round2(input.counted);
  const difference = round2(counted - expected);
  const verdict = difference === 0 ? 'OK' : difference < 0 ? 'QUEBRA' : 'SOBRA';
  return { expected, counted, difference, verdict };
}

describe('fecho de caixa — quebra/sobra', () => {
  it('bate certo → OK', () => {
    const r = closeMath({ openingFloat: 5000, cashSales: 30000, cashIn: 0, cashOut: 0, counted: 35000 });
    expect(r.expected).toBe(35000);
    expect(r.difference).toBe(0);
    expect(r.verdict).toBe('OK');
  });

  it('falta dinheiro → QUEBRA (diferença negativa)', () => {
    const r = closeMath({ openingFloat: 5000, cashSales: 30000, cashIn: 0, cashOut: 0, counted: 34500 });
    expect(r.expected).toBe(35000);
    expect(r.difference).toBe(-500);
    expect(r.verdict).toBe('QUEBRA');
  });

  it('dinheiro a mais → SOBRA (diferença positiva)', () => {
    const r = closeMath({ openingFloat: 5000, cashSales: 30000, cashIn: 0, cashOut: 0, counted: 35200 });
    expect(r.difference).toBe(200);
    expect(r.verdict).toBe('SOBRA');
  });

  it('reforço aumenta o esperado; sangria diminui', () => {
    const r = closeMath({ openingFloat: 5000, cashSales: 30000, cashIn: 10000, cashOut: 8000, counted: 37000 });
    // 5000 + 30000 + 10000 - 8000 = 37000
    expect(r.expected).toBe(37000);
    expect(r.verdict).toBe('OK');
  });

  it('vendas não-numerário NÃO entram no esperado físico', () => {
    // cashSales só inclui CASH; um cartão de 20000 não conta para o físico.
    const r = closeMath({ openingFloat: 5000, cashSales: 30000, cashIn: 0, cashOut: 0, counted: 35000 });
    expect(r.verdict).toBe('OK'); // o cartão é irrelevante para a gaveta
  });

  it('lida com cêntimos sem drift', () => {
    const r = closeMath({ openingFloat: 1000.10, cashSales: 2000.20, cashIn: 0, cashOut: 0, counted: 3000.30 });
    expect(r.expected).toBe(3000.30);
    expect(r.difference).toBe(0);
  });
});
