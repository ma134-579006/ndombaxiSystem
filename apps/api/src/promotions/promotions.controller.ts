import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { PromotionsService } from './promotions.service';
import type { PromoCartLine } from './promo-engine';

@ApiTags('promotions')
@Controller('promotions')
export class PromotionsController {
  constructor(
    private readonly promos: PromotionsService,
    private readonly ctx: TenantContext,
  ) {}

  // ── Catálogo de promoções ──────────────────────────────────
  @Get()
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Lista promoções (POS usa as activas)' })
  list() {
    return this.promos.list(this.ctx.requireTenantSchema());
  }

  @Post()
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Cria uma promoção (%, valor, leve-X-paga-Y, por quantidade)' })
  create(@Body() dto: Record<string, unknown>) {
    return this.promos.create(this.ctx.requireTenantSchema(), dto);
  }

  @Patch(':id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Actualiza uma promoção' })
  update(@Param('id') id: string, @Body() dto: Record<string, unknown>) {
    return this.promos.update(this.ctx.requireTenantSchema(), id, dto);
  }

  @Delete(':id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Remove uma promoção' })
  remove(@Param('id') id: string) {
    return this.promos.remove(this.ctx.requireTenantSchema(), id);
  }

  @Post('quote')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Calcula os descontos de um carrinho' })
  quote(@Body() body: { lines: PromoCartLine[] }) {
    return this.promos.quote(this.ctx.requireTenantSchema(), body.lines ?? []);
  }

  // ── Fidelização ────────────────────────────────────────────
  @Get('loyalty/:code')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Procura um cartão de fidelização pelo código' })
  findCard(@Param('code') code: string) {
    return this.promos.findCard(this.ctx.requireTenantSchema(), code);
  }

  @Post('loyalty')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Cria um cartão de fidelização' })
  createCard(@Body() dto: { cardCode: string; holderName?: string; phone?: string; customerId?: string }) {
    return this.promos.createCard(this.ctx.requireTenantSchema(), dto);
  }

  @Post('loyalty/:cardId/redeem')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Resgata pontos como desconto' })
  redeem(@Param('cardId') cardId: string, @Body() body: { points: number; grossTotal: number }) {
    return this.promos.redeem(this.ctx.requireTenantSchema(), cardId, body.points, body.grossTotal);
  }
}
