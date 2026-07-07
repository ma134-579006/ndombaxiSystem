import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { HotelService } from './hotel.service';
import { CreateHousekeepingDto, CreateMaintenanceDto, CreateReservationDto, CreateRoomDto, ExtendStayDto, FolioItemDto, ReservationStatusDto, RoomStatusDto, StatusOnlyDto } from './dto/hotel.dto';

/** Hotelaria — quartos, reservas e conta do hóspede (vertical HOSPITALITY). */
@ApiTags('hotel')
@Controller('hotel')
export class HotelController {
  constructor(
    private readonly svc: HotelService,
    private readonly ctx: TenantContext,
  ) {}

  @Get('rooms')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Lista quartos' })
  rooms() { return this.svc.listRooms(this.ctx.requireTenantSchema()); }

  @Get('room-map')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Mapa de quartos com a reserva ativa' })
  roomMap() { return this.svc.roomMap(this.ctx.requireTenantSchema()); }

  @Post('rooms')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Cria um quarto' })
  createRoom(@Body() dto: CreateRoomDto) { return this.svc.createRoom(this.ctx.requireTenantSchema(), dto); }

  @Delete('rooms/:id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Remove (desativa) um quarto' })
  removeRoom(@Param('id') id: string) { return this.svc.removeRoom(this.ctx.requireTenantSchema(), id); }

  @Post('rooms/:id/status')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Muda o estado físico do quarto (livre/bloqueado/manutenção…)' })
  roomStatus(@Param('id') id: string, @Body() dto: RoomStatusDto) { return this.svc.setRoomStatus(this.ctx.requireTenantSchema(), id, dto.status); }

  // ── Housekeeping (limpeza) ─────────────────────────────────
  @Get('housekeeping')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Lista tarefas de limpeza' })
  housekeeping(@Query('status') status?: string) { return this.svc.listHousekeeping(this.ctx.requireTenantSchema(), status); }

  @Post('housekeeping')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Cria tarefa de limpeza' })
  createHousekeeping(@Body() dto: CreateHousekeepingDto) { return this.svc.createHousekeeping(this.ctx.requireTenantSchema(), dto); }

  @Post('housekeeping/:id/done')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Conclui a limpeza (liberta o quarto se não restarem tarefas)' })
  doneHousekeeping(@Param('id') id: string) { return this.svc.doneHousekeeping(this.ctx.requireTenantSchema(), id); }

  // ── Manutenção ─────────────────────────────────────────────
  @Get('maintenance')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Lista manutenções' })
  maintenance(@Query('status') status?: string) { return this.svc.listMaintenance(this.ctx.requireTenantSchema(), status); }

  @Post('maintenance')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Abre uma manutenção (quarto fica em manutenção)' })
  createMaintenance(@Body() dto: CreateMaintenanceDto) { return this.svc.createMaintenance(this.ctx.requireTenantSchema(), dto); }

  @Post('maintenance/:id/status')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Muda o estado da manutenção (em reparação/concluída)' })
  maintenanceStatus(@Param('id') id: string, @Body() dto: StatusOnlyDto) { return this.svc.setMaintenanceStatus(this.ctx.requireTenantSchema(), id, dto.status); }

  @Get('reservations')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Lista reservas' })
  list(@Query('status') status?: string) { return this.svc.list(this.ctx.requireTenantSchema(), status); }

  @Get('pending-online')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Nº de reservas da loja online por confirmar' })
  async pendingOnline() { return { count: await this.svc.pendingOnline(this.ctx.requireTenantSchema()) }; }

  @Post('reservations')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Cria uma reserva' })
  create(@Body() dto: CreateReservationDto, @CurrentUser() user: JwtPayload) {
    return this.svc.create(this.ctx.requireTenantSchema(), user.sub, dto);
  }

  @Get('reservations/:id')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Detalhe da reserva (com folio)' })
  get(@Param('id') id: string) { return this.svc.get(this.ctx.requireTenantSchema(), id); }

  @Post('reservations/:id/folio')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Adiciona consumo/extra à conta do hóspede' })
  addFolio(@Param('id') id: string, @Body() dto: FolioItemDto) {
    return this.svc.addFolio(this.ctx.requireTenantSchema(), id, dto);
  }

  @Delete('folio/:id')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Remove um item do folio' })
  removeFolio(@Param('id') id: string) { return this.svc.removeFolio(this.ctx.requireTenantSchema(), id); }

  @Post('reservations/:id/status')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Muda o estado (check-in, check-out, cancelar)' })
  status(@Param('id') id: string, @Body() dto: ReservationStatusDto) {
    return this.svc.setStatus(this.ctx.requireTenantSchema(), id, dto.status);
  }

  @Post('reservations/:id/extend')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Estende a estadia (mais noites): recalcula noites e total' })
  extend(@Param('id') id: string, @Body() dto: ExtendStayDto) {
    return this.svc.extend(this.ctx.requireTenantSchema(), id, dto.checkOut);
  }

  @Post('reservations/:id/invoice')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Fatura a reserva (documento fiscal AGT) e faz check-out' })
  invoice(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.invoice(this.ctx.requireTenantSchema(), id, { id: user.sub, name: user.name ?? user.email ?? 'Operador' });
  }
}
