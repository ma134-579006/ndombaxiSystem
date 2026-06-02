import { Module } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { IntegrationsController } from './integrations.controller';

/**
 * Integrações externas configuráveis pelo Super Admin (AGT SAF-T, Open Finance,
 * Stripe, DocuSign, biometria). Exporta o IntegrationsService para os
 * adaptadores lerem a configuração activa via getActive(key).
 */
@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
