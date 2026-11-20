import { BadRequestException, Body, Controller, Get, Ip, Patch, Post } from '@nestjs/common';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
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
    private readonly audit: AuditService,
  ) {}

  /** Trilho de auditoria da plataforma para toda a alteração fiscal (sem segredos). */
  private log(user: JwtPayload, ip: string, action: string, after: Record<string, unknown>) {
    return this.audit.record({ actorType: 'PLATFORM', actorId: user.sub, action, entity: 'AgtFiscalConfig', after, ip });
  }

  @Get()
  @ApiOperation({ summary: 'Lê a configuração fiscal AGT (credencial mascarada)' })
  get() {
    return this.config.getSafe();
  }

  @Patch()
  @ApiOperation({ summary: 'Actualiza a configuração fiscal AGT (parcial)' })
  async update(@Body() dto: UpdateAgtConfigDto, @CurrentUser() user: JwtPayload, @Ip() ip: string) {
    const r = await this.config.update(dto);
    // A credencial nunca entra no registo: só se foi alterada.
    const { apiKey, ...visible } = dto as UpdateAgtConfigDto & { apiKey?: string };
    await this.log(user, ip, 'AGT_CONFIG_UPDATED', { ...visible, ...(apiKey !== undefined ? { apiKeyChanged: true } : {}) });
    return r;
  }

  @Post('subscribe')
  @ApiOperation({ summary: 'Marca o sistema como subscrito à AGT' })
  async subscribe(@CurrentUser() user: JwtPayload, @Ip() ip: string) {
    const r = await this.config.subscribe();
    await this.log(user, ip, 'AGT_SUBSCRIBED', {});
    return r;
  }

  // ── Chave de assinatura da PLATAFORMA (certificação no portal AGT) ─────────
  // A privada nunca sai do servidor; só a pública (public.pem) é exportável.
  @Get('signing-key')
  @ApiOperation({ summary: 'Estado da chave de assinatura da plataforma (versão, fingerprint)' })
  signingKeyStatus() {
    return this.signing.status();
  }

  @Post('signing-key')
  @ApiOperation({ summary: 'Gera/roda o par RSA da plataforma (por omissão 1024 — assinatura cabe no Hash do SAF-T)' })
  async provisionSigningKey(@Body() dto: { modulusBits?: number } | undefined, @CurrentUser() user: JwtPayload, @Ip() ip: string) {
    const bits = dto?.modulusBits ?? 1024;
    if (bits !== 1024 && bits !== 2048) throw new BadRequestException('modulusBits tem de ser 1024 (Modelo 8 / SAF-T) ou 2048.');
    const r = await this.signing.provision(bits);
    // Rodar a chave muda a assinatura de TODOS os documentos seguintes: fica auditado.
    await this.log(user, ip, 'AGT_SIGNING_KEY_ROTATED', { modulusBits: bits, status: r as unknown as Record<string, unknown> });
    return r;
  }

  @Get('signing-key/export')
  @ApiOperation({ summary: 'Exporta a chave pública (public.pem) para anexar no portal da AGT' })
  exportPublicKey() {
    return this.signing.exportPublicKey();
  }
}
