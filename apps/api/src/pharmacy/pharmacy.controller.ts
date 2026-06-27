import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { PharmacyService } from './pharmacy.service';

/** Farmácia — controlo de validade/lotes (vertical PHARMACY). */
@ApiTags('pharmacy')
@Controller('pharmacy')
export class PharmacyController {
  constructor(private readonly svc: PharmacyService, private readonly ctx: TenantContext) {}

  @Get('metrics')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'KPIs da farmácia (a expirar, expirados, receita, stock baixo)' })
  metrics() { return this.svc.metrics(this.ctx.requireTenantSchema()); }

  @Get('expiring')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Lotes a expirar (e expirados) com o medicamento' })
  expiring(@Query('days') days?: string) { return this.svc.expiring(this.ctx.requireTenantSchema(), Number(days) || 30); }
}
