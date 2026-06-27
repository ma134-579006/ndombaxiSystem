import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { ServiceOrdersService } from './service-orders.service';
import { AddServiceItemDto, CreateEquipmentDto, CreateServiceOrderDto, ServiceStatusDto, UpdateEquipmentDto, UpdateServiceOrderDto } from './dto/service-order.dto';

/** Serviços — Ordens de Serviço (vertical SERVICES). */
@ApiTags('service-orders')
@Controller('service-orders')
export class ServiceOrdersController {
  constructor(
    private readonly svc: ServiceOrdersService,
    private readonly ctx: TenantContext,
  ) {}

  @Get()
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Lista ordens de serviço' })
  list(@Query('status') status?: string) { return this.svc.list(this.ctx.requireTenantSchema(), status); }

  @Get('pending-online')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Nº de pedidos de serviço da loja online por tratar' })
  async pendingOnline() { return { count: await this.svc.pendingOnline(this.ctx.requireTenantSchema()) }; }

  // ── Equipamentos / viaturas ────────────────────────────────
  @Get('equipments')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Lista equipamentos/viaturas (opcional: por cliente)' })
  equipments(@Query('customerId') customerId?: string) { return this.svc.listEquipments(this.ctx.requireTenantSchema(), customerId); }

  @Post('equipments')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Regista um equipamento/viatura' })
  createEquipment(@Body() dto: CreateEquipmentDto) { return this.svc.createEquipment(this.ctx.requireTenantSchema(), dto); }

  @Patch('equipments/:id')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Atualiza km/próxima revisão/notas do equipamento' })
  updateEquipment(@Param('id') id: string, @Body() dto: UpdateEquipmentDto) { return this.svc.updateEquipment(this.ctx.requireTenantSchema(), id, dto); }

  @Post()
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Abre uma ordem de serviço' })
  create(@Body() dto: CreateServiceOrderDto, @CurrentUser() user: JwtPayload) {
    return this.svc.create(this.ctx.requireTenantSchema(), { id: user.sub, name: user.name ?? user.email ?? 'Operador' }, dto);
  }

  @Get(':id')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Detalhe de uma OS (com itens)' })
  get(@Param('id') id: string) { return this.svc.get(this.ctx.requireTenantSchema(), id); }

  @Patch(':id')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Atualiza diagnóstico/técnico/notas da OS' })
  update(@Param('id') id: string, @Body() dto: UpdateServiceOrderDto) {
    return this.svc.update(this.ctx.requireTenantSchema(), id, dto);
  }

  @Post(':id/items')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Adiciona peça/mão-de-obra à OS' })
  addItem(@Param('id') id: string, @Body() dto: AddServiceItemDto) {
    return this.svc.addItem(this.ctx.requireTenantSchema(), id, dto);
  }

  @Delete('items/:id')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Remove um item da OS' })
  removeItem(@Param('id') id: string) { return this.svc.removeItem(this.ctx.requireTenantSchema(), id); }

  @Post(':id/status')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Muda o estado da OS (orçamento, aprovado, em curso, pronto, entregue)' })
  status(@Param('id') id: string, @Body() dto: ServiceStatusDto) {
    return this.svc.setStatus(this.ctx.requireTenantSchema(), id, dto.status);
  }

  @Post(':id/invoice')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Fatura a OS (documento fiscal AGT) e marca entregue' })
  invoice(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.invoice(this.ctx.requireTenantSchema(), id, { id: user.sub, name: user.name ?? user.email ?? 'Operador' });
  }
}
