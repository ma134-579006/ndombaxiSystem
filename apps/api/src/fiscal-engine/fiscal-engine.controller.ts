import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { FiscalEngineService } from './fiscal-engine.service';

export class FiscalEngineSettingsDto {
  @IsOptional() @IsBoolean() vendusEnabled?: boolean;
  @IsOptional() @IsString() @Length(0, 200) vendusBaseUrl?: string;
  @IsOptional() @IsIn(['1.0', '1.1', '1.2']) vendusApiVersion?: string;
  @IsOptional() @IsString() @Length(0, 200) providerProducer?: string;
  @IsOptional() @IsString() @Length(0, 120) providerSoftware?: string;
  @IsOptional() @IsString() @Length(0, 60) providerValidationNo?: string;
  @IsOptional() @IsString() @Length(0, 60) providerFeCertNo?: string;
  @IsOptional() @IsString() @Length(0, 40) providerVersion?: string;
  @IsOptional() @IsString() providerValidFrom?: string | null;
  @IsOptional() @IsString() providerValidUntil?: string | null;
  @IsOptional() @IsString() @Length(0, 500) providerEvidenceUrl?: string;
  @IsOptional() @IsString() providerEvidenceId?: string | null;
  @IsOptional() @IsString() @Length(0, 120) providerVerifiedBy?: string;
  @IsOptional() @IsBoolean() verifyNow?: boolean;
  @IsOptional() @IsArray() @IsInt({ each: true }) alertDays?: number[];
}

export class LpsValidationDto {
  @IsOptional() @IsString() @Length(0, 60) lpsValidationNo?: string;
  @IsOptional() @IsString() @Length(0, 40) lpsValidationVersion?: string;
  @IsOptional() @IsString() lpsEvidenceId?: string | null;
  @IsOptional() @IsBoolean() testsApproved?: boolean;
  @IsOptional() @IsBoolean() confirm?: boolean;
}

export class EvidenceDto {
  @IsIn(['PROVIDER_VALIDITY', 'LPS_VALIDATION']) kind!: string;
  @IsString() @Length(1, 120) filename!: string;
  @IsIn(['application/pdf', 'image/png', 'image/jpeg']) contentType!: string;
  @IsString() base64!: string;
}

export class ApiKeyDto {
  @IsString() @Length(16, 200) apiKey!: string;
}

export class CompanyConfigDto {
  @IsOptional() @IsString() @Length(0, 40) registerId?: string;
  @IsOptional() @IsString() @Length(0, 40) storeId?: string;
  @IsOptional() @IsObject() paymentMap?: Record<string, string>;
  @IsOptional() @IsBoolean() feConfirmed?: boolean;
  @IsOptional() @IsString() @Length(0, 20) taxpayerNif?: string;
}

export class SuspendDto {
  @IsString() @Length(5, 300) reason!: string;
}

export class UseLpsDto {
  @IsString() confirmation!: string;
}

export class SaftFetchDto {
  @Type(() => Number) @IsInt() @Min(2019) @Max(2100) year!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(12) month!: number;
}

const actor = (u: JwtPayload) => ({ id: u.sub, name: u.name ?? u.email });

/** Super Admin → Fiscal → Facturação Electrónica e Software de Terceiros. */
@ApiTags('super-admin')
@Controller('super-admin/fiscal-engine')
@Roles(Role.SUPER_ADMIN)
export class FiscalEngineAdminController {
  constructor(private readonly svc: FiscalEngineService) {}

  @Get()
  @ApiOperation({ summary: 'Motor fiscal: switch, validade do fornecedor, empresas e indicadores' })
  overview() {
    return this.svc.overview();
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Switch Vendus, versão da API e validação AGT do fornecedor (com evidência)' })
  settings(@Body() dto: FiscalEngineSettingsDto, @CurrentUser() u: JwtPayload) {
    return this.svc.updateSettings(dto as Record<string, unknown>, actor(u));
  }

  @Patch('lps-validation')
  @ApiOperation({ summary: 'Validação AGT própria do LPS (Modo B)' })
  lps(@Body() dto: LpsValidationDto, @CurrentUser() u: JwtPayload) {
    return this.svc.updateLpsValidation(dto as Record<string, unknown>, actor(u));
  }

  @Post('evidence')
  @ApiOperation({ summary: 'Carrega uma evidência documental (PDF/PNG/JPEG até 5 MB)' })
  upload(@Body() dto: EvidenceDto, @CurrentUser() u: JwtPayload) {
    return this.svc.uploadEvidence(dto.kind, dto, actor(u));
  }

  @Get('evidence/:id')
  async evidence(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const e = await this.svc.evidence(id);
    res.setHeader('Content-Type', e.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${e.filename.replace(/[^\w.\-]/g, '_')}"`);
    res.setHeader('X-Content-SHA256', e.sha256);
    res.send(Buffer.from(e.data));
  }

  @Get('company/:id')
  company(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.companyDetail(id);
  }

  @Put('company/:id/api-key')
  @ApiOperation({ summary: 'Guarda a API KEY Vendus da empresa (cifrada; nunca devolvida)' })
  apiKey(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApiKeyDto, @CurrentUser() u: JwtPayload) {
    return this.svc.saveApiKey(id, dto.apiKey, actor(u));
  }

  @Delete('company/:id/api-key')
  removeKey(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: JwtPayload) {
    return this.svc.removeApiKey(id, actor(u));
  }

  @Post('company/:id/test')
  @ApiOperation({ summary: 'Testa a ligação (GET /account/, caixas, impostos, pagamentos)' })
  test(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: JwtPayload) {
    return this.svc.testConnection(id, actor(u));
  }

  @Patch('company/:id')
  configure(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CompanyConfigDto, @CurrentUser() u: JwtPayload) {
    return this.svc.configureCompany(id, dto as Record<string, unknown>, actor(u));
  }

  @Post('company/:id/tests')
  @ApiOperation({ summary: 'Documento em modo Formação/Testes (sem validade fiscal): criar, ler e obter PDF' })
  runTests(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: JwtPayload) {
    return this.svc.runTests(id, actor(u));
  }

  @Post('company/:id/activate')
  activate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: JwtPayload) {
    return this.svc.activate(id, actor(u));
  }

  @Post('company/:id/suspend')
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SuspendDto, @CurrentUser() u: JwtPayload) {
    return this.svc.suspend(id, dto.reason, actor(u));
  }

  @Post('company/:id/use-lps')
  useLps(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UseLpsDto, @CurrentUser() u: JwtPayload) {
    return this.svc.useLpsEngine(id, dto.confirmation, actor(u));
  }

  @Post('company/:id/health')
  health(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.checkHealthNow(id);
  }
}

/** Empresa: estado da própria ligação, documentos fiscais, PDF original, sincronização e SAF-T. */
@ApiTags('fiscal-engine')
@Controller('fiscal-engine')
export class FiscalEngineTenantController {
  constructor(private readonly svc: FiscalEngineService, private readonly ctx: TenantContext) {}

  @Get('status')
  @Roles(Role.STORE_MANAGER)
  async status() {
    const schema = this.ctx.requireTenantSchema();
    const co = await this.svc.companyBySchema(schema);
    const d = await this.svc.companyDetail(co.id);
    const counts = await this.svc.documentSummaryCounts(schema);
    // A empresa vê o estado, nunca a chave nem a configuração interna.
    return {
      engine: d.engine,
      effective: d.effective,
      indicator: d.indicator,
      checks: d.checks,
      validity: { status: d.validity.status, daysLeft: d.validity.daysLeft },
      account: d.link ? { company: d.link.accountCompany, fiscalId: d.link.accountFiscalId, country: d.link.accountCountry, register: d.link.registerTitle } : null,
      counts,
    };
  }

  @Get('documents')
  @Roles(Role.STORE_MANAGER)
  list(@Query('state') state?: string, @Query('limit') limit?: string) {
    return this.svc.listDocuments(this.ctx.requireTenantSchema(), { state, limit: Number(limit) || undefined });
  }

  @Get('documents/:id')
  @Roles(Role.STORE_MANAGER)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.documentDetail(this.ctx.requireTenantSchema(), id);
  }

  @Get('invoice/:invoiceId')
  @Roles(Role.CASHIER)
  forInvoice(@Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    return this.svc.documentForInvoice(this.ctx.requireTenantSchema(), invoiceId);
  }

  @Get('documents/:id/pdf')
  @Roles(Role.CASHIER)
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { pdf, number } = await this.svc.documentPdf(this.ctx.requireTenantSchema(), id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${(number ?? id).replace(/[^\w.\-]/g, '_')}.pdf"`);
    res.send(pdf);
  }

  @Post('documents/:id/retry')
  @Roles(Role.COMPANY_ADMIN)
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.retry(this.ctx.requireTenantSchema(), id);
  }

  @Post('sync/clients')
  @Roles(Role.COMPANY_ADMIN)
  syncClients() {
    return this.svc.syncClients(this.ctx.requireTenantSchema());
  }

  @Post('sync/products')
  @Roles(Role.COMPANY_ADMIN)
  syncProducts() {
    return this.svc.syncProducts(this.ctx.requireTenantSchema());
  }

  @Get('saft')
  @Roles(Role.COMPANY_ADMIN)
  saftHistory() {
    return this.svc.saftHistory(this.ctx.requireTenantSchema());
  }

  @Post('saft')
  @Roles(Role.COMPANY_ADMIN)
  saftFetch(@Body() dto: SaftFetchDto) {
    return this.svc.fetchSaft(this.ctx.requireTenantSchema(), dto.year, dto.month);
  }

  @Get('saft/:id/xml')
  @Roles(Role.COMPANY_ADMIN)
  async saftXml(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.svc.saftFile(this.ctx.requireTenantSchema(), id);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="SAFT-AO-Vendus-${f.year}-${String(f.month).padStart(2, '0')}.xml"`);
    res.send(f.xml);
  }
}
