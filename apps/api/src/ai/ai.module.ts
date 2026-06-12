import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { AgentService } from './agent.service';
import { AgentToolsService } from './agent-tools.service';
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
  imports: [AuditModule, IntegrationsModule],
  controllers: [AiController, AiAdminController],
  providers: [AiConfigService, AiProviderClient, AssistantService, AgentService, AgentToolsService],
  exports: [AiConfigService, AiProviderClient, AssistantService],
})
export class AiModule {}
