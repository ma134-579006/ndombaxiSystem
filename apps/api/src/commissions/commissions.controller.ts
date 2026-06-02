import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { CommissionsService } from './commissions.service';
import { IsNumber, Max, Min } from 'class-validator';

class SetRateDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  rate!: number;
}

/** Comissões de vendedores — gestor da loja (STORE_MANAGER+). */
@ApiTags('commissions')
@Controller('commissions')
@Roles(Role.STORE_MANAGER)
export class CommissionsController {
  constructor(
    private readonly commissions: CommissionsService,
    private readonly ctx: TenantContext,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Relatório de comissões por vendedor no período' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  report(@Query('from') from?: string, @Query('to') to?: string) {
    return this.commissions.report(this.ctx.requireTenantSchema(), from, to);
  }

  @Post(':userId/rate')
  @ApiOperation({ summary: 'Define a % de comissão de um vendedor' })
  setRate(@Param('userId') userId: string, @Body() dto: SetRateDto, @CurrentUser() u: JwtPayload) {
    return this.commissions.setRate(this.ctx.requireTenantSchema(), userId, dto.rate, { id: u?.sub ?? null, name: u?.email ?? null });
  }
}
