import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { PayablesService } from './payables.service';
import { CreatePayableDto, RecordPayablePaymentDto } from './dto/payable.dto';

function actor(u: JwtPayload) {
  return { id: u?.sub ?? null, name: u?.email ?? null };
}

/** Contas a pagar (fornecedores) — gestor da loja (STORE_MANAGER+). */
@ApiTags('payables')
@Controller('payables')
@Roles(Role.STORE_MANAGER)
export class PayablesController {
  constructor(
    private readonly payables: PayablesService,
    private readonly ctx: TenantContext,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista contas a pagar (filtro: open | overdue | paid)' })
  @ApiQuery({ name: 'filter', required: false })
  list(@Query('filter') filter?: string) {
    return this.payables.list(this.ctx.requireTenantSchema(), filter || undefined);
  }

  @Get('summary')
  @ApiOperation({ summary: 'KPIs: total a pagar, vencido e contagens' })
  summary() {
    return this.payables.summary(this.ctx.requireTenantSchema());
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe da conta + pagamentos' })
  get(@Param('id') id: string) {
    return this.payables.get(this.ctx.requireTenantSchema(), id);
  }

  @Post()
  @ApiOperation({ summary: 'Cria uma conta a pagar' })
  create(@Body() dto: CreatePayableDto, @CurrentUser() u: JwtPayload) {
    return this.payables.create(this.ctx.requireTenantSchema(), dto, actor(u));
  }

  @Post(':id/payment')
  @ApiOperation({ summary: 'Regista um pagamento ao fornecedor (comprovativo PG)' })
  pay(@Param('id') id: string, @Body() dto: RecordPayablePaymentDto, @CurrentUser() u: JwtPayload) {
    return this.payables.recordPayment(this.ctx.requireTenantSchema(), id, dto, actor(u));
  }
}
