import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { ReceivablesService } from './receivables.service';
import { CreateReceivableDto, RecordPaymentDto } from './dto/receivable.dto';

function actor(u: JwtPayload) {
  return { id: u?.sub ?? null, name: u?.email ?? null };
}

/** Contas a receber (venda a crédito) — gestor da loja (STORE_MANAGER+). */
@ApiTags('receivables')
@Controller('receivables')
@Roles(Role.STORE_MANAGER)
export class ReceivablesController {
  constructor(
    private readonly receivables: ReceivablesService,
    private readonly ctx: TenantContext,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista contas a receber (filtro: open | overdue | paid)' })
  @ApiQuery({ name: 'filter', required: false })
  list(@Query('filter') filter?: string) {
    return this.receivables.list(this.ctx.requireTenantSchema(), filter || undefined);
  }

  @Get('summary')
  @ApiOperation({ summary: 'KPIs: total em dívida, vencido e contagens' })
  summary() {
    return this.receivables.summary(this.ctx.requireTenantSchema());
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe da conta + recibos' })
  get(@Param('id') id: string) {
    return this.receivables.get(this.ctx.requireTenantSchema(), id);
  }

  @Post()
  @ApiOperation({ summary: 'Cria manualmente uma conta a receber' })
  create(@Body() dto: CreateReceivableDto, @CurrentUser() u: JwtPayload) {
    return this.receivables.create(this.ctx.requireTenantSchema(), dto, actor(u));
  }

  @Post(':id/payment')
  @ApiOperation({ summary: 'Regista um recebimento e emite o recibo (RC)' })
  pay(@Param('id') id: string, @Body() dto: RecordPaymentDto, @CurrentUser() u: JwtPayload) {
    return this.receivables.recordPayment(this.ctx.requireTenantSchema(), id, dto, actor(u));
  }
}
