import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';
import { ProcessPayrollDto } from './dto/payroll.dto';
import { HrRepository } from './hr.repository';
import { PayrollService } from './payroll.service';

@ApiTags('hr')
@Controller('hr')
@Roles(Role.STORE_MANAGER)
export class HrController {
  constructor(
    private readonly employees: HrRepository,
    private readonly payroll: PayrollService,
    private readonly ctx: TenantContext,
  ) {}

  // ── Trabalhadores ──────────────────────────────────────────
  @Get('employees')
  @ApiOperation({ summary: 'Lista trabalhadores' })
  @ApiQuery({ name: 'all', required: false, description: 'Incluir inactivos/cessados' })
  listEmployees(@Query('all') all?: string) {
    return this.employees.list(this.ctx.requireTenantSchema(), all === 'true');
  }

  @Get('employees/:id')
  @ApiOperation({ summary: 'Detalhe de um trabalhador' })
  getEmployee(@Param('id') id: string) {
    return this.employees.get(this.ctx.requireTenantSchema(), id);
  }

  @Post('employees')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Cria trabalhador' })
  createEmployee(@Body() dto: CreateEmployeeDto) {
    return this.employees.create(this.ctx.requireTenantSchema(), dto);
  }

  @Patch('employees/:id')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Actualiza trabalhador' })
  updateEmployee(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employees.update(this.ctx.requireTenantSchema(), id, dto);
  }

  @Post('employees/:id/terminate')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Cessa o contrato de um trabalhador' })
  terminateEmployee(@Param('id') id: string, @Body('date') date?: string) {
    return this.employees.terminate(this.ctx.requireTenantSchema(), id, date);
  }

  @Delete('employees/:id')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Elimina um trabalhador (cessa se tiver histórico de folha)' })
  removeEmployee(@Param('id') id: string) {
    return this.employees.remove(this.ctx.requireTenantSchema(), id);
  }

  // ── Processamento salarial ─────────────────────────────────
  @Get('payroll/runs')
  @ApiOperation({ summary: 'Lista folhas salariais processadas' })
  listRuns() {
    return this.payroll.listRuns(this.ctx.requireTenantSchema());
  }

  @Get('payroll/runs/:id')
  @ApiOperation({ summary: 'Detalhe de uma folha salarial (com linhas)' })
  getRun(@Param('id') id: string) {
    return this.payroll.getRun(this.ctx.requireTenantSchema(), id);
  }

  @Post('payroll/runs')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Processa a folha salarial de um período (INSS + IRT)' })
  processRun(@Body() dto: ProcessPayrollDto) {
    return this.payroll.process(this.ctx.requireTenantSchema(), dto.year, dto.month, dto.adjustments ?? []);
  }

  @Post('payroll/runs/:id/pay')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Marca a folha salarial como paga' })
  payRun(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.payroll.markPaid(this.ctx.requireTenantSchema(), id, {
      id: user.sub, name: user.name ?? user.email ?? null,
    });
  }
}
