import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { LeaveService } from './leave.service';

class CreateLeaveDto {
  @IsString() employeeId!: string;
  @IsIn(['FERIAS', 'FALTA', 'LICENCA', 'OUTRO']) type!: string;
  @IsString() startDate!: string;
  @IsString() endDate!: string;
  @IsOptional() @IsString() @Length(0, 300) reason?: string;
}
class ReviewLeaveDto {
  @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';
}

function actor(u: JwtPayload) {
  return { id: u?.sub ?? null, name: u?.email ?? null };
}

/** Férias / ausências — gestor da loja (STORE_MANAGER+). */
@ApiTags('leave')
@Controller('leave')
@Roles(Role.STORE_MANAGER)
export class LeaveController {
  constructor(
    private readonly leave: LeaveService,
    private readonly ctx: TenantContext,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista pedidos de férias/ausência (filtro por estado)' })
  @ApiQuery({ name: 'status', required: false })
  list(@Query('status') status?: string) {
    return this.leave.list(this.ctx.requireTenantSchema(), status || undefined);
  }

  @Get('employees')
  @ApiOperation({ summary: 'Funcionários activos (para o pedido)' })
  employees() {
    return this.leave.employees(this.ctx.requireTenantSchema());
  }

  @Get('summary')
  @ApiOperation({ summary: 'Pendentes + dias de férias gozados no ano' })
  summary() {
    return this.leave.summary(this.ctx.requireTenantSchema());
  }

  @Post()
  @ApiOperation({ summary: 'Regista um pedido de férias/ausência' })
  create(@Body() dto: CreateLeaveDto, @CurrentUser() u: JwtPayload) {
    return this.leave.create(this.ctx.requireTenantSchema(), dto, actor(u));
  }

  @Post(':id/review')
  @ApiOperation({ summary: 'Aprova ou rejeita um pedido' })
  review(@Param('id') id: string, @Body() dto: ReviewLeaveDto, @CurrentUser() u: JwtPayload) {
    return this.leave.review(this.ctx.requireTenantSchema(), id, dto.decision, actor(u));
  }
}
