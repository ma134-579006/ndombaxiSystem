import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { AgtConfigService } from './agt-config.service';
import { PlatformSigningService } from './platform-signing.service';
import { UpdateAgtConfigDto } from './dto/agt-config.dto';

/**
 * Painel do Super Admin para a configuração fiscal AGT (§7). Tudo o que a AGT
 * exige nos recibos/relatórios é configurado AQUI, por interface, sem código.
 */
@ApiTags('super-admin')
@Controller('super-admin/fiscal/agt')
@Roles(Role.SUPER_ADMIN)
export class AgtConfigController {
  constructor(
    private readonly config: AgtConfigService,
    private readonly signing: PlatformSigningService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lê a configuração fiscal AGT (credencial mascarada)' })
  get() {
    return this.config.getSafe();
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

  // ── Chave de assinatura da PLATAFORMA (certificação no portal AGT) ─────────
  // A privada nunca sai do servidor; só a pública (public.pem) é exportável.
  @Get('signing-key')
  @ApiOperation({ summary: 'Estado da chave de assinatura da plataforma (versão, fingerprint)' })
  signingKeyStatus() {
    return this.signing.status();
  }

  @Post('signing-key')
  @ApiOperation({ summary: 'Gera/roda o par RSA-2048 da plataforma (nova versão)' })
  provisionSigningKey() {
    return this.signing.provision();
  }

  @Get('signing-key/export')
  @ApiOperation({ summary: 'Exporta a chave pública (public.pem) para anexar no portal da AGT' })
  exportPublicKey() {
    return this.signing.exportPublicKey();
  }
}
