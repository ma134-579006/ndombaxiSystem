import {
  computeInss,
  computeIrt,
  computePayroll,
  INSS_EMPLOYEE_RATE,
  INSS_EMPLOYER_RATE,
} from './payroll-calc';

describe('computeInss', () => {
  it('aplica 3% (trabalhador) e 8% (empregador)', () => {
    expect(computeInss(100_000)).toEqual({ employee: 3_000, employer: 8_000 });
  });

  it('expõe as taxas legais angolanas', () => {
    expect(INSS_EMPLOYEE_RATE).toBe(0.03);
    expect(INSS_EMPLOYER_RATE).toBe(0.08);
  });

  it('nunca produz valores negativos', () => {
    expect(computeInss(-50)).toEqual({ employee: 0, employer: 0 });
  });
});

describe('computeIrt (tabela progressiva Grupo A)', () => {
  it('isenta até 70.000', () => {
    expect(computeIrt(70_000)).toBe(0);
    expect(computeIrt(0)).toBe(0);
  });

  it('aplica 10% sobre o excesso no 2.º escalão', () => {
    // 97.000 → (97.000 − 70.000) * 10% = 2.700
    expect(computeIrt(97_000)).toBe(2_700);
  });

  it('usa parcela fixa + taxa marginal no escalão 150k–200k', () => {
    // 194.000 → 9.500 + (194.000 − 150.000) * 16% = 16.540
    expect(computeIrt(194_000)).toBe(16_540);
  });

  it('respeita o limite de cada escalão', () => {
    // 100.000 → (100.000 − 70.000) * 10% = 3.000 (= parcela fixa do escalão seguinte)
    expect(computeIrt(100_000)).toBe(3_000);
  });

  it('aplica o último escalão (>10M) a 25%', () => {
    // 11.640.000 → 2.328.500 + (11.640.000 − 10.000.000) * 25% = 2.738.500
    expect(computeIrt(11_640_000)).toBe(2_738_500);
  });
});

describe('computePayroll', () => {
  it('processa salário no limite de isenção do IRT', () => {
    const r = computePayroll({ baseSalary: 70_000 });
    expect(r.grossSalary).toBe(70_000);
    expect(r.inssEmployee).toBe(2_100);
    expect(r.inssEmployer).toBe(5_600);
    expect(r.irtBase).toBe(67_900);
    expect(r.irt).toBe(0);
    expect(r.totalDeductions).toBe(2_100);
    expect(r.netSalary).toBe(67_900);
    expect(r.employerCost).toBe(75_600);
  });

  it('processa salário com IRT no escalão dos 200k', () => {
    const r = computePayroll({ baseSalary: 200_000 });
    expect(r.inssEmployee).toBe(6_000);
    expect(r.irtBase).toBe(194_000);
    expect(r.irt).toBe(16_540);
    expect(r.totalDeductions).toBe(22_540);
    expect(r.netSalary).toBe(177_460);
    expect(r.employerCost).toBe(216_000);
  });

  it('subsídios isentos contam para o ilíquido mas não para INSS/IRT', () => {
    const r = computePayroll({ baseSalary: 100_000, exemptAllowances: 30_000 });
    expect(r.grossSalary).toBe(130_000);
    expect(r.inssBase).toBe(100_000);
    expect(r.inssEmployee).toBe(3_000);
    expect(r.irtBase).toBe(97_000);
    expect(r.irt).toBe(2_700);
    expect(r.netSalary).toBe(124_300);
    expect(r.employerCost).toBe(138_000);
  });

  it('subsídios sujeitos entram na base de INSS e IRT', () => {
    const r = computePayroll({ baseSalary: 150_000, taxableAllowances: 50_000 });
    expect(r.inssBase).toBe(200_000);
    expect(r.inssEmployee).toBe(6_000);
    expect(r.irtBase).toBe(194_000);
    expect(r.irt).toBe(16_540);
  });

  it('subtrai outros descontos ao líquido', () => {
    const r = computePayroll({ baseSalary: 70_000, otherDeductions: 5_000 });
    expect(r.otherDeductions).toBe(5_000);
    expect(r.totalDeductions).toBe(7_100); // 2.100 INSS + 0 IRT + 5.000
    expect(r.netSalary).toBe(62_900);
  });
});
