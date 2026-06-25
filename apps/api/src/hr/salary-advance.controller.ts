import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { RequestAdvanceDto, ReviewAdvanceDto } from './dto/salary-advance.dto';
import { SalaryAdvanceService } from './salary-advance.service';

/**
 * Adiantamento salarial. O FUNCIONÁRIO (caixa) pede; o GESTOR/GERENTE aprova ou
 * rejeita (sino de notificações). O valor aprovado é descontado na folha do mês
 * do pagamento.
 */
@ApiTags('hr')
@Controller('hr/salary-advance')
export class SalaryAdvanceController {
  constructor(
    private readonly advances: SalaryAdvanceService,
    private readonly ctx: TenantContext,
  ) {}

  private actor(user: JwtPayload) {
    return { userId: user.sub, name: user.name ?? user.email ?? null, storeId: user.storeId ?? null };
  }

  @Get('limit')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Limite disponível do funcionário (salário − adiantamentos por descontar)' })
  limit(@CurrentUser() user: JwtPayload) {
    return this.advances.limit(this.ctx.requireTenantSchema(), this.actor(user));
  }

  @Post()
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Pede um adiantamento salarial (fica PENDENTE até o gestor aprovar)' })
  request(@Body() dto: RequestAdvanceDto, @CurrentUser() user: JwtPayload) {
    return this.advances.request(this.ctx.requireTenantSchema(), this.actor(user), dto.amount, dto.reason);
  }

  @Get('mine')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Os meus adiantamentos' })
  mine(@CurrentUser() user: JwtPayload) {
    return this.advances.listMine(this.ctx.requireTenantSchema(), user.sub);
  }

  @Get('pending')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Pedidos de adiantamento pendentes (sino do gestor/gerente)' })
  pending() {
    return this.advances.listPending(this.ctx.requireTenantSchema());
  }

  @Get('pending/count')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Nº de pedidos de adiantamento pendentes (badge do sino)' })
  pendingCount() {
    return this.advances.pendingCount(this.ctx.requireTenantSchema());
  }

  @Post(':id/review')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Aceitar ou rejeitar um pedido de adiantamento — gestor/gerente' })
  review(@Param('id') id: string, @Body() dto: ReviewAdvanceDto, @CurrentUser() user: JwtPayload) {
    return this.advances.review(this.ctx.requireTenantSchema(), id, dto.decision, user.sub, user.name ?? user.email, dto.note);
  }
}
