import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { ClinicService } from './clinic.service';
import { CreateAppointmentDto, CreateConsultationDto, CreatePatientDto, StatusDto, UpdatePatientDto } from './dto/clinic.dto';

/** Clínica / Saúde — pacientes, agenda e consultas (vertical CLINIC). */
@ApiTags('clinic')
@Controller('clinic')
export class ClinicController {
  constructor(private readonly svc: ClinicService, private readonly ctx: TenantContext) {}

  @Get('metrics')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'KPIs da clínica (marcações hoje, consultas, pacientes, receita)' })
  metrics() { return this.svc.metrics(this.ctx.requireTenantSchema()); }

  @Get('dashboard')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Centro de comando da clínica (agenda de hoje, fila, pacientes, vendas)' })
  dashboard() { return this.svc.getDashboard(this.ctx.requireTenantSchema()); }

  // ── Pacientes ──────────────────────────────────────────────
  @Get('patients')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Lista pacientes (pesquisa por nome/telefone)' })
  patients(@Query('search') search?: string) { return this.svc.listPatients(this.ctx.requireTenantSchema(), search); }

  @Post('patients')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Regista um paciente' })
  createPatient(@Body() dto: CreatePatientDto) { return this.svc.createPatient(this.ctx.requireTenantSchema(), dto); }

  @Get('patients/:id')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Ficha do paciente (com histórico de consultas)' })
  getPatient(@Param('id') id: string) { return this.svc.getPatient(this.ctx.requireTenantSchema(), id); }

  @Patch('patients/:id')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Atualiza dados do paciente' })
  updatePatient(@Param('id') id: string, @Body() dto: UpdatePatientDto) { return this.svc.updatePatient(this.ctx.requireTenantSchema(), id, dto); }

  // ── Agenda (marcações) ─────────────────────────────────────
  @Get('appointments')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Agenda do dia (ou próximas)' })
  appointments(@Query('day') day?: string) { return this.svc.listAppointments(this.ctx.requireTenantSchema(), day); }

  @Post('appointments')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Cria uma marcação' })
  createAppointment(@Body() dto: CreateAppointmentDto) { return this.svc.createAppointment(this.ctx.requireTenantSchema(), dto); }

  @Post('appointments/:id/status')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Muda o estado da marcação (realizada/cancelada/faltou)' })
  apptStatus(@Param('id') id: string, @Body() dto: StatusDto) { return this.svc.setAppointmentStatus(this.ctx.requireTenantSchema(), id, dto.status); }

  // ── Consultas ──────────────────────────────────────────────
  @Post('consultations')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Regista uma consulta (sintomas, diagnóstico, receita)' })
  createConsultation(@Body() dto: CreateConsultationDto, @CurrentUser() user: JwtPayload) {
    return this.svc.createConsultation(this.ctx.requireTenantSchema(), { id: user.sub }, dto);
  }

  @Post('consultations/:id/invoice')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Fatura a consulta (documento fiscal AGT)' })
  invoiceConsultation(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.invoiceConsultation(this.ctx.requireTenantSchema(), id, { id: user.sub, name: user.name ?? user.email ?? 'Operador' });
  }
}
