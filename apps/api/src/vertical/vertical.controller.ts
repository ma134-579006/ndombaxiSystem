import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { VerticalService } from './vertical.service';

/** Métricas/relatório adaptados ao vertical da empresa. */
@ApiTags('vertical')
@Controller('vertical')
export class VerticalController {
  constructor(
    private readonly svc: VerticalService,
    private readonly ctx: TenantContext,
    private readonly prisma: PrismaService,
  ) {}

  @Get('metrics')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'KPIs do vertical (hotelaria/serviços/restauração)' })
  async metrics(@CurrentUser() user: JwtPayload) {
    const company = user.tenantId
      ? await this.prisma.company.findUnique({ where: { id: user.tenantId }, select: { sector: true } })
      : null;
    const businessType = company?.sector || 'RETAIL';
    return this.svc.metrics(this.ctx.requireTenantSchema(), businessType);
  }
}
