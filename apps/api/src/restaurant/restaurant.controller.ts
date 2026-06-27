import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { RestaurantService } from './restaurant.service';
import { AddItemDto, CloseOrderDto, CreateTableDto, KitchenStatusDto, OpenOrderDto, SetRecipeDto } from './dto/restaurant.dto';

/** Restauração — mesas, comandas e cozinha (vertical RESTAURANT). */
@ApiTags('restaurant')
@Controller('restaurant')
export class RestaurantController {
  constructor(
    private readonly svc: RestaurantService,
    private readonly ctx: TenantContext,
  ) {}

  @Get('tables')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Lista mesas ativas' })
  tables() { return this.svc.listTables(this.ctx.requireTenantSchema()); }

  @Get('table-map')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Mapa de mesas com a comanda aberta de cada uma' })
  tableMap() { return this.svc.tableMap(this.ctx.requireTenantSchema()); }

  @Post('tables')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Cria uma mesa' })
  createTable(@Body() dto: CreateTableDto) { return this.svc.createTable(this.ctx.requireTenantSchema(), dto); }

  @Delete('tables/:id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Remove (desativa) uma mesa' })
  removeTable(@Param('id') id: string) { return this.svc.removeTable(this.ctx.requireTenantSchema(), id); }

  @Post('orders')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Abre (ou devolve) a comanda de uma mesa' })
  openOrder(@Body() dto: OpenOrderDto, @CurrentUser() user: JwtPayload) {
    return this.svc.openOrder(this.ctx.requireTenantSchema(), dto.tableId,
      { id: user.sub, name: user.name ?? user.email ?? 'Operador' }, dto.guests, dto.customerName);
  }

  @Get('orders/:id')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Detalhe de uma comanda (com itens)' })
  getOrder(@Param('id') id: string) { return this.svc.getOrder(this.ctx.requireTenantSchema(), id); }

  @Post('orders/:id/items')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Lança um item na comanda' })
  addItem(@Param('id') id: string, @Body() dto: AddItemDto, @CurrentUser() user: JwtPayload) {
    return this.svc.addItem(this.ctx.requireTenantSchema(), id, dto.productCode, dto.quantity, user.sub, dto.notes);
  }

  @Delete('items/:id')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Remove um item da comanda' })
  removeItem(@Param('id') id: string) { return this.svc.removeItem(this.ctx.requireTenantSchema(), id); }

  @Post('items/:id/kitchen')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Atualiza o estado de cozinha de um item' })
  kitchenStatus(@Param('id') id: string, @Body() dto: KitchenStatusDto) {
    return this.svc.setItemKitchen(this.ctx.requireTenantSchema(), id, dto.status);
  }

  @Post('orders/:id/close')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Fecha a comanda (baixa ingredientes; opcional: lança no folio do quarto)' })
  closeOrder(@Param('id') id: string, @Body() dto: CloseOrderDto) {
    return this.svc.closeOrder(this.ctx.requireTenantSchema(), id, dto?.chargeToReservationId);
  }

  // ── Receitas / fichas técnicas ─────────────────────────────
  @Get('recipe/:productId')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Receita (ingredientes) de um prato' })
  getRecipe(@Param('productId') productId: string) { return this.svc.getRecipe(this.ctx.requireTenantSchema(), productId); }

  @Post('recipe/:productId')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Define a receita de um prato (ingredientes + quantidades)' })
  setRecipe(@Param('productId') productId: string, @Body() dto: SetRecipeDto) {
    return this.svc.setRecipe(this.ctx.requireTenantSchema(), productId, dto.items ?? []);
  }

  @Post('orders/:id/cancel')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Cancela a comanda' })
  cancelOrder(@Param('id') id: string) { return this.svc.cancelOrder(this.ctx.requireTenantSchema(), id); }

  @Get('kitchen')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Ecrã de cozinha (itens por preparar)' })
  kitchen() { return this.svc.kitchen(this.ctx.requireTenantSchema()); }
}
