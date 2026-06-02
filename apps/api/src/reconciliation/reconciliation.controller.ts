import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { ReconciliationService } from './reconciliation.service';

class StatementRowDto {
  @IsString()
  date!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  amount!: number;
}

class ImportStatementDto {
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => StatementRowDto)
  rows!: StatementRowDto[];
}

class MatchDto {
  @IsOptional()
  @IsString()
  type?: string;
}

function actor(u: JwtPayload) {
  return { id: u?.sub ?? null, name: u?.email ?? null };
}

/** Conciliação bancária — gestor da loja (STORE_MANAGER+). */
@ApiTags('reconciliation')
@Controller('reconciliation')
@Roles(Role.STORE_MANAGER)
export class ReconciliationController {
  constructor(
    private readonly recon: ReconciliationService,
    private readonly ctx: TenantContext,
  ) {}

  @Post('import')
  @ApiOperation({ summary: 'Importa um extrato bancário e auto-concilia' })
  importStatement(@Body() dto: ImportStatementDto, @CurrentUser() u: JwtPayload) {
    return this.recon.importStatement(this.ctx.requireTenantSchema(), dto.rows, actor(u));
  }

  @Get()
  @ApiOperation({ summary: 'Movimentos do extrato (filtro: matched | unmatched)' })
  @ApiQuery({ name: 'filter', required: false })
  list(@Query('filter') filter?: string) {
    return this.recon.list(this.ctx.requireTenantSchema(), filter || undefined);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Resumo: créditos, débitos, conciliados/por conciliar' })
  summary() {
    return this.recon.summary(this.ctx.requireTenantSchema());
  }

  @Post(':id/match')
  @ApiOperation({ summary: 'Concilia manualmente um movimento' })
  match(@Param('id') id: string, @Body() dto: MatchDto, @CurrentUser() u: JwtPayload) {
    return this.recon.setMatch(this.ctx.requireTenantSchema(), id, true, dto.type ?? 'MANUAL', actor(u));
  }

  @Post(':id/unmatch')
  @ApiOperation({ summary: 'Marca um movimento como não conciliado' })
  unmatch(@Param('id') id: string, @CurrentUser() u: JwtPayload) {
    return this.recon.setMatch(this.ctx.requireTenantSchema(), id, false, null, actor(u));
  }
}
