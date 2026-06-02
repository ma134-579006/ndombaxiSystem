import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { ProfitService } from './profit.service';

/** Lucros da empresa — só o gestor (STORE_MANAGER+). */
@ApiTags('profit')
@Controller('profit')
@Roles(Role.STORE_MANAGER)
export class ProfitController {
  constructor(
    private readonly profit: ProfitService,
    private readonly ctx: TenantContext,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: 'Resumo de lucros (vendas, custo, bruto, líquido) no período' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.profit.summary(this.ctx.requireTenantSchema(), from, to);
  }

  @Get('series')
  @ApiOperation({ summary: 'Série temporal de vendas/custo/lucro' })
  series(@Query('from') from?: string, @Query('to') to?: string) {
    return this.profit.series(this.ctx.requireTenantSchema(), from, to);
  }

  @Get('by-product')
  @ApiOperation({ summary: 'Lucro por produto' })
  byProduct(@Query('from') from?: string, @Query('to') to?: string) {
    return this.profit.byProduct(this.ctx.requireTenantSchema(), from, to);
  }

  @Get('abc')
  @ApiOperation({ summary: 'Curva ABC de produtos (peso nas vendas)' })
  abc(@Query('from') from?: string, @Query('to') to?: string) {
    return this.profit.abc(this.ctx.requireTenantSchema(), from, to);
  }
}
