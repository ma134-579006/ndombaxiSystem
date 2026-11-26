import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { effectiveStoreId } from '../auth/store-scope';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { ReportsService } from './reports.service';
import { AccountingReportsService } from './accounting-reports.service';

@ApiTags('reports')
@Controller('reports')
@Roles(Role.STORE_MANAGER)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly ctx: TenantContext,
    private readonly accounting: AccountingReportsService,
  ) {}

  @Get('sales-by-user')
  @ApiOperation({ summary: 'Vendas por utilizador/operador' })
  salesByUser(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string) {
    return this.reports.salesByUser(this.ctx.requireTenantSchema(), from, to, effectiveStoreId(user, storeId));
  }

  @Get('sales-by-category')
  @ApiOperation({ summary: 'Vendas por categoria de produto' })
  salesByCategory(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string) {
    return this.reports.salesByCategory(this.ctx.requireTenantSchema(), from, to, effectiveStoreId(user, storeId));
  }

  @Get('sales-by-customer')
  @ApiOperation({ summary: 'Clientes que mais compram' })
  salesByCustomer(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string) {
    return this.reports.salesByCustomer(this.ctx.requireTenantSchema(), from, to, effectiveStoreId(user, storeId));
  }

  @Get('sales-by-time')
  @ApiOperation({ summary: 'Vendas por hora, dia da semana, dia ou mês (hora de Luanda)' })
  salesByTime(@CurrentUser() user: JwtPayload, @Query('by') by?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string) {
    const b = by === 'hour' || by === 'weekday' || by === 'month' ? by : 'day';
    return this.reports.salesByTime(this.ctx.requireTenantSchema(), b, from, to, effectiveStoreId(user, storeId));
  }

  @Get('sales-by-store')
  @ApiOperation({ summary: 'Vendas por loja' })
  salesByStore(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.salesByStore(this.ctx.requireTenantSchema(), from, to, effectiveStoreId(user, undefined));
  }

  @Get('documents')
  @ApiOperation({ summary: 'Listagem de documentos (faturas/NC) por período/loja/tipo' })
  documents(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('storeId') storeId?: string,
    @Query('docType') docType?: string,
  ) {
    return this.reports.documents(this.ctx.requireTenantSchema(), { from, to, storeId: effectiveStoreId(user, storeId), docType });
  }

  @Get('sales-by-brand')
  @ApiOperation({ summary: 'Vendas por marca' })
  salesByBrand(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string) {
    return this.reports.salesByBrand(this.ctx.requireTenantSchema(), from, to, effectiveStoreId(user, storeId));
  }

  @Get('cash-sessions')
  @ApiOperation({ summary: 'Resumo de fecho de caixa (turnos fechados)' })
  cashSessions(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.cashSessions(this.ctx.requireTenantSchema(), from, to);
  }

  @Get('tax-map')
  @ApiOperation({ summary: 'Mapa de impostos (IVA) por taxa' })
  taxMap(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string) {
    return this.reports.taxMap(this.ctx.requireTenantSchema(), from, to, effectiveStoreId(user, storeId));
  }

  @Get('payment-methods')
  @ApiOperation({ summary: 'Métodos de pagamento' })
  paymentMethods(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string) {
    return this.reports.paymentMethods(this.ctx.requireTenantSchema(), from, to, effectiveStoreId(user, storeId));
  }

  // ── Contabilidade (como o Vendus: Gestão › Contabilidade) ──
  @Get('accounting/documents')
  @ApiOperation({ summary: 'Contabilidade › Listagem de Documentos (linhas, Total IVA e Total por tipo)' })
  accDocuments(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string, @Query('types') types?: string) {
    return this.accounting.documents(this.ctx.requireTenantSchema(), { from, to, storeId: effectiveStoreId(user, storeId), types });
  }

  @Get('accounting/tax-map')
  @ApiOperation({ summary: 'Contabilidade › Mapa de Impostos (por código/taxa e por tipo)' })
  accTaxMap(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string) {
    return this.accounting.taxMap(this.ctx.requireTenantSchema(), { from, to, storeId: effectiveStoreId(user, storeId) });
  }

  @Get('accounting/products')
  @ApiOperation({ summary: 'Contabilidade › Listagem de Produtos (linhas vendidas)' })
  accProductLines(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string) {
    return this.accounting.productLines(this.ctx.requireTenantSchema(), { from, to, storeId: effectiveStoreId(user, storeId) });
  }

  @Get('accounting/daily-sales')
  @ApiOperation({ summary: 'Contabilidade › Vendas Diárias (por loja e produto)' })
  accDailySales(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string) {
    return this.accounting.dailySales(this.ctx.requireTenantSchema(), { from, to, storeId: effectiveStoreId(user, storeId) });
  }

  @Get('accounting/payment-types')
  @ApiOperation({ summary: 'Contabilidade › Tipos de Pagamento (por loja/caixa)' })
  accPaymentTypes(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string) {
    return this.accounting.paymentTypes(this.ctx.requireTenantSchema(), { from, to, storeId: effectiveStoreId(user, storeId) });
  }

  @Get('accounting/supplier-tax-map')
  @ApiOperation({ summary: 'Contabilidade › Mapa de Impostos Fornecedores (compras rececionadas)' })
  accSupplierTaxMap(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string) {
    return this.accounting.supplierTaxMap(this.ctx.requireTenantSchema(), { from, to, storeId: effectiveStoreId(user, storeId) });
  }
}
