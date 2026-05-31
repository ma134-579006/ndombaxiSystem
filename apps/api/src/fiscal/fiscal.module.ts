import { Module } from '@nestjs/common';
import { AgtConfigController } from './agt-config.controller';
import { AgtConfigService } from './agt-config.service';
import { CompanyIdentityService } from './company-identity.service';
import { FiscalController } from './fiscal.controller';

/**
 * Módulo fiscal AGT (§7): configuração gerida pelo Super Admin (nº de validação,
 * legendas dos recibos/relatórios, campos livres) + leitura pública pelos
 * recibos do tenant + identidade da empresa (logo/dados) para os documentos.
 * Exporta os serviços para o SAF-T/recibos usarem a config.
 */
@Module({
  controllers: [AgtConfigController, FiscalController],
  providers: [AgtConfigService, CompanyIdentityService],
  exports: [AgtConfigService, CompanyIdentityService],
})
export class FiscalModule {}
