import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { AgtConfigService } from './agt-config.service';
import { UpdateAgtConfigDto } from './dto/agt-config.dto';

/**
 * Painel do Super Admin para a configuração fiscal AGT (§7). Tudo o que a AGT
 * exige nos recibos/relatórios é configurado AQUI, por interface, sem código.
 */
@ApiTags('super-admin')
@Controller('super-admin/fiscal/agt')
@Roles(Role.SUPER_ADMIN)
export class AgtConfigController {
  constructor(private readonly config: AgtConfigService) {}

  @Get()
  @ApiOperation({ summary: 'Lê a configuração fiscal AGT' })
  get() {
    return this.config.get();
  }

  @Patch()
  @ApiOperation({ summary: 'Actualiza a configuração fiscal AGT (parcial)' })
  update(@Body() dto: UpdateAgtConfigDto) {
    return this.config.update(dto);
  }

  @Post('subscribe')
  @ApiOperation({ summary: 'Marca o sistema como subscrito à AGT' })
  subscribe() {
    return this.config.subscribe();
  }
}
