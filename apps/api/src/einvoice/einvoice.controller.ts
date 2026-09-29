import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { EinvoiceService } from './einvoice.service';

export class UpdateFeConfigDto {
  @IsOptional() @IsIn(['HML', 'PROD']) environment?: 'HML' | 'PROD';
  @IsOptional() @IsString() @Length(0, 120) basicUser?: string;
  @IsOptional() @IsString() @Length(0, 200) basicPassword?: string;
  @IsOptional() @IsString() @Length(0, 120) productId?: string;
  @IsOptional() @IsString() @Length(0, 40) productVersion?: string;
  @IsOptional() @IsString() @Length(0, 40) softwareValidationNumber?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class ProvisionKeyDto {
  @IsOptional() @IsInt() @IsIn([2048, 3072, 4096]) modulusBits?: number;
}

export class SaveFeCompanyDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @Length(1, 200) establishmentNumber?: string;
  @IsOptional() @IsString() @Length(100, 12000) taxpayerPrivateKey?: string;
}

export class RequestSeriesDto {
  @IsString() @IsIn(['FT', 'FS', 'NC', 'ND']) documentType!: string;
  @IsInt() @Min(2024) @Max(2100) year!: number;
}

/** Facturação Electrónica AGT — gestão pelo Super Admin (produtor do software). */
@ApiTags('super-admin')
@Controller('super-admin/fiscal/einvoice')
@Roles(Role.SUPER_ADMIN)
export class EinvoiceAdminController {
  constructor(private readonly fe: EinvoiceService) {}

  @Get('config')
  @ApiOperation({ summary: 'Configuração da FE (credenciais mascaradas)' })
  config() {
    return this.fe.getConfigSafe();
  }

  @Patch('config')
  @ApiOperation({ summary: 'Actualiza ambiente, credenciais Basic, produto e nº de validação' })
  update(@Body() dto: UpdateFeConfigDto) {
    return this.fe.updateConfig(dto);
  }

  @Post('software-key')
  @ApiOperation({ summary: 'Gera/roda a chave RSA (≥2048) do software (jwsSoftwareSignature)' })
  provision(@Body() dto?: ProvisionKeyDto) {
    return this.fe.provisionSoftwareKey(dto?.modulusBits);
  }

  @Get('software-key/export')
  @ApiOperation({ summary: 'Exporta a chave pública do software para o Portal do Parceiro' })
  exportKey() {
    return this.fe.exportSoftwarePublicKey();
  }

  @Get('company/:id')
  @ApiOperation({ summary: 'Estado da FE de uma empresa' })
  company(@Param('id', ParseUUIDPipe) id: string) {
    return this.fe.companyStatus(id);
  }

  @Put('company/:id')
  @ApiOperation({ summary: 'Activa a FE numa empresa / guarda a chave do contribuinte' })
  saveCompany(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveFeCompanyDto) {
    return this.fe.saveCompany(id, dto);
  }

  @Post('company/:id/series')
  @ApiOperation({ summary: 'Pede uma série à AGT (solicitarSerie)' })
  series(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RequestSeriesDto) {
    return this.fe.requestSeries(id, dto.documentType, dto.year);
  }

  @Get('company/:id/series')
  @ApiOperation({ summary: 'Lista as séries na AGT (listarSeries)' })
  listSeries(@Param('id', ParseUUIDPipe) id: string) {
    return this.fe.listRemoteSeries(id);
  }

  @Post('company/:id/sync')
  @ApiOperation({ summary: 'Recolhe, envia e consulta agora' })
  sync(@Param('id', ParseUUIDPipe) id: string) {
    return this.fe.syncNow(id);
  }

  @Get('company/:id/documents')
  @ApiOperation({ summary: 'Documentos na fila/enviados (até 200)' })
  documents(@Param('id', ParseUUIDPipe) id: string, @Query('status') status?: string) {
    return this.fe.listDocuments(id, status);
  }

  @Post('company/:id/requeue')
  @ApiOperation({ summary: 'Repõe um documento inválido/erro na fila' })
  requeue(@Param('id', ParseUUIDPipe) id: string, @Body() body: { documentNo: string }) {
    return this.fe.requeue(id, String(body?.documentNo ?? ''));
  }
}

/** Estado da FE para o gestor da própria empresa (leitura + sincronizar). */
@ApiTags('fiscal')
@Controller('fiscal/einvoice')
export class EinvoiceTenantController {
  constructor(private readonly fe: EinvoiceService) {}

  @Get('status')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Estado da Facturação Electrónica desta empresa' })
  status(@CurrentUser() user: JwtPayload) {
    return this.fe.companyStatus(user.tenantId as string);
  }

  @Post('sync')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Envia e consulta agora os documentos desta empresa' })
  sync(@CurrentUser() user: JwtPayload) {
    return this.fe.syncNow(user.tenantId as string);
  }
}
