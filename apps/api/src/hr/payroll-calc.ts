/**
 * Motor de cálculo salarial — Angola (§ RH do documento técnico NEXUS ERP).
 *
 * Funções puras (sem dependências de BD/NestJS) para serem testáveis e
 * reutilizáveis. Cobrem as duas contribuições obrigatórias angolanas:
 *   • INSS — Segurança Social: 3% a cargo do trabalhador + 8% a cargo da
 *     entidade empregadora, ambos sobre a remuneração sujeita.
 *   • IRT — Imposto sobre o Rendimento do Trabalho (Grupo A), tabela
 *     progressiva por escalões com parcela fixa + taxa marginal sobre o
 *     excesso, aplicada à matéria colectável (remuneração sujeita − INSS 3%).
 */

/** Taxa de INSS a cargo do trabalhador (descontada do salário). */
export const INSS_EMPLOYEE_RATE = 0.03;
/** Taxa de INSS a cargo da entidade empregadora (custo da empresa). */
export const INSS_EMPLOYER_RATE = 0.08;

/** Arredondamento a 2 casas (meio-acima), consistente com o motor fiscal. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Escalão da tabela IRT (Grupo A) em vigor para Angola.
 * `upTo` = limite superior do escalão (Infinity no último); `fixed` = parcela
 * fixa do escalão; `rate` = taxa marginal aplicada ao excesso sobre `from`.
 */
export interface IrtBracket {
  from: number;
  upTo: number;
  fixed: number;
  rate: number;
}

export const IRT_BRACKETS: readonly IrtBracket[] = [
  { from: 0, upTo: 70_000, fixed: 0, rate: 0 },
  { from: 70_000, upTo: 100_000, fixed: 0, rate: 0.1 },
  { from: 100_000, upTo: 150_000, fixed: 3_000, rate: 0.13 },
  { from: 150_000, upTo: 200_000, fixed: 9_500, rate: 0.16 },
  { from: 200_000, upTo: 300_000, fixed: 17_500, rate: 0.18 },
  { from: 300_000, upTo: 500_000, fixed: 35_500, rate: 0.19 },
  { from: 500_000, upTo: 1_000_000, fixed: 73_500, rate: 0.2 },
  { from: 1_000_000, upTo: 1_500_000, fixed: 173_500, rate: 0.21 },
  { from: 1_500_000, upTo: 2_000_000, fixed: 278_500, rate: 0.22 },
  { from: 2_000_000, upTo: 2_500_000, fixed: 388_500, rate: 0.23 },
  { from: 2_500_000, upTo: 5_000_000, fixed: 503_500, rate: 0.24 },
  { from: 5_000_000, upTo: 10_000_000, fixed: 1_103_500, rate: 0.245 },
  { from: 10_000_000, upTo: Number.POSITIVE_INFINITY, fixed: 2_328_500, rate: 0.25 },
] as const;

/**
 * Calcula o INSS sobre a remuneração sujeita.
 * @returns parcelas do trabalhador (3%) e do empregador (8%), arredondadas.
 */
export function computeInss(inssBase: number): { employee: number; employer: number } {
  const base = Math.max(inssBase, 0);
  return {
    employee: round2(base * INSS_EMPLOYEE_RATE),
    employer: round2(base * INSS_EMPLOYER_RATE),
  };
}

/**
 * Calcula o IRT (Grupo A) sobre a matéria colectável usando a tabela
 * progressiva: parcela fixa do escalão + taxa marginal sobre o excesso.
 */
export function computeIrt(taxable: number): number {
  const base = Math.max(taxable, 0);
  for (const b of IRT_BRACKETS) {
    if (base <= b.upTo) {
      return round2(b.fixed + (base - b.from) * b.rate);
    }
  }
  // Inalcançável (último escalão é Infinity), mas mantém o tipo total.
  const last = IRT_BRACKETS[IRT_BRACKETS.length - 1];
  return round2(last.fixed + (base - last.from) * last.rate);
}

export interface PayrollInput {
  /** Salário base mensal. */
  baseSalary: number;
  /** Subsídios sujeitos a INSS e IRT (ex.: subsídio de função). */
  taxableAllowances?: number;
  /** Subsídios isentos (dentro dos limites legais, ex.: alimentação/transporte). */
  exemptAllowances?: number;
  /** Outros descontos (adiantamentos, faltas, sindicato, ...). */
  otherDeductions?: number;
}

export interface PayrollResult {
  baseSalary: number;
  taxableAllowances: number;
  exemptAllowances: number;
  /** Remuneração ilíquida total (base + todos os subsídios). */
  grossSalary: number;
  /** Base de incidência do INSS (base + subsídios sujeitos). */
  inssBase: number;
  inssEmployee: number;
  inssEmployer: number;
  /** Matéria colectável do IRT (base INSS − INSS 3%). */
  irtBase: number;
  irt: number;
  otherDeductions: number;
  /** Total descontado ao trabalhador (INSS 3% + IRT + outros). */
  totalDeductions: number;
  /** Salário líquido a receber. */
  netSalary: number;
  /** Custo total para a empresa (ilíquido + INSS 8%). */
  employerCost: number;
}

/**
 * Processa o salário de um trabalhador, devolvendo a folha discriminada.
 * A ordem segue a prática angolana: INSS sobre a remuneração sujeita, depois
 * IRT sobre (remuneração sujeita − INSS do trabalhador).
 */
export function computePayroll(input: PayrollInput): PayrollResult {
  const baseSalary = round2(Math.max(input.baseSalary, 0));
  const taxableAllowances = round2(Math.max(input.taxableAllowances ?? 0, 0));
  const exemptAllowances = round2(Math.max(input.exemptAllowances ?? 0, 0));
  const otherDeductions = round2(Math.max(input.otherDeductions ?? 0, 0));

  const grossSalary = round2(baseSalary + taxableAllowances + exemptAllowances);
  const inssBase = round2(baseSalary + taxableAllowances);
  const { employee: inssEmployee, employer: inssEmployer } = computeInss(inssBase);

  const irtBase = round2(inssBase - inssEmployee);
  const irt = computeIrt(irtBase);

  const totalDeductions = round2(inssEmployee + irt + otherDeductions);
  const netSalary = round2(grossSalary - totalDeductions);
  const employerCost = round2(grossSalary + inssEmployer);

  return {
    baseSalary,
    taxableAllowances,
    exemptAllowances,
    grossSalary,
    inssBase,
    inssEmployee,
    inssEmployer,
    irtBase,
    irt,
    otherDeductions,
    totalDeductions,
    netSalary,
    employerCost,
  };
}
