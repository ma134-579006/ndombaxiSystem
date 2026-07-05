import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { round2 } from '@nexus/agt-xml';
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
  async process(
    schema: string,
    year: number,
    month: number,
    adjustments: { employeeId: string; bonus?: number; absenceDays?: number }[] = [],
  ): Promise<PayrollRunRow> {
    if (month < 1 || month > 12) throw new BadRequestException('Mês inválido (1–12).');
    const adjByEmp = new Map(adjustments.map((a) => [a.employeeId, a]));

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
          bonus: string;
          absence_discount_pct: string;
        }[]
      >(
        Prisma.sql`SELECT id, employee_number, full_name, base_salary,
                          taxable_allowances, exempt_allowances, bonus, absence_discount_pct
                   FROM employees WHERE status = 'ACTIVE' ORDER BY full_name`,
      );
      if (employees.length === 0) {
        throw new BadRequestException('Sem trabalhadores activos para processar.');
      }

      // Consumo próprio por descontar (status PENDING) por funcionário → entra
      // nesta folha como "outros descontos" (motivo: consumo próprio). Guardado
      // contra tenants antigos sem a tabela.
      const consumptionByEmp = new Map<string, number>();
      const hasConsumptions = await tx.$queryRaw<{ reg: string | null }[]>(
        Prisma.sql`SELECT to_regclass('employee_consumptions')::text AS reg`,
      );
      if (hasConsumptions[0]?.reg) {
        const cons = await tx.$queryRaw<{ employee_id: string; total: string }[]>(
          Prisma.sql`SELECT employee_id, COALESCE(SUM(total), 0)::text AS total
                     FROM employee_consumptions
                     WHERE status = 'PENDING' AND employee_id IS NOT NULL
                     GROUP BY employee_id`,
        );
        for (const c of cons) consumptionByEmp.set(c.employee_id, Number(c.total) || 0);
      }

      // Adiantamentos salariais APROVADOS por descontar → entram nesta folha
      // (motivo: adiantamento). Descontados no mês do pagamento (este run).
      const advanceByEmp = new Map<string, number>();
      const hasAdvances = await tx.$queryRaw<{ reg: string | null }[]>(
        Prisma.sql`SELECT to_regclass('salary_advances')::text AS reg`,
      );
      if (hasAdvances[0]?.reg) {
        const advs = await tx.$queryRaw<{ employee_id: string; total: string }[]>(
          Prisma.sql`SELECT employee_id, COALESCE(SUM(amount), 0)::text AS total
                     FROM salary_advances
                     WHERE status = 'APPROVED' AND employee_id IS NOT NULL
                     GROUP BY employee_id`,
        );
        for (const a of advs) advanceByEmp.set(a.employee_id, Number(a.total) || 0);
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
        const base = Number(e.base_salary);
        // Bónus e faltas vêm do PAGAMENTO (ajustes desta folha); na falta deles,
        // cai no valor antigo guardado na ficha (retrocompatível).
        const adj = adjByEmp.get(e.id);
        const bonus = adj?.bonus != null ? adj.bonus : (Number(e.bonus) || 0);
        const pct = adj?.absenceDays != null
          ? Math.max(0, Math.min(100, Math.round((adj.absenceDays / 30) * 100 * 100) / 100))
          : Math.max(0, Math.min(100, Number(e.absence_discount_pct) || 0));
        // Outros descontos = desconto por faltas + consumo próprio do funcionário.
        const absenceDeduction = Math.round((base * pct / 100) * 100) / 100;
        const consumption = consumptionByEmp.get(e.id) ?? 0;
        const advance = advanceByEmp.get(e.id) ?? 0;
        const calc = computePayroll({
          baseSalary: base,
          // Bónus entra como subsídio sujeito (INSS/IRT).
          taxableAllowances: Number(e.taxable_allowances) + bonus,
          exemptAllowances: Number(e.exempt_allowances),
          // Desconto por faltas + consumo próprio + adiantamento salarial.
          otherDeductions: Math.round((absenceDeduction + consumption + advance) * 100) / 100,
        });

        const itemRows = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`INSERT INTO payroll_items
              (run_id, employee_id, employee_number, employee_name, base_salary,
               taxable_allowances, exempt_allowances, gross_salary, inss_base,
               inss_employee, inss_employer, irt_base, irt, other_deductions,
               self_consumption, advance_deduction, absence_deduction,
               total_deductions, net_salary, employer_cost)
            VALUES (${runId}::uuid, ${e.id}::uuid, ${e.employee_number}, ${e.full_name},
                    ${calc.baseSalary}, ${calc.taxableAllowances}, ${calc.exemptAllowances},
                    ${calc.grossSalary}, ${calc.inssBase}, ${calc.inssEmployee},
                    ${calc.inssEmployer}, ${calc.irtBase}, ${calc.irt}, ${calc.otherDeductions},
                    ${round2(consumption)}, ${round2(advance)}, ${round2(absenceDeduction)},
                    ${calc.totalDeductions}, ${calc.netSalary}, ${calc.employerCost})
            RETURNING id`,
        );
        // Marca os consumos próprios como descontados nesta linha da folha.
        if (consumption > 0 && hasConsumptions[0]?.reg) {
          await tx.$executeRaw(
            Prisma.sql`UPDATE employee_consumptions
                       SET status = 'DEDUCTED', payroll_item_id = ${itemRows[0].id}::uuid
                       WHERE employee_id = ${e.id}::uuid AND status = 'PENDING'`,
          );
        }
        // Marca os adiantamentos APROVADOS como descontados no mês exato do pagamento.
        if (advance > 0 && hasAdvances[0]?.reg) {
          await tx.$executeRaw(
            Prisma.sql`UPDATE salary_advances
                       SET status = 'DEDUCTED', payroll_item_id = ${itemRows[0].id}::uuid,
                           period_year = ${year}, period_month = ${month}
                       WHERE employee_id = ${e.id}::uuid AND status = 'APPROVED'`,
          );
        }

        grossTotal += calc.grossSalary;
        inssEmpTotal += calc.inssEmployee;
        inssEmployerTotal += calc.inssEmployer;
        irtTotal += calc.irt;
        netTotal += calc.netSalary;
        employerCostTotal += calc.employerCost;
      }

      const updated = await tx.$queryRaw<PayrollRunRow[]>(
        Prisma.sql`UPDATE payroll_runs
                   SET employee_count = ${employees.length},
                       gross_total = ${round2(grossTotal)},
                       inss_employee_total = ${round2(inssEmpTotal)},
                       inss_employer_total = ${round2(inssEmployerTotal)},
                       irt_total = ${round2(irtTotal)},
                       net_total = ${round2(netTotal)},
                       employer_cost_total = ${round2(employerCostTotal)}
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

  /**
   * Marca a folha como paga (idempotente quanto a duplo pagamento) e regista
   * automaticamente o GASTO correspondente (categoria SALARIOS) — assim a folha
   * salarial fica sincronizada com as Despesas e entra no lucro líquido.
   */
  async markPaid(
    schema: string,
    id: string,
    actor?: { id: string | null; name: string | null },
  ): Promise<PayrollRunRow> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<PayrollRunRow[]>(
        Prisma.sql`UPDATE payroll_runs
                   SET status = 'PAID', paid_at = now()
                   WHERE id = ${id}::uuid AND status = 'PROCESSED' RETURNING *`,
      );
      if (!rows[0]) {
        throw new ConflictException('Folha inexistente ou já paga/cancelada.');
      }
      const run = rows[0];
      // Gasto = custo total para a empresa (salários + encargos patronais).
      const amount = Number(run.employer_cost_total) || Number(run.gross_total) || 0;
      const period = `${run.period_year}-${String(run.period_month).padStart(2, '0')}`;
      // Só cria a despesa se a tabela existir (retrocompat tenants antigos).
      const hasExpenses = await tx.$queryRaw<{ reg: string | null }[]>(
        Prisma.sql`SELECT to_regclass('expenses')::text AS reg`,
      );
      if (hasExpenses[0]?.reg && amount > 0) {
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO expenses
              (category, description, amount, supplier, payment_method, document_ref,
               expense_date, created_by, created_by_name)
            VALUES ('SALARIOS', ${`Pagamento salarial — folha ${period}`}, ${amount},
                    NULL, NULL, ${`PAYROLL-${period}`},
                    now()::date, ${actor?.id ?? null}::uuid, ${actor?.name ?? null})`,
        );
      }
      return run;
    });
  }
}
