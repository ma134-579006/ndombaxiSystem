import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { RegisterDeviceDto } from './dto/device.dto';
import { DevicesService } from './devices.service';

/**
 * Postos da empresa e a série fiscal de cada um (ver `devices.service.ts` para
 * a razão de fundo: uma série partilhada por dois postos offline produz cadeias
 * de hash divergentes, e isso não tem correção depois de acontecer).
 */
@ApiTags('devices')
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly ctx: TenantContext,
  ) {}

  /**
   * O posto apresenta-se e recebe a sua série. Chamado pela aplicação no
   * primeiro arranque com rede — e repetido sem custo, porque é idempotente.
   *
   * Basta ser CASHIER: quem tem de se registar é a caixa, e exigir um gestor
   * presente para instalar um posto novo seria uma trava sem propósito.
   */
  @Post('register')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Regista este posto e devolve a sua série fiscal exclusiva' })
  async register(@Body() dto: RegisterDeviceDto) {
    const d = await this.devices.register(this.ctx.requireTenantSchema(), {
      deviceKey: dto.deviceKey,
      name: dto.name,
      platform: dto.platform,
      storeId: dto.storeId ?? null,
    });
    return {
      deviceKey: d.device_key,
      name: d.name,
      platform: d.platform,
      storeId: d.store_id,
      series: d.series,
      registeredAt: d.registered_at,
    };
  }

  @Get()
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Lista os postos da empresa e as respetivas séries' })
  list() {
    return this.devices.list(this.ctx.requireTenantSchema());
  }
}
