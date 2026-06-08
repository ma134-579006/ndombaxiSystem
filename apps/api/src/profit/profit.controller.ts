import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { effectiveStoreId } from '../auth/store-scope';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { ProfitService } from './profit.service';

/** Lucros da empresa — só o gestor (STORE_MANAGER+). COMPANY_ADMIN vê todas as
 *  lojas; um gestor de loja vê só a sua (permissões por loja). */
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
  @ApiQuery({ name: 'storeId', required: false })
  summary(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string) {
    return this.profit.summary(this.ctx.requireTenantSchema(), from, to, effectiveStoreId(user, storeId));
  }

  @Get('series')
  @ApiOperation({ summary: 'Série temporal de vendas/custo/lucro' })
  series(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string) {
    return this.profit.series(this.ctx.requireTenantSchema(), from, to, effectiveStoreId(user, storeId));
  }

  @Get('by-product')
  @ApiOperation({ summary: 'Lucro por produto' })
  byProduct(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string) {
    return this.profit.byProduct(this.ctx.requireTenantSchema(), from, to, effectiveStoreId(user, storeId));
  }

  @Get('abc')
  @ApiOperation({ summary: 'Curva ABC de produtos (peso nas vendas)' })
  abc(@CurrentUser() user: JwtPayload, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string) {
    return this.profit.abc(this.ctx.requireTenantSchema(), from, to, effectiveStoreId(user, storeId));
  }
}
