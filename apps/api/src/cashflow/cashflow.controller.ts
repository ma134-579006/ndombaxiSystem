import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { CashflowService } from './cashflow.service';

/** Fluxo de caixa — só o gestor da empresa (STORE_MANAGER+). */
@ApiTags('cashflow')
@Controller('cashflow')
@Roles(Role.STORE_MANAGER)
export class CashflowController {
  constructor(
    private readonly cashflow: CashflowService,
    private readonly ctx: TenantContext,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: 'Resumo do fluxo de caixa (entradas, saídas, saldo)' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.cashflow.summary(this.ctx.requireTenantSchema(), from, to);
  }

  @Get('series')
  @ApiOperation({ summary: 'Série diária de entradas vs saídas' })
  series(@Query('from') from?: string, @Query('to') to?: string) {
    return this.cashflow.series(this.ctx.requireTenantSchema(), from, to);
  }

  @Get('forecast')
  @ApiOperation({ summary: 'Previsão de fluxo de caixa para os próximos 30 dias' })
  forecast() {
    return this.cashflow.forecast(this.ctx.requireTenantSchema());
  }
}
