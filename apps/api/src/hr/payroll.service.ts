import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computePayroll } from './payroll-calc';

export interface PayrollRunRow {
  id: string;
  period_year: number;
  period_month: number;
  status: string;
  employee_count: number;
  gross_total: string;
  inss_employee_total: string;
  inss_employer_total: string;
  irt_total: string;
  net_total: string;
  employer_cost_total: string;
  processed_at: Date;
  paid_at: Date | null;
}

export interface PayrollItemRow {
  id: string;
  employee_number: string;
  employee_name: string;
  base_salary: string;
  taxable_allowances: string;
  exempt_allowances: string;
  gross_salary: string;
  inss_base: string;
  inss_employee: string;
  inss_employer: string;
  irt_base: string;
  irt: string;
  other_deductions: string;
  total_deductions: string;
  net_salary: string;
  employer_cost: string;
}

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Processa a folha salarial de um período (ano/mês) de forma atómica:
   * carrega todos os trabalhadores ACTIVE, calcula INSS+IRT por trabalhador,
   * persiste o cabeçalho da folha + linhas e os totais agregados. Falha se já
   * existir folha PROCESSED/PAID para o mesmo período (unicidade ano+mês).
   */
  async process(schema: string, year: number, month: number): Promise<PayrollRunRow> {
    if (month < 1 || month > 12) throw new BadRequestException('Mês inválido (1–12).');

    return this.prisma.runInTenant(schema, async (tx) => {
      const existing = await tx.$queryRaw<{ id: string; status: string }[]>(
        Prisma.sql`SELECT id, status FROM payroll_runs
                   WHERE period_year = ${year} AND period_month = ${month} LIMIT 1`,
      );
      if (existing[0]) {
        throw new ConflictException(
          `Já existe folha salarial para ${year}-${String(month).padStart(2, '0')} (${existing[0].status}).`,
        );
      }

      const employees = await tx.$queryRaw<
        {
          id: string;
          employee_number: string;
          full_name: string;
          base_salary: string;
          taxable_allowances: string;
          exempt_allowances: string;
        }[]
      >(
        Prisma.sql`SELECT id, employee_number, full_name, base_salary,
                          taxable_allowances, exempt_allowances
                   FROM employees WHERE status = 'ACTIVE' ORDER BY full_name`,
      );
      if (employees.length === 0) {
        throw new BadRequestException('Sem trabalhadores activos para processar.');
      }

      const runRows = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`INSERT INTO payroll_runs (period_year, period_month, status)
                   VALUES (${year}, ${month}, 'PROCESSED') RETURNING id`,
      );
      const runId = runRows[0].id;

      let grossTotal = 0;
      let inssEmpTotal = 0;
      let inssEmployerTotal = 0;
      let irtTotal = 0;
      let netTotal = 0;
      let employerCostTotal = 0;

      for (const e of employees) {
        const calc = computePayroll({
          baseSalary: Number(e.base_salary),
          taxableAllowances: Number(e.taxable_allowances),
          exemptAllowances: Number(e.exempt_allowances),
        });

        await tx.$executeRaw(
          Prisma.sql`INSERT INTO payroll_items
              (run_id, employee_id, employee_number, employee_name, base_salary,
               taxable_allowances, exempt_allowances, gross_salary, inss_base,
               inss_employee, inss_employer, irt_base, irt, other_deductions,
               total_deductions, net_salary, employer_cost)
            VALUES (${runId}::uuid, ${e.id}::uuid, ${e.employee_number}, ${e.full_name},
                    ${calc.baseSalary}, ${calc.taxableAllowances}, ${calc.exemptAllowances},
                    ${calc.grossSalary}, ${calc.inssBase}, ${calc.inssEmployee},
                    ${calc.inssEmployer}, ${calc.irtBase}, ${calc.irt}, ${calc.otherDeductions},
                    ${calc.totalDeductions}, ${calc.netSalary}, ${calc.employerCost})`,
        );

        grossTotal += calc.grossSalary;
        inssEmpTotal += calc.inssEmployee;
        inssEmployerTotal += calc.inssEmployer;
        irtTotal += calc.irt;
        netTotal += calc.netSalary;
        employerCostTotal += calc.employerCost;
      }

      const r2 = (v: number) => Math.round(v * 100) / 100;
      const updated = await tx.$queryRaw<PayrollRunRow[]>(
        Prisma.sql`UPDATE payroll_runs
                   SET employee_count = ${employees.length},
                       gross_total = ${r2(grossTotal)},
                       inss_employee_total = ${r2(inssEmpTotal)},
                       inss_employer_total = ${r2(inssEmployerTotal)},
                       irt_total = ${r2(irtTotal)},
                       net_total = ${r2(netTotal)},
                       employer_cost_total = ${r2(employerCostTotal)}
                   WHERE id = ${runId}::uuid RETURNING *`,
      );
      return updated[0];
    });
  }

  listRuns(schema: string): Promise<PayrollRunRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<PayrollRunRow[]>(
        Prisma.sql`SELECT * FROM payroll_runs
                   ORDER BY period_year DESC, period_month DESC`,
      ),
    );
  }

  async getRun(
    schema: string,
    id: string,
  ): Promise<{ run: PayrollRunRow; items: PayrollItemRow[] }> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const runs = await tx.$queryRaw<PayrollRunRow[]>(
        Prisma.sql`SELECT * FROM payroll_runs WHERE id = ${id}::uuid LIMIT 1`,
      );
      if (!runs[0]) throw new NotFoundException(`Folha salarial não encontrada: ${id}`);
      const items = await tx.$queryRaw<PayrollItemRow[]>(
        Prisma.sql`SELECT * FROM payroll_items WHERE run_id = ${id}::uuid
                   ORDER BY employee_name`,
      );
      return { run: runs[0], items };
    });
  }

  /** Marca a folha como paga (idempotente quanto a duplo pagamento). */
  async markPaid(schema: string, id: string): Promise<PayrollRunRow> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<PayrollRunRow[]>(
        Prisma.sql`UPDATE payroll_runs
                   SET status = 'PAID', paid_at = now()
                   WHERE id = ${id}::uuid AND status = 'PROCESSED' RETURNING *`,
      ),
    );
    if (!rows[0]) {
      throw new ConflictException('Folha inexistente ou já paga/cancelada.');
    }
    return rows[0];
  }
}
