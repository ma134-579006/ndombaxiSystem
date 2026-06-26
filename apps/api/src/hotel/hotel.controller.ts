import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { HotelService } from './hotel.service';
import { CreateReservationDto, CreateRoomDto, FolioItemDto, ReservationStatusDto } from './dto/hotel.dto';

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

  @Get('reservations')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Lista reservas' })
  list(@Query('status') status?: string) { return this.svc.list(this.ctx.requireTenantSchema(), status); }

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
}
