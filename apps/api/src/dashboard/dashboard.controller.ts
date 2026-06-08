import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { effectiveStoreId } from '../auth/store-scope';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { DashboardService, SALES_RANGES, type SalesRange } from './dashboard.service';

/** Dashboard do gestor. COMPANY_ADMIN vê todas as lojas (ou a loja pedida);
 *  um gestor de loja vê só a sua (permissões por loja). */
@ApiTags('dashboard')
@Controller('dashboard')
@Roles(Role.SHIFT_SUPERVISOR)
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly ctx: TenantContext,
  ) {}

  @Get('sales/today')
  @ApiOperation({ summary: 'KPIs de vendas do dia' })
  salesToday(@CurrentUser() user: JwtPayload, @Query('storeId') storeId?: string) {
    return this.dashboard.salesToday(this.ctx.requireTenantSchema(), effectiveStoreId(user, storeId));
  }

  @Get('sales/by-store')
  @ApiOperation({ summary: 'Vendas de hoje por loja (multi-loja, tempo real)' })
  salesByStore(@CurrentUser() user: JwtPayload) {
    return this.dashboard.salesTodayByStore(this.ctx.requireTenantSchema(), effectiveStoreId(user, undefined));
  }

  @Get('sales/by-day')
  @ApiOperation({ summary: 'Vendas por dia (série temporal)' })
  @ApiQuery({ name: 'days', required: false, example: 30 })
  salesByDay(@Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number) {
    return this.dashboard.salesByDay(this.ctx.requireTenantSchema(), days);
  }

  @Get('sales/series')
  @ApiOperation({
    summary: 'Série temporal de vendas para gráficos em tempo real',
    description:
      'Intervalos: today, yesterday, 7d, 1m, 3m, 6m, 1y. Granularidade automática (horária/diária/semanal/mensal).',
  })
  @ApiQuery({ name: 'range', required: false, enum: SALES_RANGES, example: '7d' })
  salesSeries(@CurrentUser() user: JwtPayload, @Query('range', new DefaultValuePipe('7d')) range: string, @Query('storeId') storeId?: string) {
    if (!SALES_RANGES.includes(range as SalesRange)) {
      throw new BadRequestException(
        `Intervalo inválido: ${range}. Use um de: ${SALES_RANGES.join(', ')}.`,
      );
    }
    return this.dashboard.salesSeries(this.ctx.requireTenantSchema(), range as SalesRange, effectiveStoreId(user, storeId));
  }

  @Get('top-products')
  @ApiOperation({ summary: 'Produtos mais vendidos' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  topProducts(@CurrentUser() user: JwtPayload, @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number, @Query('storeId') storeId?: string) {
    return this.dashboard.topProducts(this.ctx.requireTenantSchema(), limit, effectiveStoreId(user, storeId));
  }

  @Get('low-stock')
  @ApiOperation({ summary: 'Produtos abaixo do stock mínimo' })
  lowStock(@CurrentUser() user: JwtPayload, @Query('storeId') storeId?: string) {
    return this.dashboard.lowStock(this.ctx.requireTenantSchema(), effectiveStoreId(user, storeId));
  }
}
