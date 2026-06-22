import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { RegisterConsumptionDto, RegisterConsumptionsDto } from './dto/self-consumption.dto';
import { SelfConsumptionService } from './self-consumption.service';

/**
 * Consumo próprio dos funcionários. O OPERADOR DE CAIXA regista o que consome
 * (produto + quantidade); o sistema baixa o stock e desconta automaticamente no
 * salário (RH). O gestor vê todos os consumos.
 */
@ApiTags('hr')
@Controller('hr/self-consumption')
export class SelfConsumptionController {
  constructor(
    private readonly consumption: SelfConsumptionService,
    private readonly ctx: TenantContext,
  ) {}

  @Post()
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Regista um consumo próprio (desconta no salário)' })
  register(@Body() dto: RegisterConsumptionDto, @CurrentUser() user: JwtPayload) {
    return this.consumption.register(
      this.ctx.requireTenantSchema(),
      { userId: user.sub, name: user.name ?? user.email ?? null, storeId: user.storeId ?? null },
      { productId: dto.productId, quantity: dto.quantity },
    );
  }

  @Post('bulk')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Regista vários consumos próprios de uma vez (carrinho)' })
  registerMany(@Body() dto: RegisterConsumptionsDto, @CurrentUser() user: JwtPayload) {
    return this.consumption.registerMany(
      this.ctx.requireTenantSchema(),
      { userId: user.sub, name: user.name ?? user.email ?? null, storeId: user.storeId ?? null },
      dto.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    );
  }

  @Get('mine')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Os meus consumos próprios (recentes)' })
  mine(@CurrentUser() user: JwtPayload) {
    return this.consumption.listMine(this.ctx.requireTenantSchema(), user.sub);
  }

  @Get()
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Todos os consumos próprios (vista do RH/gestor)' })
  all(@Query('status') status?: string) {
    return this.consumption.listAll(this.ctx.requireTenantSchema(), status);
  }
}
