import { Module } from '@nestjs/common';
import { CashboxModule } from '../cashbox/cashbox.module';
import { AgtConfigController } from './agt-config.controller';
import { AgtConfigService } from './agt-config.service';
import { AgtCommunicationService } from './agt-communication.service';
import { CompanyIdentityService } from './company-identity.service';
import { FiscalController } from './fiscal.controller';

/**
 * Módulo fiscal AGT (§7): configuração gerida pelo Super Admin (nº de validação,
 * legendas dos recibos/relatórios, campos livres, contrato de comunicação
 * eletrónica) + leitura pública pelos recibos do tenant + identidade da empresa
 * (logo/dados) para os documentos + comunicação eletrónica por tenant (DP 71/25).
 * Exporta os serviços para o SAF-T/recibos usarem a config.
 */
@Module({
  imports: [CashboxModule],
  controllers: [AgtConfigController, FiscalController],
  providers: [AgtConfigService, CompanyIdentityService, AgtCommunicationService],
  exports: [AgtConfigService, CompanyIdentityService],
})
export class FiscalModule {}
