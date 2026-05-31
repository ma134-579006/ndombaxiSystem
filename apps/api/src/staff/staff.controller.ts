import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { CreateStaffDto, ResetPasswordDto, SetPinDto, UpdateStaffDto } from './dto/staff.dto';
import { CreateStoreDto, UpdateStoreDto } from './dto/store.dto';
import { StaffService, type StaffActor } from './staff.service';

/**
 * Gestão de equipa + lojas da empresa (painel do COMPANY_ADMIN).
 * Leitura disponível a gestores; alterações reservadas ao COMPANY_ADMIN.
 */
@ApiTags('staff')
@Controller('staff')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly ctx: TenantContext,
  ) {}

  private actor(user: JwtPayload): StaffActor {
    return { sub: user.sub, role: user.role };
  }

  // ── Lojas ──────────────────────────────────────────────────
  @Get('stores')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Lista as lojas da empresa' })
  listStores() {
    return this.staff.listStores(this.ctx.requireTenantSchema());
  }

  @Post('stores')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Cria uma loja' })
  createStore(@Body() dto: CreateStoreDto, @CurrentUser() user: JwtPayload) {
    return this.staff.createStore(this.ctx.requireTenantSchema(), this.actor(user), dto);
  }

  @Patch('stores/:id')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Actualiza uma loja' })
  updateStore(@Param('id') id: string, @Body() dto: UpdateStoreDto) {
    return this.staff.updateStore(this.ctx.requireTenantSchema(), id, dto);
  }

  // ── Funcionários ───────────────────────────────────────────
  @Get('users')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Lista os funcionários da empresa' })
  listStaff() {
    return this.staff.listStaff(this.ctx.requireTenantSchema());
  }

  @Post('users')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Cria um funcionário (papel + loja + senha/PIN)' })
  createStaff(@Body() dto: CreateStaffDto, @CurrentUser() user: JwtPayload) {
    return this.staff.createStaff(this.ctx.requireTenantSchema(), this.actor(user), dto);
  }

  @Patch('users/:id')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Actualiza um funcionário (nome/papel/loja/estado)' })
  updateStaff(
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.staff.updateStaff(this.ctx.requireTenantSchema(), this.actor(user), id, dto);
  }

  @Post('users/:id/reset-password')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Define/regenera a palavra-passe de um funcionário' })
  resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.staff.resetPassword(this.ctx.requireTenantSchema(), this.actor(user), id, dto);
  }

  @Post('users/:id/set-pin')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Define o PIN do POS de um funcionário' })
  setPin(@Param('id') id: string, @Body() dto: SetPinDto) {
    return this.staff.setPin(this.ctx.requireTenantSchema(), id, dto);
  }

  @Post('users/:id/deactivate')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Desactiva um funcionário' })
  deactivate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.staff.deactivate(this.ctx.requireTenantSchema(), this.actor(user), id);
  }
}
