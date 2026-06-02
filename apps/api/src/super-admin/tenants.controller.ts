import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantsService } from './tenants.service';
import { AuthService } from '../auth/auth.service';
import { ChangePlanDto, ListTenantsDto } from './dto/list-tenants.dto';
import { ResetTenantPasswordDto } from './dto/reset-password.dto';

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@Controller('super-admin/tenants')
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar empresas com filtros' })
  list(@Query() filters: ListTenantsDto) {
    return this.tenants.list(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Perfil completo de uma empresa' })
  get(@Param('id') id: string) {
    return this.tenants.get(id);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Aprovar registo de empresa' })
  approve(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    return this.tenants.approve(id, { adminId: user.sub, ip });
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Rejeitar registo de empresa' })
  reject(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    return this.tenants.reject(id, { adminId: user.sub, ip });
  }

  @Post(':id/suspend')
  @ApiOperation({ summary: 'Suspender empresa (mantém dados)' })
  suspend(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    return this.tenants.setStatus(id, 'SUSPENDED', { adminId: user.sub, ip });
  }

  @Post(':id/reactivate')
  @ApiOperation({ summary: 'Reactivar empresa suspensa' })
  reactivate(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    return this.tenants.setStatus(id, 'ACTIVE', { adminId: user.sub, ip });
  }

  @Patch(':id/plan')
  @ApiOperation({ summary: 'Migrar empresa de plano' })
  changePlan(
    @Param('id') id: string,
    @Body() dto: ChangePlanDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    return this.tenants.changePlan(id, dto, { adminId: user.sub, ip });
  }

  @Post(':id/reset-password')
  @ApiOperation({ summary: 'Forçar reset de senha de um utilizador da empresa' })
  resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetTenantPasswordDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    return this.tenants.resetUserPassword(id, dto, { adminId: user.sub, ip });
  }

  @Get(':id/export')
  @ApiOperation({ summary: 'Exportar dados completos da empresa (RGPD)' })
  exportData(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    return this.tenants.exportData(id, { adminId: user.sub, ip });
  }

  @Post(':id/impersonate')
  @ApiOperation({ summary: 'Acesso shadow: entrar no painel da empresa (auditado)' })
  impersonate(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    return this.auth.impersonate(id, { adminId: user.sub, ip });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir empresa e limpar schema' })
  remove(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    return this.tenants.remove(id, { adminId: user.sub, ip });
  }
}
