import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';

export interface EmployeeRow {
  id: string;
  employee_number: string;
  full_name: string;
  tax_id: string | null;
  inss_number: string | null;
  position: string | null;
  department: string | null;
  store_id: string | null;
  hire_date: Date;
  termination_date: Date | null;
  base_salary: string;
  taxable_allowances: string;
  exempt_allowances: string;
  iban: string | null;
  status: string;
}

@Injectable()
export class HrRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(schema: string, input: CreateEmployeeDto): Promise<EmployeeRow> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<EmployeeRow[]>(
        Prisma.sql`INSERT INTO employees
            (employee_number, full_name, tax_id, inss_number, position, department,
             store_id, hire_date, base_salary, taxable_allowances, exempt_allowances, iban)
          VALUES (${input.employeeNumber}, ${input.fullName}, ${input.taxId ?? null},
                  ${input.inssNumber ?? null}, ${input.position ?? null}, ${input.department ?? null},
                  ${input.storeId ?? null}::uuid,
                  ${input.hireDate ?? null}::date,
                  ${input.baseSalary}, ${input.taxableAllowances ?? 0},
                  ${input.exemptAllowances ?? 0}, ${input.iban ?? null})
          RETURNING *`,
      );
      return rows[0];
    });
  }

  list(schema: string, includeInactive = false): Promise<EmployeeRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<EmployeeRow[]>(
        includeInactive
          ? Prisma.sql`SELECT * FROM employees ORDER BY full_name`
          : Prisma.sql`SELECT * FROM employees WHERE status = 'ACTIVE' ORDER BY full_name`,
      ),
    );
  }

  async get(schema: string, id: string): Promise<EmployeeRow> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<EmployeeRow[]>(
        Prisma.sql`SELECT * FROM employees WHERE id = ${id}::uuid LIMIT 1`,
      ),
    );
    if (!rows[0]) throw new NotFoundException(`Trabalhador não encontrado: ${id}`);
    return rows[0];
  }

  async update(schema: string, id: string, input: UpdateEmployeeDto): Promise<EmployeeRow> {
    const sets: Prisma.Sql[] = [];
    if (input.fullName !== undefined) sets.push(Prisma.sql`full_name = ${input.fullName}`);
    if (input.position !== undefined) sets.push(Prisma.sql`position = ${input.position}`);
    if (input.department !== undefined) sets.push(Prisma.sql`department = ${input.department}`);
    if (input.storeId !== undefined) sets.push(Prisma.sql`store_id = ${input.storeId}::uuid`);
    if (input.baseSalary !== undefined) sets.push(Prisma.sql`base_salary = ${input.baseSalary}`);
    if (input.taxableAllowances !== undefined)
      sets.push(Prisma.sql`taxable_allowances = ${input.taxableAllowances}`);
    if (input.exemptAllowances !== undefined)
      sets.push(Prisma.sql`exempt_allowances = ${input.exemptAllowances}`);
    if (input.iban !== undefined) sets.push(Prisma.sql`iban = ${input.iban}`);

    if (sets.length === 0) return this.get(schema, id);
    sets.push(Prisma.sql`updated_at = now()`);

    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<EmployeeRow[]>(
        Prisma.sql`UPDATE employees SET ${Prisma.join(sets, ', ')}
                   WHERE id = ${id}::uuid RETURNING *`,
      ),
    );
    if (!rows[0]) throw new NotFoundException(`Trabalhador não encontrado: ${id}`);
    return rows[0];
  }

  async terminate(schema: string, id: string, date?: string): Promise<EmployeeRow> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<EmployeeRow[]>(
        Prisma.sql`UPDATE employees
                   SET status = 'TERMINATED',
                       termination_date = COALESCE(${date ?? null}::date, CURRENT_DATE),
                       updated_at = now()
                   WHERE id = ${id}::uuid RETURNING *`,
      ),
    );
    if (!rows[0]) throw new NotFoundException(`Trabalhador não encontrado: ${id}`);
    return rows[0];
  }
}
