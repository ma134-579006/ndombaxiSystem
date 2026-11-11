import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { AffiliatesService } from './affiliates.service';

export class AffiliatePercentDto {
  /** % de comissão (0 ou vazio = produto fora do mercado de associados). */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(90) percent?: number | null;
}
export class WithdrawalDecisionDto {
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

/** Gestão do programa de associados (comissões por produto, associados, saques). */
@ApiTags('ecommerce')
@Controller('ecommerce/affiliates')
export class AffiliatesController {
  constructor(private readonly aff: AffiliatesService, private readonly ctx: TenantContext) {}

  @Get('products')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Produtos e respetiva % de comissão de associado' })
  products(@Query('q') q?: string) { return this.aff.products(this.ctx.requireTenantSchema(), q); }

  @Patch('products/:code')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Define a % de comissão de um produto' })
  setPercent(@Param('code') code: string, @Body() dto: AffiliatePercentDto) { return this.aff.setPercent(this.ctx.requireTenantSchema(), code, dto.percent ?? null); }

  @Get('associates')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Associados com código, vendas e saldos' })
  associates() { return this.aff.associates(this.ctx.requireTenantSchema()); }

  @Get('withdrawals')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Pedidos de saque' })
  withdrawals() { return this.aff.withdrawals(this.ctx.requireTenantSchema()); }

  @Post('withdrawals/:id/pay')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Marca o saque como pago' })
  pay(@Param('id') id: string, @Body() dto: WithdrawalDecisionDto) { return this.aff.decideWithdrawal(this.ctx.requireTenantSchema(), id, true, dto.note); }

  @Post('withdrawals/:id/reject')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Recusa o saque' })
  reject(@Param('id') id: string, @Body() dto: WithdrawalDecisionDto) { return this.aff.decideWithdrawal(this.ctx.requireTenantSchema(), id, false, dto.note); }
}
