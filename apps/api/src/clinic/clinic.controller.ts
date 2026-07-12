import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { ClinicService } from './clinic.service';
import { HospitalService } from './hospital.service';
import { CreateAppointmentDto, CreateConsultationDto, CreatePatientDto, StatusDto, UpdatePatientDto } from './dto/clinic.dto';

/** Clínica / Hospital (HIS) — pacientes, agenda, consultas, profissionais,
 *  receitas (dispensa FEFO na farmácia), leitos/internação, triagem e exames. */
@ApiTags('clinic')
@Controller('clinic')
export class ClinicController {
  constructor(
    private readonly svc: ClinicService,
    private readonly hospital: HospitalService,
    private readonly ctx: TenantContext,
  ) {}

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

  // ═══ HOSPITAL (HIS) ════════════════════════════════════════

  // ── Prontuário eletrónico ──────────────────────────────────
  @Get('patients/:id/record')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Prontuário do paciente (consultas, receitas, vitais, internações, exames)' })
  patientRecord(@Param('id') id: string) { return this.hospital.patientRecord(this.ctx.requireTenantSchema(), id); }

  // ── Profissionais de saúde ─────────────────────────────────
  @Get('professionals')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Lista profissionais de saúde (por categoria)' })
  professionals(@Query('category') category?: string) { return this.hospital.listProfessionals(this.ctx.requireTenantSchema(), category); }

  @Post('professionals')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Regista um profissional (médico, enfermeiro…)' })
  createProfessional(@Body() dto: Record<string, unknown>) { return this.hospital.createProfessional(this.ctx.requireTenantSchema(), dto as never); }

  @Patch('professionals/:id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Atualiza profissional (plantão, consultório, horário…)' })
  updateProfessional(@Param('id') id: string, @Body() dto: Record<string, unknown>) { return this.hospital.updateProfessional(this.ctx.requireTenantSchema(), id, dto as never); }

  // ── Receitas médicas + farmácia ────────────────────────────
  @Get('medications')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Medicamentos da farmácia (stock, princípio ativo, próxima validade)' })
  medications(@Query('search') search?: string) { return this.hospital.listMedications(this.ctx.requireTenantSchema(), search); }

  @Get('prescriptions')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Lista receitas médicas' })
  prescriptions(@Query('status') status?: string, @Query('patientId') patientId?: string) {
    return this.hospital.listPrescriptions(this.ctx.requireTenantSchema(), status, patientId);
  }

  @Post('prescriptions')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Emite uma receita médica (medicamentos + posologia)' })
  createPrescription(@Body() dto: Record<string, unknown>, @CurrentUser() user: JwtPayload) {
    return this.hospital.createPrescription(this.ctx.requireTenantSchema(), { id: user.sub }, dto as never);
  }

  @Get('prescriptions/:id')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Detalhe da receita (itens + stock da farmácia)' })
  getPrescription(@Param('id') id: string) { return this.hospital.getPrescription(this.ctx.requireTenantSchema(), id); }

  @Post('prescriptions/:id/dispense')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'DISPENSA a receita: baixa o stock da farmácia por lote (FEFO) + auditoria' })
  dispense(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.hospital.dispensePrescription(this.ctx.requireTenantSchema(), id, { id: user.sub, name: user.name ?? user.email ?? null });
  }

  @Post('prescriptions/:id/cancel')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Cancela a receita (se ainda não dispensada)' })
  cancelPrescription(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.hospital.cancelPrescription(this.ctx.requireTenantSchema(), id, { id: user.sub, name: user.name ?? user.email ?? null });
  }

  @Post('prescriptions/:id/invoice')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Fatura a receita dispensada (venda de farmácia — documento fiscal AGT)' })
  invoicePrescription(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.hospital.invoicePrescription(this.ctx.requireTenantSchema(), id, { id: user.sub, name: user.name ?? user.email ?? 'Operador' });
  }

  // ── Sinais vitais ──────────────────────────────────────────
  @Post('vitals')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Regista sinais vitais do paciente (prontuário)' })
  addVitals(@Body() dto: Record<string, unknown>, @CurrentUser() user: JwtPayload) {
    return this.hospital.addVitals(this.ctx.requireTenantSchema(), { id: user.sub }, dto as never);
  }

  // ── Leitos / internação ────────────────────────────────────
  @Get('beds')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Mapa de leitos (com o paciente internado em cada um)' })
  beds() { return this.hospital.listBeds(this.ctx.requireTenantSchema()); }

  @Post('beds')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Cria um leito (enfermaria/UTI/isolamento/quarto)' })
  createBed(@Body() dto: Record<string, unknown>) { return this.hospital.createBed(this.ctx.requireTenantSchema(), dto as never); }

  @Post('beds/:id/status')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Muda o estado do leito (livre/limpeza/manutenção/bloqueado)' })
  bedStatus(@Param('id') id: string, @Body() dto: StatusDto) { return this.hospital.setBedStatus(this.ctx.requireTenantSchema(), id, dto.status); }

  @Get('admissions')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Lista internações' })
  admissions(@Query('status') status?: string) { return this.hospital.listAdmissions(this.ctx.requireTenantSchema(), status); }

  @Post('admissions')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Interna um paciente num leito livre' })
  admit(@Body() dto: Record<string, unknown>, @CurrentUser() user: JwtPayload) {
    return this.hospital.admitPatient(this.ctx.requireTenantSchema(), { id: user.sub, name: user.name ?? user.email ?? null }, dto as never);
  }

  @Post('admissions/:id/discharge')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Alta/óbito: fecha a internação, calcula diárias e liberta o leito' })
  discharge(@Param('id') id: string, @Body() dto: { outcome?: string }, @CurrentUser() user: JwtPayload) {
    return this.hospital.dischargePatient(this.ctx.requireTenantSchema(), id, { id: user.sub, name: user.name ?? user.email ?? null }, dto?.outcome);
  }

  @Post('admissions/:id/invoice')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Fatura a internação (documento fiscal AGT) — só após a alta' })
  invoiceAdmission(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.hospital.invoiceAdmission(this.ctx.requireTenantSchema(), id, { id: user.sub, name: user.name ?? user.email ?? 'Operador' });
  }

  // ── Emergência / triagem ───────────────────────────────────
  @Get('emergency')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Fila de emergência ativa (ordenada por risco de Manchester)' })
  emergency() { return this.hospital.emergencyQueue(this.ctx.requireTenantSchema()); }

  @Post('emergency')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Regista chegada à emergência (triagem + classificação de risco)' })
  triage(@Body() dto: Record<string, unknown>, @CurrentUser() user: JwtPayload) {
    return this.hospital.registerTriage(this.ctx.requireTenantSchema(), { id: user.sub }, dto as never);
  }

  @Post('emergency/:id/status')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Avança o estado do episódio de emergência' })
  triageStatus(@Param('id') id: string, @Body() dto: StatusDto) { return this.hospital.setTriageStatus(this.ctx.requireTenantSchema(), id, dto.status); }

  // ── Exames ─────────────────────────────────────────────────
  @Get('exams')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Lista exames (pedido→colheita→laboratório→resultado)' })
  exams(@Query('status') status?: string) { return this.hospital.listExams(this.ctx.requireTenantSchema(), status); }

  @Post('exams')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Solicita um exame' })
  requestExam(@Body() dto: Record<string, unknown>, @CurrentUser() user: JwtPayload) {
    return this.hospital.requestExam(this.ctx.requireTenantSchema(), { id: user.sub }, dto as never);
  }

  @Post('exams/:id/status')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Avança o estado do exame (+ resultado/laudo)' })
  examStatus(@Param('id') id: string, @Body() dto: { status: string; resultText?: string }) {
    return this.hospital.setExamStatus(this.ctx.requireTenantSchema(), id, dto.status, dto.resultText);
  }

  @Post('exams/:id/invoice')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Fatura o exame (documento fiscal AGT; aplica coparticipação do convénio)' })
  invoiceExam(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.hospital.invoiceExam(this.ctx.requireTenantSchema(), id, { id: user.sub, name: user.name ?? user.email ?? 'Operador' });
  }

  // ── Convénios / Seguros ────────────────────────────────────
  @Get('insurers')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Lista convénios/seguros de saúde' })
  insurers() { return this.hospital.listInsurers(this.ctx.requireTenantSchema()); }

  @Post('insurers')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Regista um convénio (com % de cobertura)' })
  createInsurer(@Body() dto: Record<string, unknown>) { return this.hospital.createInsurer(this.ctx.requireTenantSchema(), dto as never); }

  @Post('patients/:id/insurer')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Atribui (ou remove) o convénio do paciente' })
  assignInsurer(@Param('id') id: string, @Body() dto: { insurerId?: string | null }) {
    return this.hospital.assignPatientInsurer(this.ctx.requireTenantSchema(), id, dto?.insurerId ?? null);
  }

  @Get('claims')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Sinistros de convénio (parte a receber das seguradoras)' })
  claims(@Query('status') status?: string) { return this.hospital.listClaims(this.ctx.requireTenantSchema(), status); }

  @Post('claims/:id/status')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Avança o estado do sinistro (submetido/pago/rejeitado)' })
  claimStatus(@Param('id') id: string, @Body() dto: StatusDto) { return this.hospital.setClaimStatus(this.ctx.requireTenantSchema(), id, dto.status); }
}
