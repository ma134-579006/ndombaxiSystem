import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { CashboxService } from './cashbox.service';
import { InventoryService } from './inventory.service';
import { TenantAuditService } from './tenant-audit.service';
import {
  CashMovementDto, CloseSessionDto, CountItemDto, CreateCountDto, OpenSessionDto, StockWriteOffDto,
} from './dto/cashbox.dto';

function actor(u: JwtPayload) {
  return { id: u?.sub ?? null, name: u?.email ?? null };
}

/** Caixa / turnos — operador de caixa (CASHIER) e acima. */
@ApiTags('cashbox')
@Controller('cashbox')
@Roles(Role.CASHIER)
export class CashboxController {
  constructor(
    private readonly cash: CashboxService,
    private readonly ctx: TenantContext,
  ) {}

  @Get('session/current')
  @ApiOperation({ summary: 'Turno aberto do funcionário (ou null)' })
  current(@CurrentUser() u: JwtPayload) {
    return this.cash.currentSession(this.ctx.requireTenantSchema(), u.sub);
  }

  @Post('session/open')
  @ApiOperation({ summary: 'Abrir turno de caixa (fundo de troco)' })
  open(@Body() dto: OpenSessionDto, @CurrentUser() u: JwtPayload) {
    return this.cash.open(this.ctx.requireTenantSchema(), dto, actor(u));
  }

  @Post('session/movement')
  @ApiOperation({ summary: 'Reforço (CASH_IN) ou sangria (CASH_OUT)' })
  movement(@Body() dto: CashMovementDto, @CurrentUser() u: JwtPayload) {
    return this.cash.addMovement(this.ctx.requireTenantSchema(), dto, actor(u));
  }

  @Post('session/close')
  @ApiOperation({ summary: 'Fechar turno: conta o dinheiro físico → OK/quebra/sobra + recibo' })
  close(@Body() dto: CloseSessionDto, @CurrentUser() u: JwtPayload) {
    return this.cash.close(this.ctx.requireTenantSchema(), dto, actor(u));
  }

  @Get('sessions')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Histórico de turnos (gestor)' })
  sessions() {
    return this.cash.listSessions(this.ctx.requireTenantSchema());
  }
}

/** Inventário — gestor da loja (STORE_MANAGER+). */
@ApiTags('inventory')
@Controller('inventory')
@Roles(Role.STORE_MANAGER)
export class InventoryController {
  constructor(
    private readonly inv: InventoryService,
    private readonly ctx: TenantContext,
  ) {}

  @Post('write-off')
  @ApiOperation({ summary: 'Baixa de stock (quebra/perda) com motivo — auditada' })
  writeOff(@Body() dto: StockWriteOffDto, @CurrentUser() u: JwtPayload) {
    return this.inv.writeOff(this.ctx.requireTenantSchema(), dto, actor(u));
  }

  @Get('counts')
  @ApiOperation({ summary: 'Lista folhas de contagem de inventário' })
  listCounts() {
    return this.inv.listCounts(this.ctx.requireTenantSchema());
  }

  @Post('counts')
  @ApiOperation({ summary: 'Inicia uma contagem (snapshot do stock do armazém)' })
  createCount(@Body() dto: CreateCountDto, @CurrentUser() u: JwtPayload) {
    return this.inv.createCount(this.ctx.requireTenantSchema(), dto, actor(u));
  }

  @Get('counts/:id')
  @ApiOperation({ summary: 'Detalhe de uma contagem (itens + diferenças)' })
  getCount(@Param('id') id: string) {
    return this.inv.getCount(this.ctx.requireTenantSchema(), id);
  }

  @Post('counts/:id/item')
  @ApiOperation({ summary: 'Regista a contagem física de um item' })
  countItem(@Param('id') id: string, @Body() dto: CountItemDto) {
    return this.inv.countItem(this.ctx.requireTenantSchema(), id, dto);
  }

  @Post('counts/:id/close')
  @ApiOperation({ summary: 'Fecha a contagem e aplica os ajustes ao stock (auditado)' })
  closeCount(@Param('id') id: string, @CurrentUser() u: JwtPayload) {
    return this.inv.closeCount(this.ctx.requireTenantSchema(), id, actor(u));
  }
}

/** Auditoria do tenant — só o gestor da empresa. */
@ApiTags('audit')
@Controller('audit')
@Roles(Role.STORE_MANAGER)
export class TenantAuditController {
  constructor(
    private readonly audit: TenantAuditService,
    private readonly ctx: TenantContext,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Registo de auditoria da empresa (vendas, stock, turnos…)' })
  list(@Query('action') action?: string, @Query('limit') limit?: string) {
    return this.audit.list(this.ctx.requireTenantSchema(), {
      action: action || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('verify')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Verifica a integridade da cadeia de auditoria' })
  verify() {
    return this.audit.verify(this.ctx.requireTenantSchema());
  }
}
