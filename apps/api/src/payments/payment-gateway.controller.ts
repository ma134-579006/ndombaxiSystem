import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { CreateGatewayDto, UpdateGatewayDto } from './dto/gateway.dto';
import { PaymentGatewayService } from './payment-gateway.service';

/**
 * Painel do Super Admin: contratos de gateway de pagamento da plataforma
 * (ex.: Multicaixa Express com IBAN e credenciais). §8.
 */
@ApiTags('super-admin/payment-gateways')
@Controller('super-admin/payment-gateways')
@Roles(Role.SUPER_ADMIN)
export class PaymentGatewayController {
  constructor(private readonly gateways: PaymentGatewayService) {}

  @Get()
  @ApiOperation({ summary: 'Lista contratos de gateway de pagamento' })
  list() {
    return this.gateways.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de um contrato de gateway' })
  get(@Param('id') id: string) {
    return this.gateways.get(id);
  }

  @Post()
  @ApiOperation({ summary: 'Cria um contrato de gateway (ex.: Express)' })
  create(@Body() dto: CreateGatewayDto) {
    return this.gateways.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualiza um contrato de gateway' })
  update(@Param('id') id: string, @Body() dto: UpdateGatewayDto) {
    return this.gateways.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove um contrato de gateway' })
  remove(@Param('id') id: string) {
    return this.gateways.remove(id);
  }
}
