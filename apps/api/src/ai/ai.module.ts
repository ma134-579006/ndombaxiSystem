import { Module } from '@nestjs/common';
import { AiAdminController } from './ai-admin.controller';
import { AiController } from './ai.controller';
import { AiConfigService } from './ai-config.service';
import { AiProviderClient } from './ai-provider.client';
import { AssistantService } from './assistant.service';

/**
 * Módulo OpenManus AI (§ Fase 7). Junta a configuração de provedores (gerida
 * pelo Super Admin), o cliente HTTP agnóstico e o assistente profissional.
 */
@Module({
  controllers: [AiController, AiAdminController],
  providers: [AiConfigService, AiProviderClient, AssistantService],
  exports: [AiConfigService, AssistantService],
})
export class AiModule {}
