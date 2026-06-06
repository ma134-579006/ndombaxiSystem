import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller('reports')
@Roles(Role.STORE_MANAGER)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly ctx: TenantContext,
  ) {}

  @Get('sales-by-user')
  @ApiOperation({ summary: 'Vendas por utilizador/operador' })
  salesByUser(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.salesByUser(this.ctx.requireTenantSchema(), from, to);
  }

  @Get('sales-by-category')
  @ApiOperation({ summary: 'Vendas por categoria de produto' })
  salesByCategory(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.salesByCategory(this.ctx.requireTenantSchema(), from, to);
  }

  @Get('sales-by-store')
  @ApiOperation({ summary: 'Vendas por loja' })
  salesByStore(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.salesByStore(this.ctx.requireTenantSchema(), from, to);
  }

  @Get('documents')
  @ApiOperation({ summary: 'Listagem de documentos (faturas/NC) por período/loja/tipo' })
  documents(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('storeId') storeId?: string,
    @Query('docType') docType?: string,
  ) {
    return this.reports.documents(this.ctx.requireTenantSchema(), { from, to, storeId, docType });
  }

  @Get('sales-by-brand')
  @ApiOperation({ summary: 'Vendas por marca' })
  salesByBrand(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.salesByBrand(this.ctx.requireTenantSchema(), from, to);
  }

  @Get('cash-sessions')
  @ApiOperation({ summary: 'Resumo de fecho de caixa (turnos fechados)' })
  cashSessions(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.cashSessions(this.ctx.requireTenantSchema(), from, to);
  }

  @Get('tax-map')
  @ApiOperation({ summary: 'Mapa de impostos (IVA) por taxa' })
  taxMap(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.taxMap(this.ctx.requireTenantSchema(), from, to);
  }

  @Get('payment-methods')
  @ApiOperation({ summary: 'Métodos de pagamento' })
  paymentMethods(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.paymentMethods(this.ctx.requireTenantSchema(), from, to);
  }
}
