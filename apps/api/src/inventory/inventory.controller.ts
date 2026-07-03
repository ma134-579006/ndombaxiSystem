import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { CreateTransferRequestDto, RejectTransferDto, SetLocationDto, ValuationQueryDto } from './dto/inventory.dto';
import { InventoryService } from './inventory.service';

/**
 * Inventário EMPRESARIAL — módulo aditivo por cima do stock existente:
 * Curva ABC, previsão de reposição/sugestão de compra, valorização
 * FIFO/LIFO/CMP, motor antifraude, localização física e transferências
 * com workflow de aprovação (gestor → administrador → receção).
 */
@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly svc: InventoryService,
    private readonly ctx: TenantContext,
  ) {}

  @Get('abc')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Curva ABC de produtos (valor de venda + rotatividade) no período' })
  abc(@Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string) {
    return this.svc.abc(this.ctx.requireTenantSchema(), { from, to, storeId });
  }

  @Get('replenishment')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Previsão de reposição + sugestão automática de compra (mínimo/lead time)' })
  replenishment(
    @Query('days') days?: string,
    @Query('coverage') coverage?: string,
    @Query('leadDays') leadDays?: string,
    @Query('storeId') storeId?: string,
  ) {
    return this.svc.replenishment(this.ctx.requireTenantSchema(), {
      days: days ? Number(days) : undefined,
      coverage: coverage ? Number(coverage) : undefined,
      leadDays: leadDays ? Number(leadDays) : undefined,
      storeId,
    });
  }

  @Get('valuation')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Valorização financeira do stock (FIFO, LIFO e Custo Médio Ponderado)' })
  valuation(@Query() q: ValuationQueryDto, @Query('storeId') storeId?: string) {
    return this.svc.valuation(this.ctx.requireTenantSchema(), { method: q.method, storeId });
  }

  @Get('fraud-signals')
  @Roles(Role.REGIONAL_MANAGER)
  @ApiOperation({ summary: 'Motor antifraude: sinais de controlo interno (ajustes, cancelamentos, quebras…)' })
  fraudSignals(@Query('days') days?: string) {
    return this.svc.fraudSignals(this.ctx.requireTenantSchema(), { days: days ? Number(days) : undefined });
  }

  // ── Localização física ─────────────────────────────────────
  @Get('locations')
  @Roles(Role.SHIFT_SUPERVISOR)
  @ApiOperation({ summary: 'Mapa de localização dos produtos (corredor/prateleira) por loja' })
  listLocations(@Query('storeId') storeId?: string, @Query('q') q?: string) {
    return this.svc.listLocations(this.ctx.requireTenantSchema(), { storeId, q });
  }

  @Post('locations')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Define a localização física de um produto numa loja' })
  setLocation(@Body() dto: SetLocationDto, @CurrentUser() user: JwtPayload) {
    return this.svc.setLocation(this.ctx.requireTenantSchema(), {
      productId: dto.productId, storeId: dto.storeId, location: dto.location ?? null,
      actorId: user.sub, actorName: user.name ?? user.email,
    });
  }

  // ── Transferências com aprovação ───────────────────────────
  @Get('transfers')
  @Roles(Role.SHIFT_SUPERVISOR)
  @ApiOperation({ summary: 'Lista pedidos de transferência (workflow de aprovação)' })
  listTransfers(@Query('status') status?: string) {
    return this.svc.listTransferRequests(this.ctx.requireTenantSchema(), status || undefined);
  }

  @Post('transfers')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Gestor PEDE uma transferência entre lojas (fica pendente de aprovação)' })
  createTransfer(@Body() dto: CreateTransferRequestDto, @CurrentUser() user: JwtPayload) {
    return this.svc.createTransferRequest(this.ctx.requireTenantSchema(), {
      productId: dto.productId, fromStoreId: dto.fromStoreId, toStoreId: dto.toStoreId,
      quantity: dto.quantity, note: dto.note ?? null,
      actorId: user.sub, actorName: user.name ?? user.email,
    });
  }

  @Post('transfers/:id/approve')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Administrador APROVA o pedido (o stock só se move na receção)' })
  approveTransfer(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.decideTransferRequest(this.ctx.requireTenantSchema(), id, 'APPROVED', {
      actorId: user.sub, actorName: user.name ?? user.email,
    });
  }

  @Post('transfers/:id/reject')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Administrador REJEITA o pedido (com motivo)' })
  rejectTransfer(@Param('id') id: string, @Body() dto: RejectTransferDto, @CurrentUser() user: JwtPayload) {
    return this.svc.decideTransferRequest(this.ctx.requireTenantSchema(), id, 'REJECTED', {
      reason: dto.reason ?? null, actorId: user.sub, actorName: user.name ?? user.email,
    });
  }

  @Post('transfers/:id/receive')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Loja destino RECECIONA: só aqui o stock se move (saída origem + entrada destino)' })
  receiveTransfer(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.receiveTransferRequest(this.ctx.requireTenantSchema(), id, {
      actorId: user.sub, actorName: user.name ?? user.email,
    });
  }

  // ── Auditoria por funcionário ──────────────────────────────
  @Get('audit')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Trilha de auditoria filtrável por funcionário/ação/período' })
  auditTrail(
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.auditTrail(this.ctx.requireTenantSchema(), { actorId, action, from, to });
  }

  @Get('audit/filters')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Funcionários e ações disponíveis na trilha (para filtros)' })
  auditFilters() {
    return this.svc.auditFilters(this.ctx.requireTenantSchema());
  }
}
