import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { AiConfigService } from './ai-config.service';
import { AiProviderClient } from './ai-provider.client';
import { CreateAiProviderDto, UpdateAiProviderDto } from './dto/provider.dto';
import { UpdateAssistantConfigDto } from './dto/assistant-config.dto';

/**
 * Painel do Super Admin para a IA (§ Fase 7): adicionar/editar QUALQUER
 * provedor de IA (OpenManus, OpenAI-compatível, Anthropic, ElevenLabs ou REST
 * genérico) e ajustar a persona do assistente — tudo sem tocar no código.
 */
@ApiTags('super-admin/ai')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('super-admin/ai')
export class AiAdminController {
  constructor(
    private readonly cfg: AiConfigService,
    private readonly client: AiProviderClient,
  ) {}

  // ── Provedores ─────────────────────────────────────────────
  @Get('providers')
  @ApiOperation({ summary: 'Listar provedores de IA configurados' })
  listProviders() {
    return this.cfg.listProviders();
  }

  @Get('providers/:id')
  @ApiOperation({ summary: 'Detalhe de um provedor (chave mascarada)' })
  getProvider(@Param('id') id: string) {
    return this.cfg.getProvider(id);
  }

  @Post('providers')
  @ApiOperation({ summary: 'Adicionar provedor de IA (qualquer API)' })
  createProvider(@Body() dto: CreateAiProviderDto) {
    return this.cfg.createProvider(dto);
  }

  @Patch('providers/:id')
  @ApiOperation({ summary: 'Editar provedor (chave só roda se enviada)' })
  updateProvider(@Param('id') id: string, @Body() dto: UpdateAiProviderDto) {
    return this.cfg.updateProvider(id, dto);
  }

  @Delete('providers/:id')
  @ApiOperation({ summary: 'Remover provedor' })
  deleteProvider(@Param('id') id: string) {
    return this.cfg.deleteProvider(id);
  }

  @Post('providers/:id/test')
  @ApiOperation({ summary: 'Testar conectividade ao provedor' })
  async testProvider(@Param('id') id: string) {
    const r = await this.cfg.resolveProviderWithKey(id);
    return this.client.ping(r.provider, r.apiKey);
  }

  // ── Persona do assistente ──────────────────────────────────
  @Get('assistant')
  @ApiOperation({ summary: 'Ver configuração/persona do assistente' })
  getAssistant() {
    return this.cfg.getAssistantConfig();
  }

  @Patch('assistant')
  @ApiOperation({ summary: 'Actualizar persona, voz, emojis, canais' })
  updateAssistant(@Body() dto: UpdateAssistantConfigDto) {
    return this.cfg.updateAssistantConfig(dto);
  }
}
